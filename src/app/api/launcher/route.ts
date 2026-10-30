import { requireSession } from "@/server/session";
import { handle } from "@/server/http";
import { listLauncher } from "@/server/launcher";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return handle(req, async () => {
    await requireSession(req);
    return Response.json(listLauncher());
  });
}
