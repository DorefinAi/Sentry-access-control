import { revokeOtherSessions } from "@/server/account";
import { handle } from "@/server/http";
import { requireCurrent } from "@/server/session";

export const dynamic = "force-dynamic";

export function POST(req: Request) {
  return handle(req, async () => revokeOtherSessions(req, await requireCurrent(req)));
}
