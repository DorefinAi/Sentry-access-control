// Small helpers so every route answers errors the same way: { error, message } in plain words.
import type { ApiError } from "@/types/control";

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (message: string) => new HttpError(400, "bad_request", message);
export const notFound = (message: string) => new HttpError(404, "not_found", message);
export const conflict = (message: string) => new HttpError(409, "conflict", message);

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    const body: ApiError = { error: err.code, message: err.message };
    return Response.json(body, { status: err.status });
  }
  console.error("[api] unexpected error", err);
  const body: ApiError = { error: "internal", message: "Something went wrong on our side. Check the server log." };
  return Response.json(body, { status: 500 });
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Runs a route body and answers errors the same way everywhere. Every write is checked here as
 * well as in the proxy (crossSiteWrite), so a request that slips past the proxy is still refused;
 * taking `req` makes the check impossible to forget. Session checks stay explicit in each route
 * (requireSession / requireRole); route-guards.test.ts fails if a route has none.
 */
export async function handle(req: Request, fn: () => Response | Promise<Response>): Promise<Response> {
  try {
    if (!SAFE_METHODS.has(req.method.toUpperCase())) {
      const refused = crossSiteWrite(req);
      if (refused) throw refused;
    }
    return await fn();
  } catch (err) {
    return errorResponse(err);
  }
}

// Every request that changes something (anything but GET, HEAD, OPTIONS) must come from this
// console's own pages. The other apps on this host (:3000, :3001, ...) count as the same site, so
// SameSite cookies alone do not stop them. Two checks, both made by the proxy:
// - Content-Type application/json: a plain form or a no-cors fetch cannot send it, and a
//   cross-origin fetch that does needs a CORS preflight, which this app never grants.
// - An Origin header naming this host and port.
export function crossSiteWrite(req: Request): HttpError | null {
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") return new HttpError(415, "unsupported_media_type", "Send the request body as JSON (Content-Type: application/json).");
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  let sameHost = false;
  try {
    sameHost = !!origin && !!host && new URL(origin).host === host.toLowerCase();
  } catch {
    sameHost = false;
  }
  return sameHost ? null : new HttpError(403, "bad_origin", "This request did not come from the Sentry console, so it was refused.");
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw badRequest("The request body must be valid JSON.");
  }
}
