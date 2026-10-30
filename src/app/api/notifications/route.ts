import { preferencesOf } from "@/server/account";
import { handle, readJson } from "@/server/http";
import { listNotifications, markNotifications, parseNotificationPatch } from "@/server/notifications";
import { requireCurrent, requireRole } from "@/server/session";

export const dynamic = "force-dynamic";

// The bell shows only the kinds this user chose in Settings; ?all=1 shows everything.
export function GET(req: Request) {
  return handle(req, async () => {
    const { session, user } = await requireCurrent(req);
    const all = new URL(req.url).searchParams.get("all") === "1";
    return Response.json(listNotifications(session.u, all ? null : preferencesOf(user.prefs).notify.kinds));
  });
}

export function PATCH(req: Request) {
  return handle(req, async () => {
    const session = await requireRole(req, "operator");
    const { user } = (await requireCurrent(req));
    return Response.json(markNotifications(parseNotificationPatch(await readJson(req)), session.u, preferencesOf(user.prefs).notify.kinds));
  });
}
