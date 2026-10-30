import { listChanges } from "@/server/changes";
import { requireSession } from "@/server/session";
import { handle } from "@/server/http";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return handle(req, async () => {
    await requireSession(req);
    return Response.json(listChanges(new URL(req.url).searchParams));
  });
}
