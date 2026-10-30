import type { Incident, IncidentCreate, IncidentPatch, IncidentStatus, IncidentSummary } from "@/types/control";
import type { IncidentRecord } from "@/data/incidents";
import { SYSTEM_BY_ID } from "@/data/systems";
import { hhmm } from "@/data/time";
import { withDraft } from "./ai/summary";
import { badRequest, conflict, notFound } from "./http";
import { addNotification, liveNow, recordAction, store } from "./store";
import { isRecord, oneOf, SEVERITIES, singleLine, systemList, text } from "./validate";

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

export function listIncidents(): IncidentSummary[] {
  return [...store().incidents].sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt)).map(toSummary);
}

function record(id: string): IncidentRecord {
  const found = store().incidents.find((i) => i.id === id.toUpperCase());
  if (!found) throw notFound(`There is no incident ${id}.`);
  return found;
}

export function getIncident(id: string): Incident {
  return withDraft(record(id), liveNow());
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
    const known = new Set(store().alerts.map((a) => a.id));
    const bad = (body.alertIds as string[]).filter((a) => !known.has(a));
    if (bad.length) throw badRequest(`Unknown alert: ${bad.join(", ")}.`);
    alertIds = [...new Set(body.alertIds as string[])];
    const taken = store().alerts.filter((a) => alertIds!.includes(a.id) && a.incidentId);
    if (taken.length) {
      throw conflict(taken.map((a) => `Alert ${a.id} already belongs to ${a.incidentId}.`).join(" ") + " Add a note there instead, or leave it out.");
    }
  }
  return { title, severity, systems: [...new Set(systems)], alertIds };
}

export function createIncident(input: IncidentCreate, by: string): Incident {
  const s = store();
  const now = liveNow();
  const id = `INC-${String(s.nextIncident++).padStart(4, "0")}`;
  const alertIds = input.alertIds ?? [];
  const incident: IncidentRecord = {
    id,
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
    alertIds,
  };
  for (const alertId of alertIds) {
    const alert = s.alerts.find((a) => a.id === alertId)!;
    alert.incidentId = id;
    incident.timeline.push({ at: now, kind: "alert", text: `Linked alert: ${alert.title}`, evidence: [{ kind: "alert", id: alert.id, label: alert.id }] });
    for (const ev of alert.evidence) {
      if (ev.kind === "trace" && !incident.affectedSlugs.includes(ev.id)) incident.affectedSlugs.push(ev.id);
    }
  }
  s.incidents.push(incident);
  const ev = [{ kind: "incident" as const, id, label: id }];
  recordAction({ at: now, user: by, kind: "incident_opened", text: `Opened ${id}: ${incident.title}`, evidence: ev });
  addNotification({ at: now, kind: "incident_opened", severity: incident.severity, title: `${id} opened: ${incident.title}`, body: `Opened by ${by}`, evidence: ev });
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
  const now = liveNow();
  if (patch.status && patch.status !== i.status) {
    i.timeline.push({ at: now, kind: "status", text: `Status changed from ${i.status} to ${patch.status} by ${by}` });
    if (patch.status === "resolved") {
      const ev = [{ kind: "incident" as const, id: i.id, label: i.id }];
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
  return withDraft(i, now);
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
  const name = (sys: string) => SYSTEM_BY_ID.get(sys as never)?.name ?? sys;
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