import { requireSession } from "@/server/session";
import { handle } from "@/server/http";
import { getOverview } from "@/server/overview";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return handle(req, async () => {
    await requireSession(req);
    return Response.json(getOverview(new URL(req.url).searchParams.get("at")));
  });
}
