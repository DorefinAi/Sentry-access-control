import { parsePreferencesPatch, preferencesOf, updateMyPreferences } from "@/server/account";
import { handle, readJson } from "@/server/http";
import { requireCurrent } from "@/server/session";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return handle(req, async () => Response.json(preferencesOf((await requireCurrent(req)).user.prefs)));
}

export function PATCH(req: Request) {
  return handle(req, async () => {
    const current = await requireCurrent(req);
    return Response.json(await updateMyPreferences(current, parsePreferencesPatch(await readJson(req))));
  });
}
