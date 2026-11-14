import { handle, readJson } from "@/server/http";
import { deletePerson, parsePeoplePatch, patchPerson, personId, systemParam, peopleJson } from "@/server/people";
import { requireRole } from "@/server/session";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ system: string; id: string }> };

// Turn an account on or off, or change its role: { role?, active? }
export function PATCH(req: Request, { params }: Ctx) {
  return handle(req, async () => {
    const owner = await requireRole(req, "owner");
    const p = await params;
    const system = systemParam(p.system);
    const id = personId(p.id);
    const patch = parsePeoplePatch(await readJson(req));
    return peopleJson(await patchPerson(owner, system, id, patch));
  });
}

// Delete a person (Socia only; a soft delete there). 204 when done.
export function DELETE(req: Request, { params }: Ctx) {
  return handle(req, async () => {
    const owner = await requireRole(req, "owner");
    const p = await params;
    const system = systemParam(p.system);
    const id = personId(p.id);
    await deletePerson(owner, system, id);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store, private" } });
  });
}
