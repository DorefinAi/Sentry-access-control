import { badRequest, handle } from "@/server/http";
import { requireSession } from "@/server/session";
import { searchTraces } from "@/server/trace";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return handle(req, async () => {
    await requireSession(req);
    const q = new URL(req.url).searchParams.get("q");
    if (q && q.length > 100) throw badRequest("q is too long (max 100 characters).");
    return Response.json(searchTraces(q));
  });
}
