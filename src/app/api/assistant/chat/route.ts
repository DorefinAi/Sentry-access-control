import { assistant, parseChatRequest } from "@/server/ai/assistant";
import { requireSession } from "@/server/session";
import { handle, readJson } from "@/server/http";

export const dynamic = "force-dynamic";

export function POST(req: Request) {
  return handle(req, async () => {
    await requireSession(req);
    return Response.json(await assistant.reply(parseChatRequest(await readJson(req))));
  });
}
