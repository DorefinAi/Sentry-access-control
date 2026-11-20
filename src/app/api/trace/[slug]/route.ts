import { requireSession } from "@/server/session";
import { handle } from "@/server/http";
import { getTrace } from "@/server/trace";

export const dynamic = "force-dynamic";

export function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  return handle(req, async () => {
    await requireSession(req);
    return Response.json(await getTrace((await params).slug));
  });
}
