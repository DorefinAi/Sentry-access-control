import { mySessions } from "@/server/account";
import { handle } from "@/server/http";
import { requireCurrent } from "@/server/session";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return handle(req, async () => Response.json(await mySessions(await requireCurrent(req))));
}
