import { badRequest, handle } from "@/server/http";
import { requireSession } from "@/server/session";
import { incidentMarkdown } from "@/server/incidents";

export const dynamic = "force-dynamic";

export function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(req, async () => {
    await requireSession(req);
    const format = new URL(req.url).searchParams.get("format") ?? "md";
    if (format !== "md") throw badRequest("format must be md (the only export for now).");
    const { filename, body } = incidentMarkdown((await params).id);
    return new Response(body, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  });
}
