import { handle, readJson } from "@/server/http";
import { requireRole } from "@/server/session";
import { parseTeamUserPatch, patchTeamUser } from "@/server/team";

export const dynamic = "force-dynamic";

export function PATCH(req: Request, { params }: { params: Promise<{ username: string }> }) {
  return handle(req, async () => {
    const session = await requireRole(req, "admin");
    const patch = parseTeamUserPatch(await readJson(req));
    return Response.json(await patchTeamUser((await params).username, patch, session));
  });
}
