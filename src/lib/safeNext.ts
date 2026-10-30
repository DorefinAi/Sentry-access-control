// Where /login?next= may send someone after sign-in. Kept out of LoginView so it can be tested
// with plain node: node --no-warnings src/lib/safeNext.test.ts

// Control characters (C0, DEL, C1) and backslashes are never part of a path we send people to
const UNSAFE = /[\u0000-\u001F\u007F-\u009F\\]/;

/**
 * Where ?next= may send someone after sign-in: a path (starting with one "/") on this same origin only.
 * Parsed with the URL API against the current origin, so "//host", "/\host",
 * schemes and encoded tricks all fail the origin check. Never back to /login.
 */
export function safeNext(raw: string | null, origin: string): string | null {
  if (!raw || UNSAFE.test(raw) || !raw.startsWith("/") || raw.startsWith("//")) return null;
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin || !url.pathname.startsWith("/") || url.pathname.startsWith("//")) return null;
  if (url.pathname === "/login" || url.pathname.startsWith("/login/")) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}
