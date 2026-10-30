// Session cookies for the console: an HMAC-signed {user, role, iat, exp}. Accounts live in
// users.local.json (see users.ts). A valid signature is not enough on its own: the session id must
// also be listed in sessions.local.json (see liveSessions.ts). Web Crypto only (no node:crypto).

export const SESSION_COOKIE = "sentry_session";
export const SESSION_TTL_SEC = 12 * 60 * 60;

export type RoleId = "owner" | "admin" | "operator" | "viewer";

// Higher can do everything lower can. Owners are admins who may also manage owners (and, later, People).
export const ROLE_RANK: Record<RoleId, number> = { viewer: 0, operator: 1, admin: 2, owner: 3 };
const isRoleId = (r: unknown): r is RoleId => typeof r === "string" && Object.hasOwn(ROLE_RANK, r);

export interface Session {
  u: string; // username
  r: RoleId; // role when the session was issued (the server re-reads the current role)
  sid?: string; // random session id (randomUUID); must be listed in sessions.local.json
  iat: number; // issued at, unix seconds
  exp: number; // expires, unix seconds
}

export interface AuthConfig {
  secret: string;
}

const enc = new TextEncoder();

// Null when .env.local has no SENTRY_SECRET or it is too short to sign with.
export function authConfig(): AuthConfig | null {
  const secret = process.env.SENTRY_SECRET ?? "";
  return secret.length >= 32 ? { secret } : null;
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signSession(username: string, role: RoleId, secret: string, sid?: string, nowSec = Math.floor(Date.now() / 1000)): Promise<{ token: string; session: Session }> {
  const session: Session = { u: username, r: role, iat: nowSec, exp: nowSec + SESSION_TTL_SEC, ...(sid ? { sid } : {}) };
  const body = b64url(enc.encode(JSON.stringify(session)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body)));
  return { token: `${body}.${b64url(sig)}`, session };
}

// crypto.subtle.verify compares the signature in constant time.
export async function verifySession(token: string | null | undefined, secret: string, nowSec = Math.floor(Date.now() / 1000)): Promise<Session | null> {
  if (!token || token.length > 1024) return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const sigBytes = fromB64url(sig);
  const bodyBytes = fromB64url(body);
  if (!sigBytes || !bodyBytes) return null;
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), sigBytes, enc.encode(body));
  if (!ok) return null;
  try {
    const s = JSON.parse(new TextDecoder().decode(bodyBytes)) as Partial<Session>;
    if (typeof s.u !== "string" || typeof s.iat !== "number" || typeof s.exp !== "number") return null;
    if (!isRoleId(s.r)) return null;
    if (s.exp <= nowSec || s.iat > nowSec + 60) return null;
    if (s.sid !== undefined && typeof s.sid !== "string") return null;
    return { u: s.u, r: s.r, iat: s.iat, exp: s.exp, ...(s.sid ? { sid: s.sid } : {}) };
  } catch {
    return null;
  }
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function sessionCookie(token: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SEC}${secure ? "; Secure" : ""}`;
}

export function clearSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}
