import { handle } from "@/server/http";
import { logout } from "@/server/session";

export const dynamic = "force-dynamic";

export function POST(req: Request) {
  return handle(req, async () => logout(req));
}
