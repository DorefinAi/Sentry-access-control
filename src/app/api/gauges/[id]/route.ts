import { handle, readJson } from "@/server/http";
import { liveGauges } from "@/server/overview";
import { requireRole } from "@/server/session";
import { parseThresholdPatch, setThreshold } from "@/server/thresholds";

export const dynamic = "force-dynamic";

export function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(req, async () => {
    const session = await requireRole(req, "operator");
    const { id } = await params;
    const next = parseThresholdPatch(id, await readJson(req));
    await setThreshold(id as Parameters<typeof setThreshold>[0], next, session.u);
    return Response.json(liveGauges().find((g) => g.id === id));
  });
}
