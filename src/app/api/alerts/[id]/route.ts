import { getAlert, parseAlertPatch, patchAlert } from "@/server/alerts";
import { handle, readJson } from "@/server/http";
import { requireRole, requireSession } from "@/server/session";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function GET(req: Request, { params }: Ctx) {
  return handle(req, async () => {
    await requireSession(req);
    return Response.json(getAlert((await params).id));
  });
}

export function PATCH(req: Request, { params }: Ctx) {
  return handle(req, async () => {
    const session = await requireRole(req, "operator");
    const { id } = await params;
    getAlert(id); // 404 before reading the body
    const patch = parseAlertPatch(await readJson(req));
    return Response.json(patchAlert(id, patch, session.u));
  });
}
