import { TODAY } from "@/data/time";
import { handle } from "@/server/http";
import { APPS, loginReport } from "@/server/logins";
import { atLeast, requireSession } from "@/server/session";
import { dateParam, optionalOneOf } from "@/server/validate";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return handle(req, async () => {
    const session = await requireSession(req);
    const params = new URL(req.url).searchParams;
    const date = dateParam(params.get("date"), TODAY);
    const app = optionalOneOf(params.get("app"), APPS, "app");
    return Response.json(loginReport(date, app, { revealFailedUsers: atLeast(session.r, "admin") }));
  });
}
