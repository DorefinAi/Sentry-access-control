import { requireSession } from "@/server/session";
import { handle } from "@/server/http";
import { getLog } from "@/server/logs";

export const dynamic = "force-dynamic";

export function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(req, async () => {
    await requireSession(req);
    return Response.json(getLog((await params).id));
  });
}
