// Today's notifications as they stood at 16:30, derived from the alerts, incidents, code changes,
// unusual logins, the nightly backup and the daily report. Older than noon counts as read.
import type { Notification } from "@/types/control";
import { seedAlerts } from "./alerts";
import { CHANGES } from "./changes";
import { seedIncidents } from "./incidents";
import { LOGINS } from "./logins";
import { at, dateOf, ms, TODAY, YESTERDAY } from "./time";
import { BACKUP } from "./world";

type Draft = Omit<Notification, "id" | "read">;

export function seedNotifications(): Notification[] {
  const items: Draft[] = [];

  items.push({
    at: at("00:05"),
    kind: "report_ready",
    severity: "info",
    title: "Daily report for 26 Oct is ready",
    body: "Open Reports to read it.",
    evidence: [],
  });
  items.push({
    at: BACKUP.finishedAt,
    kind: "backup",
    severity: "info",
    title: "Nightly backup OK",
    body: `samvadia ${BACKUP.samvadiaMb} MB and socia ${BACKUP.sociaMb} MB written to ${BACKUP.dir}; keeping ${BACKUP.keep}.`,
    evidence: [{ kind: "system", id: "backups", label: "Backups" }],
  });

  for (const a of seedAlerts()) {
    items.push({ at: a.firedAt, kind: "alert_fired", severity: a.severity, title: a.title, body: a.runbook.meaning, evidence: [{ kind: "alert", id: a.id, label: a.id }] });
    if (a.resolvedAt) {
      items.push({ at: a.resolvedAt, kind: "alert_resolved", severity: "info", title: `Resolved: ${a.title}`, body: a.note ?? undefined, evidence: [{ kind: "alert", id: a.id, label: a.id }] });
    }
  }

  for (const i of seedIncidents().filter((x) => dateOf(x.openedAt) === TODAY)) {
    const ev = [{ kind: "incident" as const, id: i.id, label: i.id }];
    items.push({ at: i.openedAt, kind: "incident_opened", severity: i.severity, title: `${i.id} opened: ${i.title}`, body: i.impact.summary, evidence: ev });
    if (i.resolvedAt) items.push({ at: i.resolvedAt, kind: "incident_resolved", severity: "info", title: `${i.id} resolved`, body: i.fix || undefined, evidence: ev });
  }

  for (const c of CHANGES.filter((x) => dateOf(x.at) === TODAY)) {
    items.push({
      at: c.at,
      kind: "code_change",
      severity: "info",
      title: `${c.repo}: ${c.summary}`,
      body: `${c.author}, ${c.files.length} ${c.files.length === 1 ? "file" : "files"}`,
      evidence: c.system === "sentry" ? [] : [{ kind: "system", id: c.system, label: c.repo }],
    });
  }

  // One notification per unusual sign-in worth a look; a burst of failures shows once, when it locked.
  for (const e of LOGINS[TODAY] ?? []) {
    const worth =
      e.flags.includes("off_hours") ||
      e.result === "locked" ||
      e.result === "unknown_user" ||
      (e.result === "success" && e.flags.includes("new_ip"));
    if (!worth) continue;
    const what =
      e.result === "locked" ? `${e.user} locked after repeated failed logins` :
      e.result === "unknown_user" ? `Login tried with unknown user "${e.user}"` :
      e.flags.includes("off_hours") ? `${e.user} signed in at an odd hour` :
      `${e.user} signed in from a new IP`;
    items.push({
      at: e.at,
      kind: "login_unusual",
      severity: e.result === "success" ? "info" : "warning",
      title: `${what} (${e.app})`,
      body: `From ${e.ip}, ${e.userAgent}`,
      evidence: [{ kind: "login", id: e.id, label: e.id }],
    });
  }

  const noon = ms(at("12:00"));
  return items
    .filter((n) => dateOf(n.at) === TODAY || dateOf(n.at) === YESTERDAY)
    .sort((a, b) => ms(a.at) - ms(b.at))
    .map((n, i) => ({ ...n, id: `ntf-${String(i + 1).padStart(3, "0")}`, read: ms(n.at) < noon }))
    .reverse();
}
