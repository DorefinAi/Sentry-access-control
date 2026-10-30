import { updateMyName } from "@/server/account";
import { handle, readJson } from "@/server/http";
import { buildProfile, requireCurrent } from "@/server/session";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

export function GET(req: Request) {
  return handle(req, async () => Response.json(await buildProfile((await requireCurrent(req)).session), { headers: noStore }));
}

// Any signed-in user, viewers included, may change their own display name.
export function PATCH(req: Request) {
  return handle(req, async () => {
    const current = await requireCurrent(req);
    return Response.json(await updateMyName(current, await readJson(req)), { headers: noStore });
  });
}
