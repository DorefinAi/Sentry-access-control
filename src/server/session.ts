// Route-side sign-in for the team: login with per-IP and per-username limits, logout, roles and
// the profile. Every session check goes through checkToken() (liveSessions.ts), which re-reads the
// account and the session list: a sign-out, a disabled user, a role change or a password reset
// takes effect on the next request, also after a restart.
import type { ApiError, Evidence, LoginRequest, LoginResponse, Profile, SessionInfo } from "@/types/control";
import { at, ist, ms, TODAY } from "@/data/time";
import { authConfig, clearSessionCookie, readCookie, ROLE_RANK, SESSION_COOKIE, sessionCookie, signSession, verifySession, type RoleId, type Session } from "./auth";
import { badRequest, HttpError } from "./http";
import { addSession, checkToken, endSession, endSessionsOf, listSessions, touchSession, type Checked } from "./liveSessions";
import { store, type Action, type ConsoleLogin } from "./store";
import { checkLogin, findUser, ROLE_LABEL } from "./users";
import { isRecord, text } from "./validate";

// Each key (one IP, one username) gets MAX_ATTEMPTS tries per WINDOW_MS, then waits LOCK_MS.
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60_000;
const LOCK_MS = 5 * 60_000;
const FAIL_DELAY_MS = 400;
// Memory bounds: a flood of made-up usernames or addresses must not grow these for ever.
export const MAX_FAILURE_KEYS = 5000;
export const MAX_LOGIN_LOG = 5000;

// The address the request came from, for the per-IP limit and the logins report. Route handlers
// cannot see the socket: Next copies the socket address into X-Forwarded-For only when the client
// sent none, so this is the client's word. That is why every login is also limited per username,
// which does not depend on it.
export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local").slice(0, 64);
}

export const isHttps = (req: Request) => new URL(req.url).protocol === "https:";
const sleep = (msec: number) => new Promise((r) => setTimeout(r, msec));
const nowSec = () => Math.floor(Date.now() / 1000);

function secret(): string {
  const cfg = authConfig();
  if (!cfg) throw new HttpError(500, "auth_not_configured", "Sign-in is not set up: SENTRY_SECRET (32+ characters) must be in .env.local.");
  return cfg.secret;
}

// ─── Throttle (login and password change share it) ──────────────────────────

function tooMany(lockedUntil: number): Response {
  const wait = Math.max(1, Math.ceil((lockedUntil - Date.now()) / 1000));
  const body: ApiError = { error: "too_many_attempts", message: `Too many wrong tries. Wait ${wait} s and try again.` };
  return Response.json(body, { status: 429, headers: { "Retry-After": String(wait) } });
}

// Counts this attempt against every key before the password is checked, with no await in
// between, so parallel requests cannot all get past the limit while scrypt runs. A 429 when any
// key is locked. The attempt that uses up a key's tries still runs; the next one is refused.
// A correct password clears the keys (clearFailures), so only wrong tries add up.
export function takeAttempt(keys: string[]): Response | null {
  const now = Date.now();
  const fails = store().loginFailures;
  for (const key of keys) {
    const entry = fails.get(key);
    if (entry && entry.lockedUntil > now) return tooMany(entry.lockedUntil);
  }
  for (const key of keys) {
    let entry = fails.get(key);
    if (!entry || !(now - entry.since < WINDOW_MS)) entry = { count: 0, since: now, lockedUntil: 0 };
    entry.count++;
    if (entry.count >= MAX_ATTEMPTS) entry = { count: 0, since: now, lockedUntil: now + LOCK_MS };
    fails.set(key, entry);
  }
  pruneFailures(fails, now);
  return null;
}

/**
 * Keeps the failures map at MAX_FAILURE_KEYS. First the keys that no longer matter (window over,
 * not locked); then, if a flood is still filling it, the oldest unlocked counters, and only after
 * those the oldest locks. The keys just counted are the newest, so they stay.
 */
export function pruneFailures(fails: Map<string, { count: number; since: number; lockedUntil: number }>, now = Date.now()): void {
  if (fails.size <= MAX_FAILURE_KEYS) return;
  for (const [key, e] of fails) if (e.lockedUntil <= now && !(now - e.since < WINDOW_MS)) fails.delete(key);
  if (fails.size <= MAX_FAILURE_KEYS) return;
  const order = [...fails].sort(([, a], [, b]) => Number(a.lockedUntil > now) - Number(b.lockedUntil > now) || a.since - b.since);
  for (const [key] of order.slice(0, fails.size - MAX_FAILURE_KEYS)) fails.delete(key);
}

/**
 * Keeps the sign-in log at MAX_LOGIN_LOG entries. Failed and locked tries go first, oldest first;
 * successes are kept longest because "last login" and the session list read them.
 */
export function trimLoginLog(log: ConsoleLogin[]): void {
  let excess = log.length - MAX_LOGIN_LOG;
  if (excess <= 0) return;
  const kept = log.filter((l) => (excess > 0 && l.result !== "success" ? (excess--, false) : true));
  if (excess > 0) kept.splice(0, excess);
  log.splice(0, log.length, ...kept);
}

// A wrong password costs a little time on top of scrypt.
export const failDelay = () => sleep(FAIL_DELAY_MS);

export function clearFailures(...keys: string[]): void {
  for (const key of keys) store().loginFailures.delete(key);
}

// ─── Login / logout ─────────────────────────────────────────────────────────

export function parseLoginRequest(body: unknown): LoginRequest {
  if (!isRecord(body)) throw badRequest('Send {"username": "...", "password": "..."}.');
  const username = text(body.username, "username", 100, { required: true })!;
  if (typeof body.password !== "string" || !body.password) throw badRequest("password is required.");
  if (body.password.length > 200) throw badRequest("password is too long (max 200 characters).");
  return { username, password: body.password };
}

function nextLoginId(): string {
  return `login-sentry-${String(store().loginLog.length + 1).padStart(4, "0")}`;
}

function logAttempt(req: Request, entry: Omit<ConsoleLogin, "id" | "ip" | "userAgent" | "at"> & { at?: string; id?: string }): ConsoleLogin {
  const record: ConsoleLogin = {
    at: ist(Date.now()),
    ip: clientIp(req),
    userAgent: (req.headers.get("user-agent") ?? "unknown").slice(0, 120),
    ...entry,
    id: entry.id ?? nextLoginId(),
  };
  const log = store().loginLog;
  log.push(record);
  trimLoginLog(log);
  return record;
}

export async function login(req: Request, input: LoginRequest): Promise<Response> {
  const key = secret();
  const ip = clientIp(req);
  const username = input.username.toLowerCase();
  const keys = [`ip:${ip}`, `user:${username}`];
  const blocked = takeAttempt(keys);
  if (blocked) {
    logAttempt(req, { user: username, name: null, role: null, result: "locked" });
    return blocked;
  }

  const { user, known, disabled } = await checkLogin(username, input.password);
  if (!user) {
    logAttempt(req, { user: username, name: null, role: null, result: disabled ? "locked" : known ? "bad_password" : "unknown_user" });
    await failDelay();
    // Same answer for a disabled account as for a wrong password.
    const body: ApiError = { error: "unauthorized", message: "Wrong username or password." };
    return Response.json(body, { status: 401 });
  }

  clearFailures(...keys);
  // Random, so an id is never reused (a sequential one restarted at 1 after a restart).
  const sid = crypto.randomUUID();
  const { token, session } = await signSession(user.username, user.role, key, sid);
  const previous = lastLoginBefore(session);
  const signedInAt = ist(session.iat * 1000);
  const rec = logAttempt(req, { id: sid, user: user.username, name: user.name, role: ROLE_LABEL[user.role], result: "success", iat: session.iat, at: signedInAt, lastSeen: signedInAt });
  await addSession({ sid, user: user.username, iat: session.iat, exp: session.exp, startedAt: signedInAt, ip: rec.ip, userAgent: rec.userAgent });
  const response: LoginResponse = { profile: await buildProfile(session, previous) };
  return Response.json(response, { headers: { "Set-Cookie": sessionCookie(token, isHttps(req)), "Cache-Control": "no-store" } });
}

function recordFor(session: Session): ConsoleLogin | undefined {
  return session.sid ? store().loginLog.find((l) => l.id === session.sid && l.user === session.u && l.result === "success") : undefined;
}

// Ends this session for good (its id leaves sessions.local.json), then clears the cookie.
export async function logout(req: Request): Promise<Response> {
  const cfg = authConfig();
  const session = cfg ? await verifySession(readCookie(req.headers.get("cookie"), SESSION_COOKIE), cfg.secret) : null;
  if (session?.sid) {
    await endSession(session.sid);
    const rec = recordFor(session);
    if (rec) rec.endedAt = ist(Date.now());
  }
  return Response.json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie(isHttps(req)), "Cache-Control": "no-store" } });
}

// ─── Session checks ─────────────────────────────────────────────────────────

export type Current = Checked;

export async function currentSession(req: Request): Promise<Current | null> {
  const current = await checkToken(readCookie(req.headers.get("cookie"), SESSION_COOKIE));
  if (!current) return null;
  const rec = recordFor(current.session);
  if (rec) rec.lastSeen = ist(Date.now());
  return current;
}

export async function sessionFrom(req: Request): Promise<Session | null> {
  return (await currentSession(req))?.session ?? null;
}

export async function requireCurrent(req: Request): Promise<Current> {
  const current = await currentSession(req);
  if (!current) throw new HttpError(401, "unauthorized", "Sign in first.");
  return current;
}

export async function requireSession(req: Request): Promise<Session> {
  return (await requireCurrent(req)).session;
}

export const atLeast = (role: RoleId, min: RoleId) => ROLE_RANK[role] >= ROLE_RANK[min];

// operator: ack/resolve/notes, incidents, thresholds. admin: everything, including the team.
// owner: everything an admin can, plus making and changing owners.
export async function requireRole(req: Request, min: RoleId): Promise<Session> {
  const session = await requireSession(req);
  if (!atLeast(session.r, min)) {
    throw new HttpError(
      403,
      "forbidden",
      min === "owner" ? "Only owners can do this." : min === "admin" ? "Only admins can manage the team." : session.r === "viewer" ? "Your role can only view." : `This needs the ${min} role.`,
    );
  }
  return session;
}

// A fresh cookie for the same session, issued now; used after "sign out other sessions"
// so this one stays valid while everything issued earlier stops working.
export async function reissueCookie(req: Request, current: Current, issuedAt = nowSec()): Promise<string> {
  const rec = recordFor(current.session);
  const { token } = await signSession(current.session.u, current.user.role, secret(), current.session.sid, issuedAt);
  if (current.session.sid) await touchSession(current.session.sid, issuedAt);
  if (rec) rec.iat = issuedAt;
  return sessionCookie(token, isHttps(req));
}

// Live sessions from sessions.local.json, so the list is right after a restart; last seen comes
// from this server's memory when it has it.
export async function sessionsOf(username: string, validAfter = 0, currentSid?: string): Promise<SessionInfo[]> {
  const log = store().loginLog;
  return (await listSessions(username))
    .filter((s) => s.iat >= validAfter)
    .sort((a, b) => ms(b.startedAt) - ms(a.startedAt))
    .map((s) => ({
      id: s.sid,
      startedAt: s.startedAt,
      lastSeen: log.find((l) => l.id === s.sid)?.lastSeen ?? s.startedAt,
      ip: s.ip,
      userAgent: s.userAgent,
      current: s.sid === currentSid,
    }));
}

// Ends every other session of this user, for good (sessions.local.json) and in this server's log.
export async function endOtherSessions(username: string, keepSid?: string): Promise<void> {
  await endSessionsOf(username, keepSid);
  const stamp = ist(Date.now());
  for (const l of store().loginLog) {
    if (l.user === username && l.result === "success" && !l.endedAt && l.id !== keepSid) l.endedAt = stamp;
  }
}

function lastLoginBefore(session: Session): { at: string; ip: string } | null {
  const before = store()
    .loginLog.filter((l) => l.user === session.u && l.result === "success" && ms(l.at) < session.iat * 1000 && l.id !== session.sid)
    .sort((a, b) => ms(b.at) - ms(a.at))[0];
  return before ? { at: before.at, ip: before.ip } : null;
}

// ─── Profile ────────────────────────────────────────────────────────────────

// What vansh did today before this server started (matches the alert and incident history).
const STATIC_ACTIONS: Action[] = [
  { at: at("09:16"), user: "vansh", kind: "ack", text: "Acked ALR-0100: Outlook email moved to mail_dead", evidence: [{ kind: "alert", id: "ALR-0100", label: "ALR-0100" }] },
  { at: at("09:31"), user: "vansh", kind: "resolve", text: "Resolved ALR-0100 after Kota bureau resent the mail", evidence: [{ kind: "alert", id: "ALR-0100", label: "ALR-0100" }] },
  { at: at("11:44"), user: "vansh", kind: "ack", text: "Acked ALR-0101: Octopus not polling", evidence: [{ kind: "alert", id: "ALR-0101", label: "ALR-0101" }] },
  { at: at("11:47"), user: "vansh", kind: "incident_note", text: "Note on INC-0007: called Octopus IT", evidence: [{ kind: "incident", id: "INC-0007", label: "INC-0007" }] },
  { at: at("15:46"), user: "vansh", kind: "ack", text: "Acked ALR-0104: X cap, watching it", evidence: [{ kind: "alert", id: "ALR-0104", label: "ALR-0104" }] },
  { at: at("15:46"), user: "vansh", kind: "note", text: "Note on ALR-0104: fake mode, nothing really posts", evidence: [{ kind: "alert", id: "ALR-0104", label: "ALR-0104" }] },
];

export async function buildProfile(session: Session, lastLogin = lastLoginBefore(session)): Promise<Profile> {
  const user = await findUser(session.u);
  const name = user?.name ?? session.u;
  const actions = [...STATIC_ACTIONS, ...store().actionLog].filter((a) => a.user === session.u && a.at.startsWith(TODAY));
  const count = (...kinds: Action["kind"][]) => actions.filter((a) => kinds.includes(a.kind)).length;
  return {
    username: session.u,
    name,
    role: ROLE_LABEL[session.r],
    roleId: session.r,
    initials: name
      .split(/\s+/)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("")
      .slice(0, 2),
    // When this session signed in; a re-issued cookie keeps the original start.
    onShiftSince: recordFor(session)?.at ?? ist(session.iat * 1000),
    lastLogin,
    actionsToday: { acked: count("ack"), resolved: count("resolve", "incident_resolved"), incidentsOpened: count("incident_opened"), notes: count("note", "incident_note") },
    recent: [...actions]
      .sort((a, b) => ms(b.at) - ms(a.at))
      .slice(0, 10)
      .map((a): { at: string; text: string; evidence?: Evidence[] } => ({ at: a.at, text: a.text, evidence: a.evidence })),
  };
}
