import type { Alert, AlertPatch, AlertState } from "@/types/control";
import { badRequest, conflict, notFound } from "./http";
import { addNotification, liveNow, recordAction, store } from "./store";
import { isRecord, oneOf, text } from "./validate";

const STATES: AlertState[] = ["open", "acked", "resolved"];

export function listAlerts(state?: AlertState): Alert[] {
  return store()
    .alerts.filter((a) => !state || a.state === state)
    .sort((a, b) => Date.parse(b.firedAt) - Date.parse(a.firedAt));
}

export function parseAlertState(value: string | null): AlertState | undefined {
  if (value === null || value === "") return undefined;
  return oneOf(value, STATES, "state");
}

export function getAlert(id: string): Alert {
  const alert = store().alerts.find((a) => a.id === id);
  if (!alert) throw notFound(`There is no alert ${id}.`);
  return alert;
}

export function parseAlertPatch(body: unknown): AlertPatch {
  if (!isRecord(body)) throw badRequest('Send a JSON object like {"action": "ack"}.');
  const action = oneOf(body.action, ["ack", "resolve", "reopen", "note"] as const, "action");
  const note = text(body.note, "note", 1000, { required: action === "note" });
  return { action, note };
}

// Ack and resolve stamp times. If the alert belongs to an incident, the incident timeline
// gets a line too, but the incident's own status never changes here.
// `by` is the signed-in username; it names who did it in notes, timelines and notifications.
export function patchAlert(id: string, patch: AlertPatch, by: string): Alert {
  const alert = getAlert(id);
  const now = liveNow();
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
        event = `Alert ${alert.id} resolved by ${by}`;
      }
      break;
    case "reopen":
      if (alert.state !== "open") {
        alert.state = "open";
        alert.ackedAt = null;
        alert.resolvedAt = null;
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

  // Actions feed the profile; resolve and reopen also notify. Acks have no notification kind.
  if (alert.state !== before) {
    const kind = alert.state === "acked" ? "ack" : alert.state === "resolved" ? "resolve" : "reopen";
    recordAction({ at: now, user: by, kind, text: `${kind === "ack" ? "Acked" : kind === "resolve" ? "Resolved" : "Reopened"} ${alert.id}: ${alert.title}`, evidence: ev });
    const body = [`By ${by}.`, patch.note].filter(Boolean).join(" ");
    if (alert.state === "resolved") addNotification({ at: now, kind: "alert_resolved", severity: "info", title: `Resolved: ${alert.title}`, body, evidence: ev });
    if (alert.state === "open") addNotification({ at: now, kind: "alert_fired", severity: alert.severity, title: `Reopened: ${alert.title}`, body, evidence: ev });
  }
  if (patch.note) recordAction({ at: now, user: by, kind: "note", text: `Note on ${alert.id}: ${patch.note}`, evidence: ev });

  if (event && alert.incidentId) {
    const incident = store().incidents.find((i) => i.id === alert.incidentId);
    incident?.timeline.push({ at: now, kind: "alert", text: event, evidence: [{ kind: "alert", id: alert.id, label: alert.id }] });
  }
  return alert;
}
