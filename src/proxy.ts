// Next 16 "proxy" (formerly middleware), always on the Node runtime. Two jobs:
// - every write (not GET/HEAD/OPTIONS) must be JSON from this console's own origin (crossSiteWrite);
// - every page and API call needs a live session, checked in full on the server (checkToken:
//   signature, listed session id, enabled account), except the login page, the login/logout
//   calls and static files.
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/server/auth";
import { crossSiteWrite, errorResponse } from "@/server/http";
import { checkToken } from "@/server/liveSessions";

const PUBLIC_PATHS = new Set(["/login", "/api/auth/login", "/api/auth/logout"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (!SAFE_METHODS.has(request.method)) {
    const refused = crossSiteWrite(request);
    if (refused) return errorResponse(refused);
  }
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  if (await checkToken(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized", message: "Sign in first." }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Every /api path, whatever it ends in (an id like "x.js" must not skip the checks), plus every
  // page except Next's own files and static assets.
  matcher: ["/api/:path*", "/((?!_next/static|_next/image|favicon\\.ico|icon\\.svg|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|css|js|map|txt|woff2?)$).*)"],
};
