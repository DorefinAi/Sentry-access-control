import { preferencesOf } from "@/server/account";
import { handle, readJson } from "@/server/http";
import { listNotifications, markNotifications, parseNotificationPatch } from "@/server/notifications";
import { requireCurrent } from "@/server/session";

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
    // Read state is per person, so every signed-in role (viewers too) may mark its own notifications read
    const { session, user } = await requireCurrent(req);
    return Response.json(markNotifications(parseNotificationPatch(await readJson(req)), session.u, preferencesOf(user.prefs).notify.kinds));
  });
}
