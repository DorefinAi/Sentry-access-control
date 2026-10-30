import { handle } from "@/server/http";
import { getHistory, historyQuery, peopleJson } from "@/server/people";
import { requireRole } from "@/server/session";

export const dynamic = "force-dynamic";

// Changes to people in both systems, newest first. ?limit=1..200&cursor=<the last answer's next>
export function GET(req: Request) {
  return handle(req, async () => {
    const owner = await requireRole(req, "owner");
    return peopleJson(await getHistory(owner, historyQuery(new URL(req.url))));
  });
}
