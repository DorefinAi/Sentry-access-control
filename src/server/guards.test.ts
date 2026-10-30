// Defence in depth behind the proxy: every API route checks the session itself, every write is
// checked for JSON + same origin inside handle(), and the sign-in throttle and log stay bounded.
// Run: node --no-warnings --import ./scripts/test-resolve.mjs src/server/guards.test.ts
// Uses a temp folder; never touches the real users or sessions files.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API = fileURLToPath(new URL("../app/api/", import.meta.url));
const dir = mkdtempSync(path.join(tmpdir(), "sentry-guards-test-"));
process.chdir(dir);
process.env.SENTRY_SECRET = "test-only-secret-not-used-anywhere-else-0123456789";

const load = async <T>(rel: string): Promise<T> => (await import(new URL(rel, import.meta.url).href)) as T;
const http = await load<typeof import("./http")>("./http.ts");
const session = await load<typeof import("./session")>("./session.ts");
const users = await load<typeof import("./users")>("./users.ts");
const live = await load<typeof import("./liveSessions")>("./liveSessions.ts");

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

function routeFiles(d: string): string[] {
  return readdirSync(d).flatMap((n) => {
    const p = path.join(d, n);
    return statSync(p).isDirectory() ? routeFiles(p) : n === "route.ts" ? [p] : [];
  });
}
// Sign-in and sign-out are the only routes open without a session
const PUBLIC = new Set(["auth/login", "auth/logout"]);

await test("every API route checks the session inside each handler and passes req to handle()", () => {
  const files = routeFiles(API);
  assert.ok(files.length >= 37, `found ${files.length} routes; the scan is not seeing the api folder`);
  const problems: string[] = [];
  for (const f of files) {
    const rel = path.relative(API, path.dirname(f)).replace(/\\/g, "/");
    const src = readFileSync(f, "utf8");
    const handlers = src.split(/(?=export (?:async )?function (?:GET|POST|PATCH|PUT|DELETE)\b)/).slice(1);
    assert.ok(handlers.length, `${rel} exports no handler`);
    for (const h of handlers) {
      const name = /function (\w+)/.exec(h)![1];
      if (!/\bhandle\(req,/.test(h)) problems.push(`${rel} ${name}: not wrapped in handle(req, …)`);
      if (!PUBLIC.has(rel) && !/await require(Session|Current|Role)\(req\b/.test(h)) problems.push(`${rel} ${name}: no session check`);
    }
  }
  assert.deepEqual(problems, []);
});

const BASE = "http://localhost:3005";
function req(method: string, { origin = BASE as string | null, type = "application/json" as string | null, cookie = "" } = {}) {
  const headers = new Headers({ host: "localhost:3005", "user-agent": "test" });
  if (origin) headers.set("origin", origin);
  if (type) headers.set("content-type", type);
  if (cookie) headers.set("cookie", cookie);
  return new Request(`${BASE}/api/x`, { method, headers, body: method === "GET" ? undefined : "{}" });
}

await test("handle() refuses cross-site and non-JSON writes before running the route", async () => {
  let ran = 0;
  const fn = () => {
    ran++;
    return Response.json({ ok: true });
  };
  assert.equal((await http.handle(req("POST", { origin: "http://localhost:3000" }), fn)).status, 403);
  assert.equal((await http.handle(req("PATCH", { origin: null }), fn)).status, 403);
  assert.equal((await http.handle(req("PUT", { type: "text/plain" }), fn)).status, 415);
  assert.equal((await http.handle(req("delete", { origin: "https://evil.example" }), fn)).status, 403, "method case does not matter");
  assert.equal(ran, 0);
  assert.equal((await http.handle(req("POST"), fn)).status, 200);
  assert.equal((await http.handle(req("GET", { origin: "http://localhost:3000", type: null }), fn)).status, 200, "reads are not write-checked");
  assert.equal(ran, 2);
});

await test("routes that relied on the proxy now answer 401 without a session, 200 with one", async () => {
  const { hashPassword } = await load<typeof import("./password.mjs")>("./password.mjs");
  writeFileSync(users.USERS_FILE, JSON.stringify([{ username: "vic", name: "Vic Viewer", role: "viewer", passwordHash: await hashPassword("correct horse battery") }]));
  writeFileSync(live.SESSIONS_FILE, "[]");
  const res = await session.login(new Request(`${BASE}/api/auth/login`, { method: "POST", headers: { host: "localhost:3005", "x-forwarded-for": "10.9.0.1" } }), { username: "vic", password: "correct horse battery" });
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
  const overview = await load<typeof import("../app/api/overview/route")>("../app/api/overview/route.ts");
  const launcher = await load<typeof import("../app/api/launcher/route")>("../app/api/launcher/route.ts");
  const chat = await load<typeof import("../app/api/assistant/chat/route")>("../app/api/assistant/chat/route.ts");
  assert.equal((await overview.GET(req("GET"))).status, 401);
  assert.equal((await launcher.GET(req("GET"))).status, 401);
  assert.equal((await chat.POST(req("POST"))).status, 401);
  assert.equal((await chat.POST(req("POST", { origin: "http://localhost:3001", cookie }))).status, 403, "cross-site write refused even with a session");
  assert.equal((await overview.GET(req("GET", { cookie }))).status, 200);
});

await test("the sign-in throttle map stays bounded and drops unlocked counters before locks", () => {
  const fails = new Map<string, { count: number; since: number; lockedUntil: number }>();
  const now = 1_000_000_000;
  const extra = 50;
  for (let i = 0; i < session.MAX_FAILURE_KEYS + extra; i++) {
    // The first 10 are locked and the oldest of all; the rest are fresh counters
    fails.set(`k${i}`, i < 10 ? { count: 0, since: now - 1000 + i, lockedUntil: now + 60_000 } : { count: 1, since: now - 500 + i, lockedUntil: 0 });
  }
  session.pruneFailures(fails, now);
  assert.equal(fails.size, session.MAX_FAILURE_KEYS);
  for (let i = 0; i < 10; i++) assert.ok(fails.has(`k${i}`), "locks are kept while unlocked counters can go");
  assert.ok(!fails.has("k10") && fails.has(`k${session.MAX_FAILURE_KEYS + extra - 1}`), "oldest counters go first, newest stay");
  // All locked: the oldest locks go
  const locks = new Map<string, { count: number; since: number; lockedUntil: number }>();
  for (let i = 0; i < session.MAX_FAILURE_KEYS + 3; i++) locks.set(`l${i}`, { count: 0, since: now + i, lockedUntil: now + 60_000 });
  session.pruneFailures(locks, now);
  assert.equal(locks.size, session.MAX_FAILURE_KEYS);
  assert.ok(!locks.has("l0") && !locks.has("l2") && locks.has("l3"));
});

await test("the sign-in log is capped, failed tries going before successes", () => {
  type L = Parameters<typeof session.trimLoginLog>[0][number];
  const entry = (i: number, result: L["result"]): L => ({ id: `e${i}`, user: "u", name: null, role: null, at: "", ip: "", userAgent: "", result });
  const log: L[] = [entry(0, "success"), entry(1, "success")];
  for (let i = 2; i < session.MAX_LOGIN_LOG + 5; i++) log.push(entry(i, "bad_password"));
  session.trimLoginLog(log);
  assert.equal(log.length, session.MAX_LOGIN_LOG);
  assert.deepEqual(log.slice(0, 3).map((l) => l.id), ["e0", "e1", "e7"], "the two successes stay; the 5 oldest failures went");
  const wins: L[] = Array.from({ length: session.MAX_LOGIN_LOG + 2 }, (_, i) => entry(i, "success"));
  session.trimLoginLog(wins);
  assert.equal(wins.length, session.MAX_LOGIN_LOG);
  assert.equal(wins[0].id, "e2", "only successes: the oldest go");
});

process.chdir(tmpdir());
rmSync(dir, { recursive: true, force: true });
console.log(`guards.test: ${passed} passed`);
