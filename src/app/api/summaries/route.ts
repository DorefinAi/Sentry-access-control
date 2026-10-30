import { requireSession } from "@/server/session";
import { handle } from "@/server/http";
import { getSummary } from "@/server/summaries";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return handle(req, async () => {
    await requireSession(req);
    return Response.json(getSummary(new URL(req.url).searchParams));
  });
}
