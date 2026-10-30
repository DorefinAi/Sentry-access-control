import { TODAY } from "@/data/time";
import { requireSession } from "@/server/session";
import { handle } from "@/server/http";
import { dailyReport } from "@/server/reports";
import { dateParam } from "@/server/validate";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return handle(req, async () => {
    await requireSession(req);
    const date = dateParam(new URL(req.url).searchParams.get("date"), TODAY);
    return Response.json(dailyReport(date));
  });
}
