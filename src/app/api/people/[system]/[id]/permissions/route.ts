import { handle } from "@/server/http";
import { getPermissions, personId, systemParam, peopleJson } from "@/server/people";
import { requireRole } from "@/server/session";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ system: string; id: string }> };

// Every page and action for one person: allowed, and whether that is the role or an exception
export function GET(req: Request, { params }: Ctx) {
  return handle(req, async () => {
    const owner = await requireRole(req, "owner");
    const p = await params;
    return peopleJson(await getPermissions(owner, systemParam(p.system), personId(p.id)));
  });
}
