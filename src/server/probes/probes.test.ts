// Health probes and the stored health history, with fake HTTP, a fake sc and fake backup files.
// Run: node --no-warnings --import ./scripts/test-resolve.mjs src/server/probes/probes.test.ts
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sentry-probes-test-"));
process.chdir(dir);

const load = async <T>(rel: string): Promise<T> => (await import(new URL(rel, import.meta.url).href)) as T;
const probes = await load<typeof import("./probes")>("./probes.ts");
const health = await load<typeof import("./health")>("./health.ts");
const { RULE_DEFAULTS } = await load<typeof import("../thresholds")>("../thresholds.ts");
type Deps = import("./probes").ProbeDeps;
type Summary = import("../ops/types").OpsSummary;

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
}

const NOW = Date.parse("2026-11-20T12:00:00+05:30");
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

await test("a heartbeat is ok, then warn at 90 s, then down at 5 min", () => {
  const lv = { heartbeatWarnSec: 90, heartbeatDownSec: 300 };
  assert.deepEqual(probes.heartbeatHealth(iso(30_000), NOW, lv), { health: "ok", ageSec: 30, gone: false });
  assert.equal(probes.heartbeatHealth(iso(89_000), NOW, lv).health, "ok");
  assert.equal(probes.heartbeatHealth(iso(90_000), NOW, lv).health, "warn");
  assert.equal(probes.heartbeatHealth(iso(299_000), NOW, lv).health, "warn");
  assert.equal(probes.heartbeatHealth(iso(300_000), NOW, lv).health, "down");
});

await test("sc query output is read for the service state", () => {
  const running = "SERVICE_NAME: socia\n        TYPE               : 10  WIN32_OWN_PROCESS\n        STATE              : 4  RUNNING\n";
  assert.equal(probes.parseScState(running), "RUNNING");
  assert.equal(probes.parseScState("        STATE              : 1  STOPPED"), "STOPPED");
  assert.equal(probes.parseScState("[SC] EnumQueryServicesStatus:OpenService FAILED 1060:"), null);
});

await test("a Socia worker process speaks for each role it runs", () => {
  assert.deepEqual(probes.processSystems("socia", "worker:ingest,pipeline,render,publish,maintenance,trends", "socia-ingest").sort(), ["socia-crons", "socia-ingest", "socia-publish", "socia-render"]);
  assert.deepEqual(probes.processSystems("socia", "api", "socia-api"), ["socia-api"]);
  assert.deepEqual(probes.processSystems("samvadia", "worker", "bogus"), ["samvadia-worker"]);
});

await test("backend checks: ok, failing (down) and never checked (unknown)", () => {
  const c = (ok: boolean | null) => ({ id: "ftp", label: "FTP", ok, lastOkAt: null, lastError: ok === false ? "421" : null, detail: null });
  assert.equal(probes.checkProbe("samvadia", c(true), NOW).health, "ok");
  const bad = probes.checkProbe("samvadia", c(false), NOW);
  assert.equal(bad.health, "down");
  assert.equal(bad.reason, "FTP failing: 421");
  assert.deepEqual(bad.systems, ["ftp"]);
  assert.equal(probes.checkProbe("samvadia", c(null), NOW).health, "unknown");
  assert.deepEqual(probes.checkProbe("socia", { ...c(true), id: "db" }, NOW).systems, ["postgres"]);
});

await test("the newest backup's age: ok, over 26 h warn, none found down, unreadable unknown", () => {
  const h = 3_600_000;
  const fresh = probes.backupProbe([{ name: "socia-1.dump", mtimeMs: NOW - 30 * h }, { name: "socia-2.dump", mtimeMs: NOW - 2 * h }], NOW, 26, "X");
  assert.equal(fresh.health, "ok");
  assert.equal(fresh.value, 2);
  const old = probes.backupProbe([{ name: "socia-1.dump", mtimeMs: NOW - 30 * h }], NOW, 26, "X");
  assert.equal(old.health, "warn");
  assert.match(old.reason, /30 h old \(over 26 h\)/);
  assert.equal(probes.backupProbe([], NOW, 26, "X").health, "down");
  assert.equal(probes.backupProbe(null, NOW, 26, "X").health, "unknown");
});

const summary = (over: Partial<Summary> = {}): Summary => ({
  generatedAt: iso(0),
  date: "2026-11-20",
  phase: 1,
  processes: [],
  checks: [],
  stages: [],
  flow: { storiesIn: 0, bySource: { portal: 0, outlook: 0, whatsapp: 0, share: 0 }, approved: 0, rejected: 0, inFeed: 0, collected: 0, medianMinutesToFeed: null, posts: 0, recalled: 0 },
  hourly: [],
  stuck: [],
  failures: [],
  queues: [],
  ...over,
});

function deps(over: Partial<Deps> = {}): Deps {
  return {
    now: NOW,
    levels: { ...RULE_DEFAULTS },
    fetchImpl: (async (u: string | URL) => {
      const url = String(u);
      if (url.includes(":8000/health")) return new Response("{}", { status: 200 });
      if (url.includes("/healthz/worker")) return new Response('{"ok":false}', { status: 503 });
      if (url.includes(":8200/healthz")) return new Response("{}", { status: 500 });
      if (url.includes(":3000")) return new Response("", { status: 307 }); // a redirect to its login page is up
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    }) as typeof fetch,
    ops: {
      samvadia: {
        configured: true,
        problem: null,
        summary: summary({
          processes: [{ process: "worker", system: "samvadia-worker", host: "PC", startedAt: iso(9e6), beatAt: iso(400_000) }],
          checks: [
            { id: "db", label: "Database", ok: true, lastOkAt: iso(1000), lastError: null, detail: null },
            { id: "ftp", label: "FTP", ok: false, lastOkAt: null, lastError: "421", detail: null },
          ],
        }),
      },
      socia: { configured: true, summary: null, problem: "Could not reach Socia. Is it running?" },
    },
    backendUrl: (s) => (s === "samvadia" ? "http://127.0.0.1:8000" : "http://127.0.0.1:8200"),
    scQuery: async () => "        STATE              : 1  STOPPED",
    listBackups: async () => [{ name: "socia-1.dump", mtimeMs: NOW - 3_600_000 }],
    ...over,
  };
}

await test("a heartbeat older than 1 h is gone: unknown, so no alert and no effect on the system", async () => {
  const lv = { heartbeatWarnSec: 90, heartbeatDownSec: 300, heartbeatGoneSec: 3600 };
  assert.deepEqual(probes.heartbeatHealth(iso(3_599_000), NOW, lv), { health: "down", ageSec: 3599, gone: false });
  assert.deepEqual(probes.heartbeatHealth(iso(3_600_000), NOW, lv), { health: "unknown", ageSec: 3600, gone: true });
  const d = deps();
  d.ops.samvadia.summary!.processes.push({ process: "old-worker", system: "samvadia-worker", host: "PC", startedAt: iso(9e7), beatAt: iso(5 * 3_600_000) });
  const r = (await probes.runProbes(d)).find((x) => x.target === "hb:samvadia:old-worker")!;
  assert.equal(r.health, "unknown");
  assert.match(r.reason, /gone, ignored/);
  const { heartbeatStale } = await load<typeof import("../detect/rules")>("../detect/rules.ts");
  assert.equal(heartbeatStale({ probes: [r], levels: d.levels } as Parameters<typeof heartbeatStale>[0]).length, 0);
  d.ops.samvadia.summary!.processes = [{ process: "old-worker", system: "samvadia-worker", host: "PC", startedAt: iso(9e7), beatAt: iso(5 * 3_600_000) }];
  const sys = probes.composeSystems(await probes.runProbes(d), () => "none");
  assert.equal(sys["samvadia-worker"].health, "unknown");
});

await test("one probe round covers HTTP, service, backups, heartbeats and checks", async () => {
  const results = await probes.runProbes(deps());
  const by = (t: string) => results.find((r) => r.target === t)!;
  assert.equal(by("http:samvadia-api").health, "ok");
  assert.equal(by("http:socia-api").health, "down");
  assert.equal(by("http:socia-api").reason, "answered 500");
  assert.equal(by("http:socia-worker").reason, "Socia says the worker has stopped");
  assert.equal(by("http:ollama").health, "down");
  assert.equal(by("http:assignment-desk").health, "ok");
  assert.equal(by("http:reporter-portal").reason, "not reachable (is it running?)");
  assert.equal(by("service:tunnel").health, "down");
  assert.equal(by("backups").health, "ok");
  assert.equal(by("hb:samvadia:worker").health, "down");
  assert.equal(by("hb:samvadia:worker").value, 400);
  assert.equal(by("check:samvadia:ftp").health, "down");
  assert.equal(by("ops:socia").health, "down");
  assert.ok(!results.some((r) => r.target.startsWith("hb:socia")), "no heartbeats from a backend Sentry cannot read");
});

await test("sc that cannot run gives its own reason, not 'no service'", async () => {
  const r = (await probes.runProbes(deps({ scQuery: async () => { throw new Error("sc.exe was not found"); } }))).find((x) => x.target === "service:tunnel")!;
  assert.equal(r.health, "unknown");
  assert.equal(r.reason, "Could not run sc: sc.exe was not found");
  const missing = (await probes.runProbes(deps({ scQuery: async () => "[SC] EnumQueryServicesStatus:OpenService FAILED 1060:" }))).find((x) => x.target === "service:tunnel")!;
  assert.match(missing.reason, /No Windows service named/);
});

await test("the stack does not claim all critical systems are up while one is unknown", () => {
  const h = (health: "ok" | "unknown") => ({ health, reason: health, parts: [] });
  const sys = probes.composeSystems([], () => "none");
  for (const id of probes.CRITICAL_SYSTEMS) sys[id] = h("ok");
  assert.equal(probes.stackHealth(sys).reason, "All critical systems up");
  sys["samvadia-worker"] = h("unknown");
  const st = probes.stackHealth(sys);
  assert.doesNotMatch(st.reason, /All critical systems up/);
  assert.match(st.reason, /not known: samvadia-worker/);
});

await test("systems take the worst known part; unknown only when nothing knows", async () => {
  const results = await probes.runProbes(deps({ scQuery: async () => null }));
  const sys = probes.composeSystems(results, (id) => `no data for ${id}`);
  assert.equal(sys["samvadia-api"].health, "ok");
  assert.equal(sys["samvadia-worker"].health, "down");
  assert.equal(sys.ftp.health, "down");
  assert.equal(sys.postgres.health, "ok");
  assert.equal(sys["digital-desk"].health, "down", "the web page is down; the tunnel (not on Windows) is unknown and ignored");
  assert.equal(sys.whatsapp.health, "unknown");
  assert.equal(sys.whatsapp.reason, "no data for whatsapp");
  assert.equal(probes.stackHealth(sys).health, "down");
});

// ─── Stored history ─────────────────────────────────────────────────────────

const MIN = 60_000;
const T = Date.parse("2026-11-20T08:00:00+05:30");

await test("samples are stored as spans: same health stretches, a change starts a new span", () => {
  for (let i = 0; i <= 10; i++) health.recordHealth("ftp", "ok", "fine", T + i * 30_000); // 08:00 - 08:05
  for (let i = 11; i <= 20; i++) health.recordHealth("ftp", "down", `421 at ${i}`, T + i * 30_000); // 08:05:30 - 08:10
  for (let i = 21; i <= 40; i++) health.recordHealth("ftp", "ok", "fine", T + i * 30_000); // 08:10:30 - 08:20
  const spans = health.spansBetween("ftp", T, T + 60 * MIN);
  assert.deepEqual(spans.map((s) => s.health), ["ok", "down", "ok"]);
  assert.equal(spans[1].fromMs, T + 5 * MIN, "a change joins the previous span without a gap");
  assert.equal(spans[1].reason, "421 at 20", "a problem keeps its latest wording");
});

await test("uptime counts watched time only; down 5 of 20 min is 75%", () => {
  assert.equal(health.uptimePct("ftp", T, T + 20 * MIN), 75);
  assert.equal(health.uptimePct("ftp", T - 60 * MIN, T + 20 * MIN), 75, "time before Sentry watched is not counted");
  assert.equal(health.uptimePct("nothing", T, T + MIN), null);
});

await test("outages, the current streak and the longest streak come from the spans", () => {
  const out = health.outages("ftp", T, T + 20 * MIN);
  assert.equal(out.length, 1);
  assert.equal(Date.parse(out[0].from), T + 5 * MIN);
  assert.equal(Date.parse(out[0].to!), T + 10 * MIN);
  const s = health.streakAt("ftp", T + 20 * MIN);
  assert.equal(s.streakSec, 600);
  assert.equal(s.longestStreakSec, 600);
  assert.equal(Date.parse(s.upSince), T + 10 * MIN);
  assert.equal(health.healthAt("ftp", T + 7 * MIN)?.health, "down");
});

await test("an outage still going on has no end and a zero streak", () => {
  for (let i = 41; i <= 44; i++) health.recordHealth("ftp", "down", "421", T + i * 30_000);
  const s = health.streakAt("ftp", T + 22 * MIN);
  assert.equal(s.streakSec, 0);
  assert.equal(s.lastOutage?.to, null);
});

await test("a gap (Sentry was off) is not filled in", () => {
  health.recordHealth("ftp", "down", "421", T + 60 * MIN);
  const spans = health.spansBetween("ftp", T + 50 * MIN, T + 61 * MIN);
  assert.equal(spans.at(-1)!.fromMs, T + 60 * MIN, "a new span after the gap");
  assert.equal(health.healthAt("ftp", T + 40 * MIN), null, "nothing known in the gap");
});

(globalThis as { __sentryDb?: { db: { close(): void } } }).__sentryDb?.db.close();
process.chdir(tmpdir());
try {
  rmSync(dir, { recursive: true, force: true });
} catch {
  // Windows can hold the WAL files a moment longer
}
console.log(`probes.test: ${passed} passed`);
