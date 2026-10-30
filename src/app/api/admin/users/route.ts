import { handle, readJson } from "@/server/http";
import { requireRole } from "@/server/session";
import { createTeamUser, listTeam, parseTeamUserCreate } from "@/server/team";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return handle(req, async () => {
    await requireRole(req, "admin");
    return Response.json(await listTeam());
  });
}

export function POST(req: Request) {
  return handle(req, async () => {
    const session = await requireRole(req, "admin");
    const input = parseTeamUserCreate(await readJson(req));
    return Response.json(await createTeamUser(input, session), { status: 201 });
  });
}
