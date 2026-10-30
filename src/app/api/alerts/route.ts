import { listAlerts, parseAlertState } from "@/server/alerts";
import { requireSession } from "@/server/session";
import { handle } from "@/server/http";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return handle(req, async () => {
    await requireSession(req);
    const state = parseAlertState(new URL(req.url).searchParams.get("state"));
    return Response.json(listAlerts(state));
  });
}
