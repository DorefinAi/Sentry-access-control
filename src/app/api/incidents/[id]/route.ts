import { handle, readJson } from "@/server/http";
import { getIncident, parseIncidentPatch, patchIncident } from "@/server/incidents";
import { requireRole, requireSession } from "@/server/session";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function GET(req: Request, { params }: Ctx) {
  return handle(req, async () => {
    await requireSession(req);
    return Response.json(getIncident((await params).id));
  });
}

export function PATCH(req: Request, { params }: Ctx) {
  return handle(req, async () => {
    const session = await requireRole(req, "operator");
    const { id } = await params;
    getIncident(id); // 404 before reading the body
    const patch = parseIncidentPatch(await readJson(req));
    return Response.json(patchIncident(id, patch, session.u));
  });
}
