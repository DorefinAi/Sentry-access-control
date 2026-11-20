// The ops client and pull (dev-docs/ops-status-contract.md) against a fake backend, in a temp folder.
// Run: node --no-warnings --import ./scripts/test-resolve.mjs src/server/ops/ops.test.ts
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sentry-ops-test-"));
process.chdir(dir); // db.ts puts sentry.local.db in process.cwd()
process.env.SAMVADIA_API_URL = "http://127.0.0.1:8000";
process.env.SAMVADIA_OWNER_KEY = "s".repeat(40);
process.env.SOCIA_API_URL = "http://127.0.0.1:8200";
process.env.SOCIA_OWNER_KEY = "o".repeat(40);

const load = async <T>(rel: string): Promise<T> => (await import(new URL(rel, import.meta.url).href)) as T;
const client = await load<typeof import("./client")>("./client.ts");
const pull = await load<typeof import("./pull")>("./pull.ts");
const time = await load<typeof import("../time")>("../time.ts");
const trace = await load<typeof import("../trace")>("../trace.ts");
const logins = await load<typeof import("../logins")>("../logins.ts");
const { db } = await load<typeof import("../db")>("../db.ts");
const { transaction } = await load<typeof import("../db")>("../db.ts");

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
}

const T0 = Date.parse("2026-11-20T10:00:00+05:30");
let clock = T0;
time.setClockForTests(() => clock);

export function summary(over: Record<string, unknown> = {}) {
  return {
    generatedAt: "2026-11-20T10:00:00+05:30",
    date: "2026-11-20",
    phase: null,
    processes: [{ process: "worker", system: "samvadia-worker", host: "PC", startedAt: "2026-11-20T08:00:00+05:30", beatAt: "2026-11-20T09:59:50+05:30" }],
    checks: [
      { id: "db", label: "Database", ok: true, lastOkAt: "2026-11-20T09:59:59+05:30", lastError: null, detail: null },
      { id: "ftp", label: "FTP", ok: false, lastOkAt: null, lastError: "421 password=hunter2 refused", detail: null },
    ],
    stages: [{ id: "desk", count: 12, waiting: 4, oldestWaitingAt: "2026-11-20T09:20:00+05:30", failed: 0, note: null }, { id: "bad" }, { nope: 1 }],
    flow: { storiesIn: 40, bySource: { portal: 10, outlook: 20, whatsapp: 10, share: 0 }, approved: 30, rejected: 5, inFeed: 28, collected: 27, medianMinutesToFeed: 14, posts: 0, recalled: 0 },
    hourly: [{ hour: 9, storiesIn: 6, errors: 1 }, { hour: 30, storiesIn: 99, errors: 0 }],
    stuck: [{ slug: "201126_AJM_FIRE", headline: "Fire", stage: "ftp", since: "2026-11-20T09:18:00+05:30", minutes: 42 }, { slug: "", stage: "x", since: "no" }],
    failures: [{ label: "FTP upload", count: 2 }],
    queues: [{ name: "default", pending: 3, running: 1, failed: 0, oldestPendingSec: 12 }],
    ...over,
  };
}

type Route = (url: URL) => { status: number; body?: unknown } | "down";
const fake = (route: Route) => {
  const calls: string[] = [];
  const f = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(`${url.port}${url.pathname}${url.search}`);
    assert.ok(String((init?.headers as Record<string, string>).Authorization).startsWith("Bearer "));
    assert.equal((init?.headers as Record<string, string>)["X-Owner-Actor"], "sentry-sync");
    const r = route(url);
    if (r === "down") throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    return new Response(r.body === undefined ? "" : JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { f, calls };
};

await test("a summary is read, checked and redacted; bad items are dropped", async () => {
  const { f, calls } = fake(() => ({ status: 200, body: summary() }));
  const s = await client.fetchSummary("samvadia", { fetchImpl: f });
  assert.equal(calls[0], "8000/owner/ops/summary");
  assert.equal(s.flow.storiesIn, 40);
  assert.equal(s.stages.length, 2, "the item without an id is dropped");
  assert.deepEqual(s.stages[1], { id: "bad", count: 0, waiting: 0, oldestWaitingAt: null, failed: 0, note: null });
  assert.equal(s.hourly.length, 24);
  assert.equal(s.hourly[9].storiesIn, 6);
  assert.equal(s.stuck.length, 1);
  assert.equal(s.checks[1].lastError, "421 password=[redacted] refused");
  assert.equal(s.queues[0].pending, 3);
});

await test("a summary in the wrong shape is refused with a plain reason", async () => {
  const { f } = fake(() => ({ status: 200, body: { generatedAt: "x" } }));
  await assert.rejects(client.fetchSummary("socia", { fetchImpl: f }), /shape Sentry does not understand/);
});

await test("a backend without the ops routes says so (404 without a code)", async () => {
  const { f } = fake(() => ({ status: 404, body: { detail: "Not Found" } }));
  await assert.rejects(client.fetchSummary("socia", { fetchImpl: f }), /does not serve GET \/owner\/ops\/summary yet/);
});

await test("a pull stores a snapshot and the day's summary; a failure is stored too", async () => {
  const ok = fake(() => ({ status: 200, body: summary() }));
  const st = await pull.pullOps("samvadia", ok.f, clock);
  assert.equal(st.error, null);
  assert.equal(pull.freshSummary("samvadia", clock)?.flow.approved, 30);
  assert.equal(pull.dailySummary("samvadia", "2026-11-20")?.flow.inFeed, 28);
  assert.deepEqual(pull.dailySlowest("samvadia", "2026-11-20"), [{ slug: "201126_AJM_FIRE", minutes: 42, stage: "ftp" }]);

  clock += 30_000;
  const down = fake(() => "down");
  const st2 = await pull.pullOps("samvadia", down.f, clock);
  assert.match(st2.error!, /Could not reach/);
  assert.equal(st2.summary?.flow.approved, 30, "the last good answer is kept...");
  assert.ok(pull.freshSummary("samvadia", clock), "...and still fresh 30 s later");
  assert.equal(pull.snapshotAt("samvadia", clock)?.summary, null, "the failed pull is what describes that moment");
  assert.match(pull.snapshotAt("samvadia", clock)!.error!, /Could not reach/);
  assert.equal(pull.snapshotAt("samvadia", clock - 30_000)?.summary?.flow.storiesIn, 40);
});

await test("a summary older than opsStaleSec is not used, and the reason says why", () => {
  clock += 200_000;
  assert.equal(pull.freshSummary("samvadia", clock), null);
  assert.match(pull.opsProblem("samvadia", clock)!, /Could not reach/);
  assert.equal(pull.snapshotAt("samvadia", clock), null, "no snapshot within 2 min of that moment");
});

await test("an unchanged answer extends the last snapshot instead of adding a row", async () => {
  const rows = () => (db().prepare("SELECT count(*) AS n FROM ops_snapshots WHERE source = 'samvadia'").get() as { n: number }).n;
  const before = rows();
  const same = fake(() => ({ status: 200, body: summary({ generatedAt: new Date(clock).toISOString() }) })); // only generatedAt differs
  clock += 30_000;
  await pull.pullOps("samvadia", same.f, clock);
  clock += 30_000;
  await pull.pullOps("samvadia", fake(() => ({ status: 200, body: summary({ generatedAt: "2026-11-20T10:05:00+05:30" }) })).f, clock);
  assert.equal(rows(), before + 1, "one new row after the failure, then extended");
  assert.equal(pull.snapshotAt("samvadia", clock)?.summary?.flow.storiesIn, 40);
  assert.ok(pull.snapshotAt("samvadia", clock - 20_000)?.summary, "a moment inside the stretch is covered");
});

await test("a backend without URL and key is not connected, never pulled", async () => {
  const saved = process.env.SOCIA_OWNER_KEY;
  delete process.env.SOCIA_OWNER_KEY;
  const { f, calls } = fake(() => ({ status: 200, body: summary() }));
  const st = await pull.pullOps("socia", f, clock);
  assert.equal(st.configured, false);
  assert.equal(calls.length, 0);
  assert.match(pull.opsProblem("socia", clock)!, /not connected/);
  process.env.SOCIA_OWNER_KEY = saved;
});

await test("when the day turns over, yesterday's final summary is read once", async () => {
  pull.resetOpsCache();
  const { f, calls } = fake((u) => ({ status: 200, body: summary(u.searchParams.get("date") ? { date: "2026-11-20", flow: { ...summary().flow, storiesIn: 55 } } : { date: "2026-11-21" }) }));
  clock = Date.parse("2026-11-21T00:00:20+05:30");
  await pull.pullOps("samvadia", f, clock);
  assert.deepEqual(calls, ["8000/owner/ops/summary", "8000/owner/ops/summary?date=2026-11-20"]);
  assert.equal(pull.dailySummary("samvadia", "2026-11-20")?.flow.storiesIn, 55);
  // What is stuck now (after midnight) belongs to the new day, not to yesterday's slowest
  assert.deepEqual(pull.dailySlowest("samvadia", "2026-11-20"), [{ slug: "201126_AJM_FIRE", minutes: 42, stage: "ftp" }]);
  assert.ok(pull.opsDates().includes("2026-11-21"));
});

await test("a story is joined across both backends by slug, with its log lines as evidence", async () => {
  transaction((d) => {
    const ins = d.prepare("INSERT INTO logs (source, src_id, at_ms, at, system, level, logger, message, slug, item_id, fields) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, NULL)");
    ins.run("samvadia", "9001", Date.parse("2026-11-20T09:01:00+05:30"), "2026-11-20T03:31:00.000Z", "samvadia-api", "info", "story received", "S1");
    ins.run("socia", "9002", Date.parse("2026-11-20T09:40:00+05:30"), "2026-11-20T04:10:00.000Z", "socia-render", "error", "render failed: overflow", "S1");
  });
  const { f, calls } = fake((u) => {
    if (u.pathname.endsWith("/story/NOPE")) return { status: 404, body: { error: "not_found", message: "x" } };
    if (u.port === "8000")
      return {
        status: 200,
        body: {
          slug: "S1", headline: "Fire in Ajmer", reporter: "Ramesh", city: "Ajmer", source: "whatsapp", state: "done", stuckAt: null,
          steps: [
            { stage: "intake", label: "Received on WhatsApp", system: "samvadia-api", state: "done", at: "2026-11-20T09:00:00+05:30", detail: "3 files" },
            { stage: "octopus", label: "Collected by Octopus", system: "octopus", state: "done", at: "2026-11-20T09:20:00+05:30", detail: null },
          ],
        },
      };
    return {
      status: 200,
      body: {
        slug: "S1", headline: "Fire in Ajmer", reporter: null, city: null, source: "share", state: "failed", stuckAt: "render",
        steps: [
          { stage: "ingest", label: "Taken in by Socia", system: "socia-ingest", state: "done", at: "2026-11-20T09:30:00+05:30", detail: null },
          { stage: "render", label: "Card rendered", system: "socia-render", state: "failed", at: "2026-11-20T09:41:00+05:30", detail: "text overflow" },
          { stage: "publish", label: "Posted on X", system: "nonsense", state: "waiting", at: null, detail: null },
        ],
      },
    };
  });
  const t = await trace.getTrace("S1", f);
  assert.ok(calls.includes("8000/owner/ops/story/S1") && calls.includes("8200/owner/ops/story/S1"));
  assert.deepEqual(t.steps.map((s) => s.stage), ["Received on WhatsApp", "Collected by Octopus", "Taken in by Socia", "Card rendered", "Posted on X"]);
  assert.equal(t.state, "failed", "the worse of the two");
  assert.equal(t.stuckAt, "Card rendered");
  assert.equal(t.reporter, "Ramesh");
  assert.equal(t.source, "whatsapp");
  assert.equal(t.steps[4].system, "x", "an unknown system falls back to the stage's");
  assert.deepEqual(t.steps[0].evidence?.map((e) => e.id), ["samvadia-9001"]);
  assert.deepEqual(t.steps[3].evidence?.map((e) => e.id), ["socia-9002"]);

  const missing = fake((u) => (u.pathname.includes("/story/") ? { status: 404, body: { error: "not_found", message: "x" } } : { status: 200, body: {} }));
  await assert.rejects(trace.getTrace("NOPE", missing.f), /No story with slug NOPE/);
  const down = fake(() => "down");
  await assert.rejects(trace.getTrace("S1", down.f), (e: unknown) => (e as { status?: number }).status === 503);
});

await test("story search merges both backends, newest first", async () => {
  const { f } = fake((u) => ({
    status: 200,
    body: { items: u.port === "8000" ? [{ slug: "A", headline: "a", receivedAt: "2026-11-20T09:00:00+05:30", stage: "desk", state: "on_track" }] : [{ slug: "A", headline: "a", receivedAt: "2026-11-20T09:30:00+05:30" }, { slug: "B", headline: "b", receivedAt: "2026-11-20T10:00:00+05:30" }, { slug: 5 }] },
  }));
  const { hits, partial } = await trace.searchTraces("a", f);
  assert.equal(partial, null);
  assert.deepEqual(hits.map((h) => [h.slug, h.receivedAt]), [["B", "2026-11-20T10:00:00+05:30"], ["A", "2026-11-20T09:00:00+05:30"]]);
  // An older backend refuses date=all: asked again for today
  const old = fake((u) => (u.searchParams.get("date") === "all" ? { status: 422, body: { error: "invalid", message: "bad date" } } : { status: 200, body: { items: [{ slug: "C", headline: "c", receivedAt: "2026-11-20T09:00:00+05:30" }] } }));
  const { hits: again } = await trace.searchTraces("c", old.f);
  assert.ok(old.calls.some((c) => c.includes("date=all")) && old.calls.some((c) => !c.includes("date=")));
  assert.deepEqual(again.map((h) => h.slug), ["C"]);
});

await test("sign-ins are read and bad events dropped", async () => {
  const { f, calls } = fake(() => ({
    status: 200,
    body: {
      events: [
        { id: "1", at: "2026-11-20T09:00:00+05:30", app: "assignment-desk", user: "desk", name: "Desk", role: "desk", ip: "10.0.0.2", userAgent: "x".repeat(400), result: "success" },
        { id: "2", at: "2026-11-20T09:00:00+05:30", app: "mail", user: "x", ip: "1", result: "success" },
      ],
      activeSessions: [{ app: "assignment-desk", user: "desk", since: "2026-11-20T09:00:00+05:30", lastSeen: "2026-11-20T09:30:00+05:30", ip: "10.0.0.2" }],
    },
  }));
  const r = await client.fetchLogins("samvadia", "2026-11-20", f);
  assert.equal(calls[0], "8000/owner/ops/logins?date=2026-11-20");
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].id, "samvadia-1");
  assert.equal(r.events[0].userAgent.length, 200);
  assert.equal(r.activeSessions.length, 1);
});

await test("sign-ins: v1.1 totals and truncation, old shape too, nullable session fields", async () => {
  const v11 = fake(() => ({
    status: 200,
    body: {
      events: [{ id: "1", at: "2026-11-21T09:00:00+05:30", app: "digital-desk", user: "op", name: "Op", role: "operator", ip: "10.0.0.3", userAgent: "UA", result: "success" }],
      activeSessions: [{ app: "digital-desk", user: "op", since: "2026-11-21T09:00:00+05:30", lastSeen: null, ip: null }],
      totals: { success: 12, failed: 40000 },
      truncated: true,
    },
  }));
  const r = await client.fetchLogins("socia", "2026-11-21", v11.f);
  assert.deepEqual(r.totals, { success: 12, failed: 40000 });
  assert.equal(r.truncated, true);
  assert.equal(r.activeSessions[0].lastSeen, null, "not copied from since");
  assert.equal(r.activeSessions[0].ip, null);
  const old = fake(() => ({ status: 200, body: { events: [], activeSessions: [] } }));
  const o = await client.fetchLogins("samvadia", "2026-11-21", old.f);
  assert.equal(o.totals, null);
  assert.equal(o.truncated, false);
});

await test("the logins report says which backend answered, uses true totals, and hides details below admin", async () => {
  logins.resetLoginCache();
  const f = fake((u) =>
    u.port === "8000"
      ? "down"
      : {
          status: 200,
          body: {
            events: [
              { id: "1", at: "2026-11-21T09:00:00+05:30", app: "digital-desk", user: "op", name: "Op", role: "operator", ip: "10.0.0.3", userAgent: "UA", result: "success" },
              { id: "2", at: "2026-11-21T09:01:00+05:30", app: "digital-desk", user: "my-password", name: "Op", role: "operator", ip: "10.0.0.9", userAgent: "UA", result: "bad_password" },
            ],
            activeSessions: [{ app: "digital-desk", user: "op", since: "2026-11-21T09:00:00+05:30", lastSeen: null, ip: "10.0.0.3" }],
            totals: { success: 12, failed: 40000 },
            truncated: true,
          },
        },
  );
  const r = await logins.loginReport("2026-11-21", undefined, { fetchImpl: f.f });
  const sam = r.sources.find((s) => s.source === "samvadia")!;
  const soc = r.sources.find((s) => s.source === "socia")!;
  assert.equal(sam.state, "unreachable");
  assert.match(sam.message!, /Could not reach/);
  assert.equal(soc.state, "ok");
  assert.equal(soc.truncated, true);
  assert.equal(r.totals.failed, 40000, "the backend's true count, not the 1 event sent");
  assert.equal(r.totals.success, 12);
  const failed = r.events.find((e) => e.result !== "success")!;
  assert.deepEqual([failed.user, failed.name, failed.role, failed.ip, failed.userAgent], ["(hidden)", null, null, "(hidden)", "(hidden)"]);
  const ok = r.events.find((e) => e.result === "success")!;
  assert.deepEqual([ok.user, ok.name, ok.ip], ["op", "Op", "(hidden)"]);
  assert.deepEqual(r.activeSessions.map((s) => [s.user, s.ip]), [["(hidden)", null]]);
  const admin = await logins.loginReport("2026-11-21", undefined, { fetchImpl: f.f, revealFailedUsers: true });
  assert.equal(admin.events.find((e) => e.result !== "success")!.user, "my-password");
  assert.equal(admin.activeSessions[0].ip, "10.0.0.3");
  assert.equal(admin.sources.find((s) => s.source === "samvadia")!.state, "unreachable");
});

await test("repeated failures are found per address in one pass (sliding 10 min window)", () => {
  const ev = (id: string, min: number, ip: string, result: "success" | "bad_password") => ({ id, at: new Date(Date.parse("2026-11-21T10:00:00+05:30") + min * 60_000).toISOString(), app: "digital-desk" as const, user: "u", name: null, role: null, ip, userAgent: "", result });
  const out = logins.flagEvents([ev("a", 0, "1.1.1.1", "bad_password"), ev("b", 1, "1.1.1.1", "bad_password"), ev("c", 2, "2.2.2.2", "bad_password"), ev("d", 3, "1.1.1.1", "bad_password"), ev("e", 20, "1.1.1.1", "bad_password")]);
  const flags = Object.fromEntries(out.map((e) => [e.id, e.flags.includes("repeated_failures")]));
  assert.deepEqual(flags, { a: false, b: false, c: false, d: true, e: false });
});

await test("a refused key (401) or a rate limit (429) pauses that backend for ops pull and log sync", async () => {
  const backoff = await load<typeof import("../backoff")>("../backoff.ts");
  const sync = await load<typeof import("../logSync")>("../logSync.ts");
  backoff.resetBackoff();
  pull.resetOpsCache();
  const refused = fake(() => ({ status: 401, body: { error: "unauthorized", message: "bad key" } }));
  const st = await pull.pullOps("socia", refused.f, clock);
  assert.match(st.error!, /refused Sentry's owner key.*waits until/);
  assert.equal(refused.calls.length, 1);
  // Within 5 min: nothing is sent, by either reader, and the status says why
  clock += 60_000;
  const again = await pull.pullOps("socia", refused.f, clock);
  assert.equal(refused.calls.length, 1, "no new call while paused");
  assert.match(again.error!, /waits until/);
  const logCalls = fake(() => ({ status: 200, body: { entries: [], next: null } }));
  assert.equal(await sync.pullSource("socia", logCalls.f), 0);
  assert.equal(logCalls.calls.length, 0, "log sync skips the paused backend too");
  assert.match(sync.sourceStatus().find((x) => x.source === "socia")!.lastError!, /waits until/);
  // After the pause, it asks again
  clock += 5 * 60_000;
  await pull.pullOps("socia", refused.f, clock);
  assert.equal(refused.calls.length, 2);

  // 429 with Retry-After: waits at least that long
  backoff.resetBackoff();
  const limited = (async () => new Response(JSON.stringify({ error: "rate_limited", message: "x" }), { status: 429, headers: { "retry-after": "900" } })) as unknown as typeof fetch;
  await pull.pullOps("samvadia", limited, clock);
  assert.ok(backoff.pausedFor("samvadia", clock + 14 * 60_000), "still paused after 14 min");
  assert.equal(backoff.pausedFor("samvadia", clock + 16 * 60_000), null);
  // An ordinary failure (not reachable) does not pause
  backoff.resetBackoff();
  await pull.pullOps("samvadia", fake(() => "down").f, clock);
  assert.equal(backoff.pausedFor("samvadia", clock), null);
});

await test("a failed pull whose snapshot cannot be stored still returns, and pullAllOps never throws", async () => {
  const backoff = await load<typeof import("../backoff")>("../backoff.ts");
  backoff.resetBackoff();
  db().exec("ALTER TABLE ops_snapshots RENAME TO ops_snapshots_away");
  try {
    const st = await pull.pullOps("samvadia", fake(() => "down").f, clock);
    assert.match(st.error!, /Could not reach/);
    await pull.pullAllOps(fake(() => "down").f);
  } finally {
    db().exec("ALTER TABLE ops_snapshots_away RENAME TO ops_snapshots");
  }
});

await test("tries without an address are not grouped as repeated failures", () => {
  const ev = (id: string, min: number) => ({ id, at: new Date(Date.parse("2026-11-21T11:00:00+05:30") + min * 60_000).toISOString(), app: "digital-desk" as const, user: "u", name: null, role: null, ip: "", userAgent: "", result: "bad_password" as const });
  const out = logins.flagEvents([ev("x1", 0), ev("x2", 1), ev("x3", 2), ev("x4", 3)]);
  assert.ok(out.every((e) => !e.flags.includes("repeated_failures")));
});

time.setClockForTests(null);
(globalThis as { __sentryDb?: { db: { close(): void } } }).__sentryDb?.db.close();
process.chdir(tmpdir());
try {
  rmSync(dir, { recursive: true, force: true });
} catch {
  // Windows can hold the WAL files a moment longer; the temp folder is cleaned by the OS
}
console.log(`ops.test: ${passed} passed`);
