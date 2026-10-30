import { handle, readJson } from "@/server/http";
import { createIncident, listIncidents, parseIncidentCreate } from "@/server/incidents";
import { requireRole, requireSession } from "@/server/session";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return handle(req, async () => {
    await requireSession(req);
    return Response.json(listIncidents());
  });
}

export function POST(req: Request) {
  return handle(req, async () => {
    const session = await requireRole(req, "operator");
    const input = parseIncidentCreate(await readJson(req));
    return Response.json(createIncident(input, session.u), { status: 201 });
  });
}
