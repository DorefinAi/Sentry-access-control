import { requireSession } from "@/server/session";
import { handle } from "@/server/http";
import { parseLogQuery, queryLogs } from "@/server/logs";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return handle(req, async () => {
    await requireSession(req);
    return Response.json(queryLogs(parseLogQuery(new URL(req.url).searchParams)));
  });
}
