// The detection engine: runs the rules (rules.ts) and keeps sentry.local.db's alerts in step.
// - A finding with no unresolved alert for its rule + target opens one (and a notification).
// - A finding that already has one refreshes it (title, severity, evidence, lastSeenAt).
// - An unresolved alert whose finding has been gone for CLEAR_ROUNDS rounds in a row is resolved
//   automatically ("auto"), so a flapping condition does not open and close alerts every minute.
//   A round that could not see the condition (its backend's summary missing or stale, the rule
//   threw, no probe round yet) neither counts nor resolves: no auto-resolve without evidence.
// - An alert a person resolved while its finding was still there is held: no new alert for that
//   rule + target until the finding has gone away once.
// - A critical alert unresolved for autoIncidentMinutes opens an incident (openedBy "auto"), or
//   joins the auto incident already open; once all of an incident's alerts are resolved, it
//   moves to monitoring. A person resolves it.
import type { Evidence, NotificationKind } from "@/types/control";
import { activeAlertRecords, alertRecords, heldAlertRecords, insertAlert, saveAlert, type AlertRecord } from "../alerts";
import { cleanEvidence } from "../evidence";
import { appendIncidentEvent, incidentRecords, insertIncident, linkAlert, saveIncident, type IncidentRecord } from "../incidents";
import { addNotification } from "../notifications";
import type { RuleLevels } from "../thresholds";
import { ist, ms } from "../time";
import { evaluate, isBlind, type Blind, type DetectContext, type Finding } from "./rules";

export const CLEAR_ROUNDS = 3;
const NOT_BLIND: Blind = { rules: new Set(), sources: new Set() };

export const AUTO = "sentry"; // who the engine writes as in notes and timelines

export interface DetectResult {
  fired: string[]; // new alert ids
  resolved: string[]; // alert ids resolved automatically
  incidentsOpened: string[];
  incidentsMonitoring: string[];
}

const keyOf = (f: Pick<Finding, "ruleId" | "target">) => `${f.ruleId}:${f.target}`;

const notifyKind = (ruleId: string): NotificationKind => (ruleId === "backup-old" ? "backup" : "alert_fired");

/** Applies one round of findings to the stored alerts. */
export function applyFindings(findings: Finding[], now: number, blind: Blind = NOT_BLIND): Pick<DetectResult, "fired" | "resolved"> {
  const at = ist(now);
  const fired: string[] = [];
  const resolved: string[] = [];
  const active = new Map(activeAlertRecords().map((a) => [a.dedupeKey, a]));
  const held = heldAlertRecords();
  const seen = new Set<string>();

  for (const f of findings) {
    const key = keyOf(f);
    if (seen.has(key)) continue; // a rule may name the same target twice: the first wins
    seen.add(key);
    const evidence = cleanEvidence(f.evidence);
    const existing = active.get(key);
    if (existing) {
      const becameCritical = f.severity === "critical" && existing.severity !== "critical";
      Object.assign(existing, { title: f.title, severity: f.severity, systems: f.systems, evidence, runbook: f.runbook, lastSeenAt: at, clearRounds: 0 });
      if (becameCritical) existing.criticalSince = at;
      saveAlert(existing);
      continue;
    }
    if (held.some((h) => h.dedupeKey === key)) continue;
    const rec = insertAlert({
      ruleId: f.ruleId,
      target: f.target,
      dedupeKey: key,
      title: f.title,
      severity: f.severity,
      state: "open",
      systems: f.systems,
      firedAt: at,
      lastSeenAt: at,
      ackedAt: null,
      resolvedAt: null,
      note: null,
      noteHistory: [],
      evidence,
      runbook: f.runbook,
      incidentId: null,
      resolvedBy: null,
      hold: false,
      criticalSince: f.severity === "critical" ? at : null,
    });
    fired.push(rec.id);
    addNotification({ at, kind: notifyKind(f.ruleId), severity: f.severity, title: f.title, body: f.runbook.meaning, evidence: [{ kind: "alert", id: rec.id, label: rec.id }, ...evidence.slice(0, 4)] });
  }

  for (const a of active.values()) {
    if (seen.has(a.dedupeKey)) continue;
    if (isBlind(blind, a.ruleId, a.target)) continue; // not looked at this round: leave it as it is
    a.clearRounds = (a.clearRounds ?? 0) + 1;
    if (a.clearRounds < CLEAR_ROUNDS) {
      saveAlert(a);
      continue;
    }
    const text = `Cleared automatically: the condition was no longer seen at ${at.slice(11, 16)} IST.`;
    Object.assign(a, { state: "resolved", resolvedAt: at, resolvedBy: "auto", note: text, noteHistory: [...(a.noteHistory ?? []), { at, text, by: AUTO }] });
    saveAlert(a);
    resolved.push(a.id);
    const ev: Evidence[] = [{ kind: "alert", id: a.id, label: a.id }];
    addNotification({ at, kind: "alert_resolved", severity: "info", title: `Resolved: ${a.title}`, body: text, evidence: ev });
    if (a.incidentId) appendIncidentEvent(a.incidentId, { at, kind: "alert", text: `Alert ${a.id} cleared automatically: ${a.title}`, evidence: ev });
  }

  // A held alert is released once its condition has gone away
  for (const h of held) {
    if (seen.has(h.dedupeKey) || isBlind(blind, h.ruleId, h.target)) continue;
    h.hold = false;
    saveAlert(h);
  }
  return { fired, resolved };
}

/** Opens or extends auto incidents for long-open critical alerts; moves cleared ones to monitoring. */
export function autoIncidents(now: number, levels: Pick<RuleLevels, "autoIncidentMinutes">): Pick<DetectResult, "incidentsOpened" | "incidentsMonitoring"> {
  const at = ist(now);
  const opened: string[] = [];
  const monitoring: string[] = [];
  const active = activeAlertRecords();
  const due = active
    .filter((a) => a.severity === "critical" && !a.incidentId && now - ms(a.criticalSince ?? a.firedAt) >= levels.autoIncidentMinutes * 60_000)
    .sort((a, b) => ms(a.firedAt) - ms(b.firedAt));

  for (const alert of due) {
    const incidents = incidentRecords({ unresolved: true });
    const byKey = new Map(alertRecords().map((a) => [a.id, a.dedupeKey]));
    // Same problem as an incident still being watched: it is back, so that incident is open again
    let incident =
      incidents.find((i) => i.openedBy === "auto" && i.status !== "resolved" && i.alertIds.some((id) => byKey.get(id) === alert.dedupeKey)) ??
      incidents.find((i) => i.openedBy === "auto" && i.status === "open") ??
      null;
    if (incident) {
      if (incident.status === "monitoring") {
        incident.timeline.push({ at, kind: "status", text: `Status changed from monitoring to open: ${alert.title} is back` });
        incident.status = "open";
      }
      linkAlert(incident, alert.id, at);
      saveIncident(incident);
      continue;
    }
    const mins = Math.round((now - ms(alert.criticalSince ?? alert.firedAt)) / 60_000);
    incident = insertIncident({
      title: alert.title,
      severity: "critical",
      status: "open",
      openedAt: at,
      resolvedAt: null,
      openedBy: "auto",
      systems: [...alert.systems],
      impact: { storiesDelayed: 0, postsMissed: 0, minutesBlind: 0, summary: `${alert.title} (critical for ${mins} min)` },
      affectedSlugs: [],
      timeline: [{ at, kind: "status", text: `Opened automatically: critical alert ${alert.id} unresolved for ${mins} min` }],
      rootCause: "",
      fix: "",
      followUps: [],
      alertIds: [],
    } satisfies Omit<IncidentRecord, "id">);
    linkAlert(incident, alert.id, at);
    saveIncident(incident);
    opened.push(incident.id);
    addNotification({
      at,
      kind: "incident_opened",
      severity: "critical",
      title: `${incident.id} opened: ${incident.title}`,
      body: `Opened automatically after ${mins} min. ${alert.runbook.meaning}`,
      evidence: [{ kind: "incident", id: incident.id, label: incident.id }, { kind: "alert", id: alert.id, label: alert.id }],
    });
  }

  // An open incident whose alerts are all resolved is watched for a while (monitoring)
  const stillActive = new Set(activeAlertRecords().map((a) => a.id));
  for (const i of incidentRecords({ unresolved: true })) {
    if (i.status !== "open" || !i.alertIds.length || i.alertIds.some((id) => stillActive.has(id))) continue;
    i.status = "monitoring";
    i.timeline.push({ at, kind: "status", text: "Status changed from open to monitoring: all its alerts are resolved" });
    saveIncident(i);
    monitoring.push(i.id);
  }
  return { incidentsOpened: opened, incidentsMonitoring: monitoring };
}

/** One detection round: rules → alerts → incidents. */
export function runDetection(ctx: DetectContext): DetectResult {
  const { findings, blind } = evaluate(ctx);
  return { ...applyFindings(findings, ctx.now, blind), ...autoIncidents(ctx.now, ctx.levels) };
}

export type { AlertRecord };
