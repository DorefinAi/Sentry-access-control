// Sign-in, sessions, the write checks and team rules, against throwaway files in a temp folder.
// Run: node --no-warnings --import ./scripts/test-resolve.mjs src/server/auth.test.ts
// It never touches the real users.local.json or sessions.local.json.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sentry-auth-test-"));
process.chdir(dir); // users.ts and liveSessions.ts put their files in process.cwd()
process.env.SENTRY_SECRET = "test-only-secret-not-used-anywhere-else-0123456789";

const load = async <T>(rel: string): Promise<T> => (await import(new URL(rel, import.meta.url).href)) as T;
const { hashPassword } = await load<typeof import("./password.mjs")>("./password.mjs");
const session = await load<typeof import("./session")>("./session.ts");
const live = await load<typeof import("./liveSessions")>("./liveSessions.ts");
const users = await load<typeof import("./users")>("./users.ts");
const team = await load<typeof import("./team")>("./team.ts");
const http = await load<typeof import("./http")>("./http.ts");
const logins = await load<typeof import("./logins")>("./logins.ts");
const { proxy } = await load<typeof import("../proxy")>("../proxy.ts");
const { NextRequest } = await import("next/server");

const PW = "correct horse battery";
const g = globalThis as { __sentryStore?: unknown };
const restart = () => (g.__sentryStore = undefined); // what a server restart does to memory

async function seedUsers() {
  const hash = await hashPassword(PW);
  const list = [
    { username: "olga", name: "Olga Owner", role: "owner", passwordHash: hash },
    { username: "ada", name: "Ada Admin", role: "admin", passwordHash: hash },
    { username: "otto", name: "Otto Operator", role: "operator", passwordHash: hash },
    { username: "vic", name: "Vic Viewer", role: "viewer", passwordHash: hash },
  ];
  writeFileSync(users.USERS_FILE, JSON.stringify(list, null, 2));
  writeFileSync(live.SESSIONS_FILE, "[]");
}

const BASE = "http://localhost:3005";
function req(pathname: string, init: { method?: string; ip?: string; cookie?: string; origin?: string | null; type?: string | null; body?: unknown } = {}) {
  const headers = new Headers({ host: "localhost:3005", "user-agent": "test" });
  if (init.ip) headers.set("x-forwarded-for", init.ip);
  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.origin !== null) headers.set("origin", init.origin ?? BASE);
  if (init.type !== null) headers.set("content-type", init.type ?? "application/json");
  return new Request(BASE + pathname, { method: init.method ?? "POST", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}
const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0];
const tokenOf = (cookie: string) => cookie.split("=")[1];

async function signIn(username: string, ip = "10.0.0.1"): Promise<string> {
  const res = await session.login(req("/api/auth/login", { ip }), { username, password: PW });
  assert.equal(res.status, 200, `sign in as ${username}`);
  return cookieOf(res);
}

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  restart();
  await seedUsers();
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
}

// ─── Item 5: server-side sessions ───────────────────────────────────────────

await test("sign-in stores a random session id durably", async () => {
  const cookie = await signIn("ada");
  const stored = JSON.parse(readFileSync(live.SESSIONS_FILE, "utf8"));
  assert.equal(stored.length, 1);
  assert.match(stored[0].sid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const checked = await live.checkToken(tokenOf(cookie));
  assert.equal(checked?.session.u, "ada");
  assert.equal(checked?.session.sid, stored[0].sid);
});

await test("signed out stays signed out, also after a restart", async () => {
  const cookie = await signIn("ada");
  await session.logout(req("/api/auth/logout", { cookie }));
  assert.equal(await live.checkToken(tokenOf(cookie)), null);
  restart();
  assert.equal(await live.checkToken(tokenOf(cookie)), null);
});

await test("a valid session survives a restart", async () => {
  const cookie = await signIn("ada");
  restart();
  assert.equal((await live.checkToken(tokenOf(cookie)))?.session.u, "ada");
});

await test("a correctly signed cookie for an unlisted session is refused", async () => {
  const auth = await load<typeof import("./auth")>("./auth.ts");
  const forged = await auth.signSession("ada", "admin", process.env.SENTRY_SECRET!, crypto.randomUUID());
  assert.equal(await live.checkToken(forged.token), null);
  const noSid = await auth.signSession("ada", "admin", process.env.SENTRY_SECRET!);
  assert.equal(await live.checkToken(noSid.token), null);
});

await test("disabling a user ends their sessions, also after a restart", async () => {
  const victim = await signIn("vic");
  const admin = (await live.checkToken(tokenOf(await signIn("ada"))))!.session;
  await team.patchTeamUser("vic", { disabled: true }, admin);
  assert.equal(await live.checkToken(tokenOf(victim)), null);
  await team.patchTeamUser("vic", { disabled: false }, admin);
  restart();
  assert.equal(await live.checkToken(tokenOf(victim)), null, "re-enabling does not bring the old session back");
});

await test("revoke others keeps this session and ends the rest", async () => {
  const a = await signIn("otto");
  const b = await signIn("otto");
  const current = (await session.currentSession(req("/", { method: "GET", cookie: a })))!;
  const res = await (await load<typeof import("./account")>("./account.ts")).revokeOtherSessions(req("/x", { cookie: a }), current);
  assert.equal(res.status, 204);
  assert.equal(await live.checkToken(tokenOf(b)), null);
  assert.ok(await live.checkToken(tokenOf(cookieOf(res))), "the re-issued cookie works");
  const listed = await session.sessionsOf("otto", (await users.findUser("otto"))!.sessionsValidAfter);
  assert.equal(listed.length, 1);
});

await test("an unreadable sessions file refuses every session and every sign-in", async () => {
  const cookie = await signIn("ada");
  writeFileSync(live.SESSIONS_FILE, "{ not json");
  assert.equal(await live.checkToken(tokenOf(cookie)), null);
  await assert.rejects(session.login(req("/api/auth/login"), { username: "ada", password: PW }), (e: unknown) => e instanceof http.HttpError && e.status === 500);
  assert.equal(readFileSync(live.SESSIONS_FILE, "utf8"), "{ not json", "left as it was");
});

// ─── Item 1: lockout ────────────────────────────────────────────────────────

await test("parallel wrong passwords from changing addresses: at most 5 reach scrypt per username", async () => {
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) => session.login(req("/api/auth/login", { ip: `198.51.100.${i}` }), { username: "Ada", password: "wrong password" })),
  );
  const statuses = results.map((r) => r.status);
  assert.equal(statuses.filter((s) => s === 401).length, 5, statuses.join(","));
  assert.equal(statuses.filter((s) => s === 429).length, 15);
  const right = await session.login(req("/api/auth/login", { ip: "203.0.113.9" }), { username: "ada", password: PW });
  assert.equal(right.status, 429, "the username stays locked, even with the right password");
  assert.ok(Number(right.headers.get("retry-after")) > 60);
});

await test("one address trying many usernames is locked after 5", async () => {
  const statuses: number[] = [];
  for (const u of ["a1", "a2", "a3", "a4", "a5", "a6"]) statuses.push((await session.login(req("/api/auth/login", { ip: "192.0.2.7" }), { username: u, password: "x" })).status);
  assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429]);
});

await test("a right password clears the count", async () => {
  const wrong = () => session.login(req("/api/auth/login", { ip: "10.0.0.1" }), { username: "otto", password: "nope" });
  for (let i = 0; i < 4; i++) await wrong();
  await signIn("otto", "10.0.0.1");
  for (let i = 0; i < 4; i++) assert.equal((await wrong()).status, 401);
});

await test("password change is limited the same way, counted before scrypt", async () => {
  const account = await load<typeof import("./account")>("./account.ts");
  const cookie = await signIn("otto");
  const current = (await session.currentSession(req("/", { method: "GET", cookie })))!;
  const results = await Promise.all(Array.from({ length: 8 }, () => account.changeMyPassword(req("/api/me/password", { cookie }), current, { current: "wrong one!", next: "a new password 123" })));
  const statuses = results.map((r) => r.status);
  assert.equal(statuses.filter((s) => s === 401).length, 5, statuses.join(","));
  assert.equal(statuses.filter((s) => s === 429).length, 3);
});

// ─── Item 2: users file ─────────────────────────────────────────────────────

await test("a users file that does not parse is never overwritten", async () => {
  writeFileSync(users.USERS_FILE, '[{"username": "ada", ');
  await assert.rejects(users.updateUsers(() => undefined), (e: unknown) => e instanceof http.HttpError && e.status === 500);
  assert.equal(readFileSync(users.USERS_FILE, "utf8"), '[{"username": "ada", ');
});

await test("a users file with an entry we cannot read is never overwritten", async () => {
  const before = JSON.parse(readFileSync(users.USERS_FILE, "utf8"));
  const withOdd = [...before, { username: "odd", name: "Odd", role: "superuser", passwordHash: "plain" }];
  writeFileSync(users.USERS_FILE, JSON.stringify(withOdd));
  await assert.rejects(users.updateUsers(() => undefined), (e: unknown) => e instanceof http.HttpError && e.status === 500);
  assert.equal(JSON.parse(readFileSync(users.USERS_FILE, "utf8")).length, 5);
  assert.equal((await users.loadUsers())?.length, 4, "the readable accounts can still sign in");
});

await test("a missing users file is an empty team, and saving it works", async () => {
  rmSync(users.USERS_FILE);
  assert.deepEqual(await users.loadUsers(), []);
  await users.updateUsers(() => undefined);
  assert.deepEqual(JSON.parse(readFileSync(users.USERS_FILE, "utf8")), []);
});

// ─── Item 3: writes from other origins ──────────────────────────────────────

await test("writes need JSON and this origin", async () => {
  const code = (r: Request) => http.crossSiteWrite(r)?.code ?? "ok";
  assert.equal(code(req("/api/alerts/x")), "ok");
  assert.equal(code(req("/api/alerts/x", { type: "application/json; charset=utf-8" })), "ok");
  assert.equal(code(req("/api/alerts/x", { origin: "http://localhost:3000" })), "bad_origin");
  assert.equal(code(req("/api/alerts/x", { origin: "http://localhost:3005.evil.com" })), "bad_origin");
  assert.equal(code(req("/api/alerts/x", { origin: "null" })), "bad_origin");
  assert.equal(code(req("/api/alerts/x", { origin: null })), "bad_origin");
  assert.equal(code(req("/api/alerts/x", { type: "text/plain" })), "unsupported_media_type");
  assert.equal(code(req("/api/alerts/x", { type: "application/x-www-form-urlencoded" })), "unsupported_media_type");
  assert.equal(code(req("/api/alerts/x", { type: null })), "unsupported_media_type");
});

await test("the proxy refuses cross-site writes, also to login and logout", async () => {
  const nreq = (p: string, init: Parameters<typeof req>[1]) => new NextRequest(req(p, init));
  assert.equal((await proxy(nreq("/api/auth/login", { origin: "http://localhost:3000", body: {} }))).status, 403);
  assert.equal((await proxy(nreq("/api/auth/logout", { type: "text/plain" }))).status, 415);
  const cookie = await signIn("ada");
  assert.equal((await proxy(nreq("/api/alerts/ALR-0100", { method: "PATCH", cookie, origin: "http://localhost:3001", body: {} }))).status, 403);
  const ok = await proxy(nreq("/api/alerts/ALR-0100", { method: "PATCH", cookie, body: {} }));
  assert.equal(ok.headers.get("x-middleware-next"), "1");
});

await test("the proxy checks the session on the server, not just the signature", async () => {
  const nreq = (p: string, cookie?: string) => new NextRequest(req(p, { method: "GET", cookie, origin: null, type: null }));
  const cookie = await signIn("ada");
  assert.equal((await proxy(nreq("/api/logins", cookie))).headers.get("x-middleware-next"), "1");
  assert.equal((await proxy(nreq("/api/logs/x.js"))).status, 401, "an /api path ending in .js is still checked");
  await session.logout(req("/api/auth/logout", { cookie }));
  assert.equal((await proxy(nreq("/api/logins", cookie))).status, 401);
  const page = await proxy(nreq("/alerts?x=1", cookie));
  assert.equal(page.status, 307);
  assert.equal(new URL(page.headers.get("location")!).pathname, "/login");
});

// ─── Item 12: small ones ────────────────────────────────────────────────────

await test("nobody resets their own password through the team PATCH", async () => {
  const admin = (await live.checkToken(tokenOf(await signIn("ada"))))!.session;
  await assert.rejects(team.patchTeamUser("ada", { password: "a brand new password" }, admin), (e: unknown) => e instanceof http.HttpError && e.status === 403);
  await team.patchTeamUser("otto", { password: "a brand new password" }, admin);
});

await test("failed-login usernames are hidden below admin", async () => {
  await session.login(req("/api/auth/login"), { username: "my-password-typed-here", password: "x" });
  const { ist } = await load<typeof import("../data/time")>("../data/time.ts");
  const date = ist(Date.now()).slice(0, 10);
  const failedUsers = (reveal: boolean) => logins.loginReport(date, "sentry", { revealFailedUsers: reveal }).events.filter((e) => e.result !== "success").map((e) => e.user);
  // Earlier tests' failed tries are there too: the sign-in log now survives a restart (audit.local.json)
  assert.ok(failedUsers(false).length > 0 && failedUsers(false).every((u) => u === logins.HIDDEN_USER));
  assert.ok(failedUsers(true).includes("my-password-typed-here"));
});

// ─── Owner role ─────────────────────────────────────────────────────────────

await test("owner outranks admin and only owners make or change owners", async () => {
  assert.ok(session.atLeast("owner", "admin"));
  assert.ok(!session.atLeast("admin", "owner"));
  const admin = (await live.checkToken(tokenOf(await signIn("ada"))))!.session;
  const owner = (await live.checkToken(tokenOf(await signIn("olga"))))!.session;
  assert.equal(owner.r, "owner");
  const forbidden = (e: unknown) => e instanceof http.HttpError && e.status === 403;
  await assert.rejects(team.createTeamUser({ username: "eve", name: "Eve", role: "owner", password: "0123456789ab" }, admin), forbidden);
  await assert.rejects(team.patchTeamUser("otto", { role: "owner" }, admin), forbidden);
  await assert.rejects(team.patchTeamUser("olga", { disabled: true }, admin), forbidden);
  await assert.rejects(team.patchTeamUser("olga", { name: "Renamed" }, admin), forbidden);
  const made = await team.createTeamUser({ username: "omar", name: "Omar", role: "owner", password: "0123456789ab" }, owner);
  assert.equal(made.role, "owner");
  await team.patchTeamUser("ada", { role: "operator" }, owner); // owners can do what admins can
  await assert.rejects(team.patchTeamUser("olga", { role: "admin" }, owner), (e: unknown) => e instanceof http.HttpError && e.status === 409);
});

await test("the last admin-or-owner cannot be demoted or disabled", async () => {
  const owner = (await live.checkToken(tokenOf(await signIn("olga"))))!.session;
  await team.patchTeamUser("ada", { role: "viewer" }, owner);
  await assert.rejects(team.patchTeamUser("olga", { disabled: true }, owner), (e: unknown) => e instanceof http.HttpError && e.status === 409);
});

process.chdir(tmpdir());
rmSync(dir, { recursive: true, force: true });
console.log(`auth: ${passed} checks passed`);
