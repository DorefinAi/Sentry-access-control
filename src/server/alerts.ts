// Alerts, stored in sentry.local.db. The detection engine (detect/engine.ts) opens, refreshes and
// auto-resolves them; people ack, resolve, reopen and add notes here. Every change is written to
// the database at once, so a restart keeps the full history.
import type { Alert, AlertPatch, AlertState } from "@/types/control";
import { db, transaction } from "./db";
import { cleanEvidence } from "./evidence";
import { badRequest, conflict, notFound } from "./http";
import { appendIncidentEvent } from "./incidents";
import { addNotification } from "./notifications";
import { recordAction } from "./store";
import { ist, ms, nowIso } from "./time";
import { isRecord, oneOf, text } from "./validate";

const STATES: AlertState[] = ["open", "acked", "resolved"];
const LIST_MAX = 1000;

/** An alert as stored: the API shape plus what the engine needs to find it again. */
export interface AlertRecord extends Alert {
  target: string; // what the rule looked at: a system id, a process, a check id...
  dedupeKey: string; // ruleId + target: at most one unresolved alert per key
  resolvedBy?: string | null; // "auto" or the username
  hold?: boolean; // resolved by a person while the condition was still there: do not fire again until it clears
  criticalSince?: string | null; // when it became critical (auto incidents count from here)
  clearRounds?: number; // detection rounds in a row without the finding (auto-resolve after 3)
}

export function toAlert(r: AlertRecord): Alert {
  const alert: Alert & Partial<Omit<AlertRecord, keyof Alert>> = { ...r };
  for (const k of ["target", "dedupeKey", "resolvedBy", "hold", "criticalSince", "clearRounds"] as const) delete alert[k];
  return { ...alert, evidence: cleanEvidence(alert.evidence) };
}

function parse(data: string): AlertRecord | null {
  try {
    return JSON.parse(data) as AlertRecord;
  } catch {
    return null;
  }
}

function rows(sql: string, ...params: unknown[]): AlertRecord[] {
  return (db().prepare(sql).all(...params) as { data: string }[]).map((r) => parse(r.data)).filter((a): a is AlertRecord => a !== null);
}

/** Every stored alert, newest first (capped). */
export function alertRecords(): AlertRecord[] {
  return rows("SELECT data FROM alerts ORDER BY fired_ms DESC, seq DESC LIMIT ?", LIST_MAX);
}

/** Alerts not resolved yet (open or acked). */
export function activeAlertRecords(): AlertRecord[] {
  return rows("SELECT data FROM alerts WHERE state != 'resolved' ORDER BY fired_ms DESC");
}

/** Resolved by a person while the condition still held (see AlertRecord.hold). */
export function heldAlertRecords(): AlertRecord[] {
  return rows("SELECT data FROM alerts WHERE state = 'resolved' AND hold = 1");
}

export function saveAlert(a: AlertRecord): void {
  db().prepare("UPDATE alerts SET state = ?, hold = ?, data = ? WHERE id = ?").run(a.state, a.hold ? 1 : 0, JSON.stringify(a), a.id);
}

/** Stores a new alert and returns it with its id (ALR-0001, ...). */
export function insertAlert(a: Omit<AlertRecord, "id">): AlertRecord {
  return transaction((d) => {
    const seq = ((d.prepare("SELECT max(seq) AS s FROM alerts").get() as { s: number | null }).s ?? 0) + 1;
    const rec: AlertRecord = { ...a, id: `ALR-${String(seq).padStart(4, "0")}` } as AlertRecord;
    d.prepare("INSERT INTO alerts (id, seq, dedupe_key, state, fired_ms, hold, data) VALUES (?, ?, ?, ?, ?, ?, ?)").run(rec.id, seq, rec.dedupeKey, rec.state, ms(rec.firedAt), rec.hold ? 1 : 0, JSON.stringify(rec));
    return rec;
  });
}

export function listAlerts(state?: AlertState): Alert[] {
  return alertRecords()
    .filter((a) => !state || a.state === state)
    .map(toAlert);
}

/** The alerts as they stood at moment t (for replay): fired by then, with the state they had then. */
export function alertsAt(t: number): Alert[] {
  return rows("SELECT data FROM alerts WHERE fired_ms <= ? ORDER BY fired_ms DESC LIMIT ?", t, LIST_MAX).map((a) => {
    const resolved = !!a.resolvedAt && ms(a.resolvedAt) <= t;
    const acked = !!a.ackedAt && ms(a.ackedAt) <= t;
    return toAlert({
      ...a,
      state: resolved ? "resolved" : acked ? "acked" : "open",
      lastSeenAt: ms(a.lastSeenAt) > t ? ist(t) : a.lastSeenAt,
      ackedAt: acked ? a.ackedAt : null,
      resolvedAt: resolved ? a.resolvedAt : null,
      noteHistory: (a.noteHistory ?? []).filter((n) => ms(n.at) <= t),
      note: (a.noteHistory ?? []).filter((n) => ms(n.at) <= t).at(-1)?.text ?? null,
    });
  });
}

export function parseAlertState(value: string | null): AlertState | undefined {
  if (value === null || value === "") return undefined;
  return oneOf(value, STATES, "state");
}

function record(id: string): AlertRecord {
  const row = db().prepare("SELECT data FROM alerts WHERE id = ?").get(id.toUpperCase()) as { data: string } | undefined;
  const a = row ? parse(row.data) : null;
  if (!a) throw notFound(`There is no alert ${id}.`);
  return a;
}

export function getAlertRecord(id: string): AlertRecord {
  return record(id);
}

export function getAlert(id: string): Alert {
  return toAlert(record(id));
}

export function parseAlertPatch(body: unknown): AlertPatch {
  if (!isRecord(body)) throw badRequest('Send a JSON object like {"action": "ack"}.');
  const action = oneOf(body.action, ["ack", "resolve", "reopen", "note"] as const, "action");
  const note = text(body.note, "note", 1000, { required: action === "note" });
  return { action, note };
}

// Ack and resolve stamp times. If the alert belongs to an incident, the incident timeline
// gets a line too, but the incident's own status never changes here (the engine moves it).
// `by` is the signed-in username; it names who did it in notes, timelines and notifications.
export function patchAlert(id: string, patch: AlertPatch, by: string): Alert {
  const alert = record(id);
  const now = nowIso();
  let event: string | null = null;
  const before = alert.state;
  const ev = [{ kind: "alert" as const, id: alert.id, label: alert.id }];

  switch (patch.action) {
    case "ack":
      if (alert.state === "resolved") throw conflict("This alert is already resolved. Reopen it first if it is back.");
      if (alert.state === "open") {
        alert.state = "acked";
        alert.ackedAt = now;
        event = `Alert ${alert.id} acked by ${by}`;
      }
      break;
    case "resolve":
      if (alert.state !== "resolved") {
        alert.state = "resolved";
        alert.resolvedAt = now;
        alert.resolvedBy = by;
        // The engine fires a new alert for this rule and target only once the condition has cleared
        alert.hold = true;
        event = `Alert ${alert.id} resolved by ${by}`;
      }
      break;
    case "reopen":
      if (alert.state !== "open") {
        const clash = activeAlertRecords().find((a) => a.dedupeKey === alert.dedupeKey && a.id !== alert.id);
        if (clash) throw conflict(`${clash.id} is already open for the same thing. Work on that one instead.`);
        alert.state = "open";
        alert.ackedAt = null;
        alert.resolvedAt = null;
        alert.resolvedBy = null;
        alert.hold = false;
        alert.clearRounds = 0;
        event = `Alert ${alert.id} reopened by ${by}`;
      }
      break;
    case "note":
      break;
  }
  if (patch.note) {
    alert.note = patch.note;
    alert.noteHistory = [...(alert.noteHistory ?? []), { at: now, text: patch.note, by }];
    event = event ? `${event}: ${patch.note}` : `Note on alert ${alert.id} by ${by}: ${patch.note}`;
  }
  saveAlert(alert);

  // Actions feed the profile; resolve and reopen also notify. Acks have no notification kind.
  if (alert.state !== before) {
    const kind = alert.state === "acked" ? "ack" : alert.state === "resolved" ? "resolve" : "reopen";
    recordAction({ at: now, user: by, kind, text: `${kind === "ack" ? "Acked" : kind === "resolve" ? "Resolved" : "Reopened"} ${alert.id}: ${alert.title}`, evidence: ev });
    const body = [`By ${by}.`, patch.note].filter(Boolean).join(" ");
    if (alert.state === "resolved") addNotification({ at: now, kind: "alert_resolved", severity: "info", title: `Resolved: ${alert.title}`, body, evidence: ev });
    if (alert.state === "open") addNotification({ at: now, kind: "alert_fired", severity: alert.severity, title: `Reopened: ${alert.title}`, body, evidence: ev });
  }
  if (patch.note) recordAction({ at: now, user: by, kind: "note", text: `Note on ${alert.id}: ${patch.note}`, evidence: ev });

  if (event && alert.incidentId) appendIncidentEvent(alert.incidentId, { at: now, kind: "alert", text: event, evidence: ev });
  return toAlert(alert);
}

/** Drops resolved alerts that fired more than `days` ago (the history kept is 180 days by default). */
export function pruneAlerts(now: number, days = 180): number {
  return Number(db().prepare("DELETE FROM alerts WHERE state = 'resolved' AND hold = 0 AND fired_ms < ?").run(now - days * 86_400_000).changes);
}
