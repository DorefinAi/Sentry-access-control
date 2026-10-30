import { requireSession } from "@/server/session";
import { handle } from "@/server/http";
import { buildLog } from "@/server/reports";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return handle(req, async () => {
    await requireSession(req);
    return Response.json(buildLog());
  });
}
