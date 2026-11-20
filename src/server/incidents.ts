// Incidents, stored in sentry.local.db. People open them by hand; the detection engine opens one
// automatically (openedBy "auto") when a critical alert stays open, and moves it to monitoring
// once all its alerts are resolved (detect/engine.ts). Every change is written at once.
import type { Evidence, Incident, IncidentCreate, IncidentEvent, IncidentPatch, IncidentStatus, IncidentSummary } from "@/types/control";
import { withDraft } from "./ai/summary";
import { activeAlertRecords, alertRecords, getAlertRecord, saveAlert } from "./alerts";
import { systemName } from "./catalog";
import { db, transaction } from "./db";
import { badRequest, conflict, notFound } from "./http";
import { addNotification } from "./notifications";
import { recordAction } from "./store";
import { hhmm, ms, nowIso } from "./time";
import { isRecord, oneOf, SEVERITIES, singleLine, systemList, text } from "./validate";

export type IncidentRecord = Omit<Incident, "aiDraft">;

const STATUSES: IncidentStatus[] = ["open", "monitoring", "resolved"];

export function toSummary(i: IncidentRecord): IncidentSummary {
  return {
    id: i.id,
    title: i.title,
    severity: i.severity,
    status: i.status,
    openedAt: i.openedAt,
    resolvedAt: i.resolvedAt ?? null,
    systems: i.systems,
    affectedSlugs: i.affectedSlugs,
    impactSummary: i.impact.summary,
  };
}

function parse(data: string): IncidentRecord | null {
  try {
    return JSON.parse(data) as IncidentRecord;
  } catch {
    return null;
  }
}

/** Incidents, newest first: every one (capped), or only those not resolved yet. */
export function incidentRecords({ unresolved = false, limit = 500 }: { unresolved?: boolean; limit?: number } = {}): IncidentRecord[] {
  const sql = `SELECT data FROM incidents ${unresolved ? "WHERE status != 'resolved'" : ""} ORDER BY opened_ms DESC, seq DESC LIMIT ?`;
  return (db().prepare(sql).all(limit) as { data: string }[]).map((r) => parse(r.data)).filter((i): i is IncidentRecord => i !== null);
}

/** Drops resolved incidents opened more than `days` ago. */
export function pruneIncidents(now: number, days = 180): number {
  return Number(db().prepare("DELETE FROM incidents WHERE status = 'resolved' AND opened_ms < ?").run(now - days * 86_400_000).changes);
}

export function saveIncident(i: IncidentRecord): void {
  db().prepare("UPDATE incidents SET status = ?, data = ? WHERE id = ?").run(i.status, JSON.stringify(i), i.id);
}

/** Stores a new incident with the next id (INC-0001, ...). */
export function insertIncident(i: Omit<IncidentRecord, "id">): IncidentRecord {
  return transaction((d) => {
    const seq = ((d.prepare("SELECT max(seq) AS s FROM incidents").get() as { s: number | null }).s ?? 0) + 1;
    const rec = { ...i, id: `INC-${String(seq).padStart(4, "0")}` } as IncidentRecord;
    d.prepare("INSERT INTO incidents (id, seq, status, opened_ms, data) VALUES (?, ?, ?, ?, ?)").run(rec.id, seq, rec.status, ms(rec.openedAt), JSON.stringify(rec));
    return rec;
  });
}

/** Adds one line to an incident's timeline (no-op when the incident is gone). */
export function appendIncidentEvent(id: string, event: IncidentEvent): void {
  const row = db().prepare("SELECT data FROM incidents WHERE id = ?").get(id) as { data: string } | undefined;
  const i = row ? parse(row.data) : null;
  if (!i) return;
  i.timeline.push(event);
  saveIncident(i);
}

export function listIncidents(): IncidentSummary[] {
  return incidentRecords().map(toSummary);
}

/** The incidents as they stood at moment t (replay): opened by then, timeline cut at t. */
export function incidentsAt(t: number): IncidentRecord[] {
  return incidentRecords()
    .filter((i) => ms(i.openedAt) <= t)
    .map((i) => {
      const timeline = i.timeline.filter((e) => ms(e.at) <= t);
      // The status then: the last status line before t that names one, else open
      let status: IncidentStatus = "open";
      for (const e of timeline) {
        if (e.kind !== "status") continue;
        const m = / to (open|monitoring|resolved)\b/.exec(e.text);
        if (m) status = m[1] as IncidentStatus;
      }
      const resolved = !!i.resolvedAt && ms(i.resolvedAt) <= t;
      if (resolved) status = "resolved";
      return { ...i, timeline, status, resolvedAt: resolved ? i.resolvedAt : null };
    });
}

function record(id: string): IncidentRecord {
  const row = db().prepare("SELECT data FROM incidents WHERE id = ?").get(id.toUpperCase()) as { data: string } | undefined;
  const found = row ? parse(row.data) : null;
  if (!found) throw notFound(`There is no incident ${id}.`);
  return found;
}

export function getIncidentRecord(id: string): IncidentRecord {
  return record(id);
}

export function getIncident(id: string): Incident {
  return withDraft(record(id), nowIso());
}

export function parseIncidentCreate(body: unknown): IncidentCreate {
  if (!isRecord(body)) throw badRequest('Send a JSON object like {"title": "...", "severity": "warning", "systems": ["ftp"]}.');
  const title = singleLine(body.title, "title", 200, { required: true })!;
  const severity = oneOf(body.severity, SEVERITIES, "severity");
  const systems = systemList(body.systems, "systems");
  if (!systems.length) throw badRequest("systems needs at least one system id.");
  let alertIds: string[] | undefined;
  if (body.alertIds !== undefined) {
    if (!Array.isArray(body.alertIds) || body.alertIds.some((a) => typeof a !== "string")) {
      throw badRequest("alertIds must be a list of alert ids.");
    }
    const all = alertRecords();
    const known = new Set(all.map((a) => a.id));
    const bad = (body.alertIds as string[]).filter((a) => !known.has(a));
    if (bad.length) throw badRequest(`Unknown alert: ${bad.join(", ")}.`);
    alertIds = [...new Set(body.alertIds as string[])];
    const taken = all.filter((a) => alertIds!.includes(a.id) && a.incidentId);
    if (taken.length) {
      throw conflict(taken.map((a) => `Alert ${a.id} already belongs to ${a.incidentId}.`).join(" ") + " Add a note there instead, or leave it out.");
    }
  }
  return { title, severity, systems: [...new Set(systems)], alertIds };
}

/** Links an alert to an incident (the alert is saved; the caller saves the incident). */
export function linkAlert(incident: IncidentRecord, alertId: string, at: string): void {
  const alert = getAlertRecord(alertId);
  alert.incidentId = incident.id;
  saveAlert(alert);
  if (!incident.alertIds.includes(alert.id)) incident.alertIds.push(alert.id);
  for (const s of alert.systems) if (!incident.systems.includes(s)) incident.systems.push(s);
  incident.timeline.push({ at, kind: "alert", text: `Linked alert: ${alert.title}`, evidence: [{ kind: "alert", id: alert.id, label: alert.id }] });
  for (const ev of alert.evidence) {
    if (ev.kind === "trace" && !incident.affectedSlugs.includes(ev.id)) incident.affectedSlugs.push(ev.id);
  }
  incident.impact.storiesDelayed = incident.affectedSlugs.length;
}

export function createIncident(input: IncidentCreate, by: string): Incident {
  const now = nowIso();
  const incident = insertIncident({
    title: input.title,
    severity: input.severity,
    status: "open",
    openedAt: now,
    resolvedAt: null,
    openedBy: "manual",
    systems: input.systems,
    impact: { storiesDelayed: 0, postsMissed: 0, minutesBlind: 0, summary: "Not assessed yet" },
    affectedSlugs: [],
    timeline: [{ at: now, kind: "status", text: `Incident opened by ${by}` }],
    rootCause: "",
    fix: "",
    followUps: [],
    alertIds: [],
  });
  for (const alertId of input.alertIds ?? []) linkAlert(incident, alertId, now);
  saveIncident(incident);
  const ev: Evidence[] = [{ kind: "incident", id: incident.id, label: incident.id }];
  recordAction({ at: now, user: by, kind: "incident_opened", text: `Opened ${incident.id}: ${incident.title}`, evidence: ev });
  addNotification({ at: now, kind: "incident_opened", severity: incident.severity, title: `${incident.id} opened: ${incident.title}`, body: `Opened by ${by}`, evidence: ev });
  return withDraft(incident, now);
}

export function parseIncidentPatch(body: unknown): IncidentPatch {
  if (!isRecord(body)) throw badRequest('Send a JSON object, for example {"status": "monitoring"}.');
  const patch: IncidentPatch = {};
  if (body.status !== undefined) patch.status = oneOf(body.status, STATUSES, "status");
  if (body.rootCause !== undefined) patch.rootCause = text(body.rootCause, "rootCause", 2000);
  if (body.fix !== undefined) patch.fix = text(body.fix, "fix", 2000);
  if (body.note !== undefined) patch.note = text(body.note, "note", 1000, { required: true });
  if (body.followUps !== undefined) {
    if (!Array.isArray(body.followUps) || body.followUps.length > 50) throw badRequest("followUps must be a list (at most 50).");
    patch.followUps = body.followUps.map((f, n) => {
      if (!isRecord(f) || typeof f.done !== "boolean") throw badRequest(`followUps[${n}] needs text and done (true or false).`);
      return { text: singleLine(f.text, `followUps[${n}].text`, 300, { required: true })!, done: f.done };
    });
  }
  if (!Object.keys(patch).length) {
    throw badRequest("Nothing to change. Send one of: status, rootCause, fix, followUps, note.");
  }
  return patch;
}

export function patchIncident(id: string, patch: IncidentPatch, by: string): Incident {
  const i = record(id);
  const now = nowIso();
  if (patch.status && patch.status !== i.status) {
    i.timeline.push({ at: now, kind: "status", text: `Status changed from ${i.status} to ${patch.status} by ${by}` });
    if (patch.status === "resolved") {
      const ev: Evidence[] = [{ kind: "incident", id: i.id, label: i.id }];
      recordAction({ at: now, user: by, kind: "incident_resolved", text: `Resolved ${i.id}: ${i.title}`, evidence: ev });
      addNotification({ at: now, kind: "incident_resolved", severity: "info", title: `${i.id} resolved`, body: [`By ${by}.`, patch.fix ?? i.fix].filter(Boolean).join(" "), evidence: ev });
    }
    i.status = patch.status;
    i.resolvedAt = patch.status === "resolved" ? now : null;
  }
  if (patch.rootCause !== undefined) i.rootCause = patch.rootCause;
  if (patch.fix !== undefined) i.fix = patch.fix;
  if (patch.followUps) i.followUps = patch.followUps;
  if (patch.note) {
    i.timeline.push({ at: now, kind: "note", text: `${by}: ${patch.note}` });
    recordAction({ at: now, user: by, kind: "incident_note", text: `Note on ${i.id}: ${patch.note}`, evidence: [{ kind: "incident", id: i.id, label: i.id }] });
  }
  saveIncident(i);
  return withDraft(i, now);
}

/** Unresolved alerts linked to an incident. */
export function openAlertsOf(i: IncidentRecord) {
  return activeAlertRecords().filter((a) => a.incidentId === i.id);
}

// Text from people (titles, notes, causes) must not turn into headings, links or raw HTML in the report.
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// One line inside Markdown: newlines folded, HTML and Markdown punctuation escaped.
function inline(s: string): string {
  return escapeHtml(s.replace(/\s*[\r\n]+\s*/g, " ")).replace(/([\\`*_[\]#|!~])/g, "\\$1");
}

// Free text as a quoted block. Each line is escaped so it cannot start a heading, list, quote or rule.
function block(s: string): string {
  return s
    .split(/\r?\n/)
    .map((line) => "> " + escapeHtml(line).replace(/([\\`*_[\]|!~])/g, "\\$1").replace(/^(\s*)([#>=+-])/, "$1\\$2").replace(/^(\s*\d+)([.)])/, "$1\\$2"))
    .join("\n");
}

// A clean report someone can paste into an email or the wiki.
export function incidentMarkdown(id: string): { filename: string; body: string } {
  const i = getIncident(id);
  const name = (sys: string) => systemName(sys);
  const lines = [
    `# ${i.id}: ${inline(i.title)}`,
    "",
    `- **Severity:** ${i.severity}`,
    `- **Status:** ${i.status}`,
    `- **Opened:** ${i.openedAt} (${i.openedBy === "auto" ? "automatically" : "by hand"})`,
    `- **Resolved:** ${i.resolvedAt ?? "not yet"}`,
    `- **Systems:** ${i.systems.map(name).map(inline).join(", ")}`,
    "",
    "## Impact",
    "",
    block(i.impact.summary),
    "",
    `- Stories delayed: ${i.impact.storiesDelayed}`,
    `- Posts missed: ${i.impact.postsMissed}`,
    `- Minutes blind: ${i.impact.minutesBlind}`,
    ...(i.affectedSlugs.length ? ["", "Affected stories:", "", ...i.affectedSlugs.map((s) => `- ${inline(s)}`)] : []),
    "",
    "## Timeline (IST)",
    "",
    ...i.timeline.map((e) => `- **${hhmm(e.at)}** (${e.kind}) ${inline(e.text)}`),
    "",
    "## Root cause",
    "",
    i.rootCause ? block(i.rootCause) : "_Not known yet._",
    "",
    "## Fix",
    "",
    i.fix ? block(i.fix) : "_Not decided yet._",
    "",
    "## Follow-ups",
    "",
    ...(i.followUps.length ? i.followUps.map((f) => `- [${f.done ? "x" : " "}] ${inline(f.text)}`) : ["_None._"]),
    "",
    "---",
    "",
    `First draft (${i.aiDraft.model}):`,
    "",
    block(i.aiDraft.text),
    "",
  ];
  return { filename: `${i.id}.md`, body: lines.join("\n") };
}