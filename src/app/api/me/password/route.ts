import { changeMyPassword, parsePasswordChange } from "@/server/account";
import { handle, readJson } from "@/server/http";
import { requireCurrent } from "@/server/session";

export const dynamic = "force-dynamic";

export function POST(req: Request) {
  return handle(req, async () => {
    const current = await requireCurrent(req);
    return changeMyPassword(req, current, parsePasswordChange(await readJson(req)));
  });
}
