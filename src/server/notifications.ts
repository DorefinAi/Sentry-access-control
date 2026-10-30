import type { Notification, NotificationKind, NotificationList, NotificationPatch } from "@/types/control";
import { badRequest } from "./http";
import { store, type StoredNotification } from "./store";
import { isRecord } from "./validate";

function forUser(n: StoredNotification, user: string): Notification {
  const { seededRead, readBy, ...rest } = n;
  return { ...rest, read: seededRead || readBy.includes(user) };
}

// kinds: what this user chose to see in the bell (null = everything).
export function listNotifications(user: string, kinds: NotificationKind[] | null = null): NotificationList {
  const items = store()
    .notificationLog.filter((n) => !kinds || kinds.includes(n.kind))
    .map((n) => forUser(n, user))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return { unread: items.filter((n) => !n.read).length, items };
}

export function parseNotificationPatch(body: unknown): NotificationPatch {
  if (!isRecord(body)) throw badRequest('Send {"ids": ["ntf-001"]} or {"all": true}.');
  const patch: NotificationPatch = {};
  if (body.all !== undefined) {
    if (typeof body.all !== "boolean") throw badRequest("all must be true or false.");
    patch.all = body.all;
  }
  if (body.ids !== undefined) {
    if (!Array.isArray(body.ids) || body.ids.length > 500 || body.ids.some((id) => typeof id !== "string")) {
      throw badRequest("ids must be a list of notification ids (at most 500).");
    }
    const known = new Set(store().notificationLog.map((n) => n.id));
    const bad = (body.ids as string[]).filter((id) => !known.has(id));
    if (bad.length) throw badRequest(`Unknown notification: ${bad.slice(0, 5).join(", ")}.`);
    patch.ids = body.ids as string[];
  }
  if (!patch.all && !patch.ids?.length) throw badRequest('Nothing to mark. Send {"ids": [...]} or {"all": true}.');
  return patch;
}

// Marks read for this user only; teammates keep their own unread counts.
export function markNotifications(patch: NotificationPatch, user: string, kinds: NotificationKind[] | null = null): NotificationList {
  const ids = new Set(patch.ids ?? []);
  for (const n of store().notificationLog) {
    if ((patch.all || ids.has(n.id)) && !n.readBy.includes(user)) n.readBy.push(user);
  }
  return listNotifications(user, kinds);
}
