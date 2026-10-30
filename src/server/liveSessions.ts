// Signed-in sessions, kept in sessions.local.json (gitignored) so a sign-out, a revoke or a disable
// still holds after a restart. A cookie counts only while its session id is listed here and not
// expired; signing out removes the entry. Same file rules as users.ts: atomic, serialised writes,
// and nothing is written when the read was not clean.
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { authConfig, verifySession, type Session } from "./auth";
import { HttpError } from "./http";
import { findUser, type StoredUser } from "./users";

export interface StoredSession {
  sid: string; // randomUUID, also the id of the console login record
  user: string;
  iat: number; // issued at, unix seconds; moved forward when the cookie is re-issued
  exp: number; // expires, unix seconds
  startedAt: string; // IST, when this sign-in happened
  ip: string;
  userAgent: string;
}

export const SESSIONS_FILE = path.join(process.cwd(), "sessions.local.json");

const SID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const nowSec = () => Math.floor(Date.now() / 1000);

function isStored(s: unknown): s is StoredSession {
  if (!s || typeof s !== "object") return false;
  const x = s as Record<string, unknown>;
  return (
    typeof x.sid === "string" && SID_RE.test(x.sid) &&
    typeof x.user === "string" &&
    typeof x.iat === "number" && typeof x.exp === "number" &&
    typeof x.startedAt === "string" && typeof x.ip === "string" && typeof x.userAgent === "string"
  );
}

// ok is false when the file exists but could not be read whole. Then no session counts
// (fail closed) and nothing is written until someone fixes or deletes the file.
async function readSessions(): Promise<{ ok: boolean; sessions: StoredSession[] }> {
  let raw: string;
  try {
    raw = await readFile(SESSIONS_FILE, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { ok: true, sessions: [] };
    console.error("[auth] sessions.local.json could not be read");
    return { ok: false, sessions: [] };
  }
  try {
    const list = JSON.parse(raw.replace(/^﻿/, "")) as unknown;
    if (Array.isArray(list) && list.every(isStored)) return { ok: true, sessions: list };
  } catch {
    // reported below
  }
  console.error("[auth] sessions.local.json is not a valid session list; every session is refused until it is fixed or deleted");
  return { ok: false, sessions: [] };
}

const g = globalThis as typeof globalThis & { __sentrySessionsWrite?: Promise<unknown> };

// Read, change and write as one step, one change at a time; expired entries are dropped on the way.
function updateSessions<T>(change: (sessions: StoredSession[]) => T): Promise<T> {
  const run = (g.__sentrySessionsWrite ?? Promise.resolve()).then(async () => {
    const { ok, sessions } = await readSessions();
    if (!ok) {
      throw new HttpError(500, "sessions_file_unreadable", "Sign-in records (sessions.local.json) could not be read. Delete that file to sign everyone out, then try again.");
    }
    const now = nowSec();
    const live = sessions.filter((s) => s.exp > now);
    const result = change(live);
    const tmp = `${SESSIONS_FILE}.tmp`;
    await writeFile(tmp, JSON.stringify(live, null, 2) + "\n", { mode: 0o600 });
    await rename(tmp, SESSIONS_FILE);
    return result;
  });
  g.__sentrySessionsWrite = run.catch(() => undefined);
  return run;
}

export function addSession(s: StoredSession): Promise<void> {
  return updateSessions((list) => {
    list.push(s);
  });
}

export function endSession(sid: string): Promise<void> {
  return updateSessions((list) => {
    const i = list.findIndex((s) => s.sid === sid);
    if (i >= 0) list.splice(i, 1);
  });
}

// Ends every session of this user except keepSid. Returns how many ended.
export function endSessionsOf(username: string, keepSid?: string): Promise<number> {
  return updateSessions((list) => {
    let ended = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].user === username && list[i].sid !== keepSid) {
        list.splice(i, 1);
        ended++;
      }
    }
    return ended;
  });
}

export function touchSession(sid: string, iat: number): Promise<void> {
  return updateSessions((list) => {
    const s = list.find((x) => x.sid === sid);
    if (s) s.iat = iat;
  });
}

// Live sessions, of one user or of everyone.
export async function listSessions(username?: string): Promise<StoredSession[]> {
  const now = nowSec();
  return (await readSessions()).sessions.filter((s) => s.exp > now && (!username || s.user === username));
}

export interface Checked {
  session: Session; // r is the account's current role, not the one in the cookie
  user: StoredUser;
}

// The whole check, shared by the proxy and every route: a good signature, a session id that is
// still listed for this user, and an account that exists, is enabled and has not had its sessions
// cut off since this cookie was issued (sessionsValidAfter).
export async function checkToken(token: string | null | undefined): Promise<Checked | null> {
  const cfg = authConfig();
  if (!cfg) return null;
  const session = await verifySession(token, cfg.secret);
  if (!session?.sid) return null;
  const [sessions, user] = await Promise.all([listSessions(session.u), findUser(session.u)]);
  if (!sessions.some((s) => s.sid === session.sid)) return null;
  if (!user || user.disabled || session.iat < (user.sessionsValidAfter ?? 0)) return null;
  return { session: { ...session, r: user.role }, user };
}
