import { handle, readJson } from "@/server/http";
import { login, parseLoginRequest } from "@/server/session";

export const dynamic = "force-dynamic";

export function POST(req: Request) {
  return handle(req, async () => login(req, parseLoginRequest(await readJson(req))));
}
