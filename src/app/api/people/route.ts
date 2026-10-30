import { handle } from "@/server/http";
import { getPeople, peopleJson } from "@/server/people";
import { requireRole } from "@/server/session";

export const dynamic = "force-dynamic";

// Everyone in the Assignment desk and Socia, one row per person. Owners only.
export function GET(req: Request) {
  return handle(req, async () => {
    const owner = await requireRole(req, "owner");
    return peopleJson(await getPeople(owner));
  });
}
