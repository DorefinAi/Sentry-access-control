import { handle, readJson } from "@/server/http";
import { parseOverrides, personId, putOverrides, systemParam, peopleJson } from "@/server/people";
import { requireRole } from "@/server/session";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ system: string; id: string }> };

// Replace a person's exceptions to their role: { overrides: [{permission, allowed}] }; [] resets to the role.
export function PUT(req: Request, { params }: Ctx) {
  return handle(req, async () => {
    const owner = await requireRole(req, "owner");
    const p = await params;
    const system = systemParam(p.system);
    const id = personId(p.id);
    const overrides = parseOverrides(await readJson(req));
    return peopleJson(await putOverrides(owner, system, id, overrides));
  });
}
