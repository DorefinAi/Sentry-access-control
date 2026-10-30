import { requireSession } from "@/server/session";
import { handle } from "@/server/http";
import { liveGauges } from "@/server/overview";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return handle(req, async () => {
    await requireSession(req);
    return Response.json(liveGauges());
  });
}
