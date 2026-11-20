// Notifications (the bell), stored in sentry.local.db so they survive a restart. They are written
// by real events only: alerts firing and clearing (detect/engine.ts, alerts.ts), incidents opening
// and closing, and team or settings changes. Read state is per person.
import type { Notification, NotificationKind, NotificationList, NotificationPatch } from "@/types/control";
import { db, transaction } from "./db";
import { cleanEvidence } from "./evidence";
import { badRequest } from "./http";
import { nowMs } from "./time";
import { isRecord } from "./validate";

const KEEP = 5000; // newest kept; older ones are dropped
const LIST_MAX = 500;

type Stored = Omit<Notification, "read"> & { readBy: string[] };

function readRow(data: string): Stored | null {
  try {
    return JSON.parse(data) as Stored;
  } catch {
    return null;
  }
}

export function addNotification(n: Omit<Notification, "id" | "read">): string {
  return transaction((d) => {
    const seq = ((d.prepare("SELECT max(seq) AS s FROM notifications").get() as { s: number | null }).s ?? 0) + 1;
    const id = `ntf-${String(seq).padStart(4, "0")}`;
    const row: Stored = { ...n, id, evidence: cleanEvidence(n.evidence), readBy: [] };
    d.prepare("INSERT INTO notifications (id, seq, at_ms, data) VALUES (?, ?, ?, ?)").run(id, seq, Date.parse(n.at) || nowMs(), JSON.stringify(row));
    if (seq % 100 === 0) d.prepare("DELETE FROM notifications WHERE seq <= ?").run(seq - KEEP);
    return id;
  });
}

function all(): Stored[] {
  const rows = db().prepare("SELECT data FROM notifications ORDER BY at_ms DESC, seq DESC LIMIT ?").all(LIST_MAX) as { data: string }[];
  return rows.map((r) => readRow(r.data)).filter((n): n is Stored => n !== null);
}

// kinds: what this user chose to see in the bell (null = everything).
export function listNotifications(user: string, kinds: NotificationKind[] | null = null): NotificationList {
  const items = all()
    .filter((n) => !kinds || kinds.includes(n.kind))
    .map(({ readBy, ...rest }): Notification => ({ ...rest, read: readBy.includes(user) }));
  return { unread: items.filter((n) => !n.read).length, items };
}

export function parseNotificationPatch(body: unknown): NotificationPatch {
  if (!isRecord(body)) throw badRequest('Send {"ids": ["ntf-0001"]} or {"all": true}.');
  const patch: NotificationPatch = {};
  if (body.all !== undefined) {
    if (typeof body.all !== "boolean") throw badRequest("all must be true or false.");
    patch.all = body.all;
  }
  if (body.ids !== undefined) {
    if (!Array.isArray(body.ids) || body.ids.length > 500 || body.ids.some((id) => typeof id !== "string")) {
      throw badRequest("ids must be a list of notification ids (at most 500).");
    }
    const ids = body.ids as string[];
    const known = new Set((db().prepare(`SELECT id FROM notifications WHERE id IN (${ids.map(() => "?").join(", ") || "''"})`).all(...ids) as { id: string }[]).map((r) => r.id));
    const bad = ids.filter((id) => !known.has(id));
    if (bad.length) throw badRequest(`Unknown notification: ${bad.slice(0, 5).join(", ")}.`);
    patch.ids = ids;
  }
  if (!patch.all && !patch.ids?.length) throw badRequest('Nothing to mark. Send {"ids": [...]} or {"all": true}.');
  return patch;
}

// Marks read for this user only; teammates keep their own unread counts.
export function markNotifications(patch: NotificationPatch, user: string, kinds: NotificationKind[] | null = null): NotificationList {
  const ids = new Set(patch.ids ?? []);
  transaction((d) => {
    const rows = (
      patch.all || !ids.size
        ? d.prepare("SELECT id, data FROM notifications ORDER BY at_ms DESC LIMIT ?").all(KEEP)
        : d.prepare(`SELECT id, data FROM notifications WHERE id IN (${[...ids].map(() => "?").join(", ")})`).all(...ids)
    ) as { id: string; data: string }[];
    const update = d.prepare("UPDATE notifications SET data = ? WHERE id = ?");
    for (const r of rows) {
      if (!patch.all && !ids.has(r.id)) continue;
      const n = readRow(r.data);
      if (!n || n.readBy.includes(user)) continue;
      n.readBy.push(user);
      update.run(JSON.stringify(n), r.id);
    }
  });
  return listNotifications(user, kinds);
}
