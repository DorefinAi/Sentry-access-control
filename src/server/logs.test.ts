// Backend logs → sentry.local.db → /api/logs, against a fake backend and a temp folder.
// Run: node --no-warnings --import ./scripts/test-resolve.mjs src/server/logs.test.ts
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sentry-logs-test-"));
process.chdir(dir); // db.ts puts sentry.local.db in process.cwd()

const load = async <T>(rel: string): Promise<T> => (await import(new URL(rel, import.meta.url).href)) as T;
const { redactText, redactFields } = await load<typeof import("./redact")>("./redact.ts");
const sync = await load<typeof import("./logSync")>("./logSync.ts");
const logs = await load<typeof import("./logs")>("./logs.ts");

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
}

// ─── Redaction ──────────────────────────────────────────────────────────────

await test("secrets are removed from text", () => {
  const cases: [string, string][] = [
    ["login ok password=hunter2 next", "login ok password=[redacted] next"],
    ['{"api_key": "abc123", "user": "x"}', '{"api_key": "[redacted]", "user": "x"}'],
    ["Authorization: Bearer abc.def.ghi", "Authorization: [redacted]"],
    ["sent Bearer sk_live_123", "sent Bearer [redacted]"],
    ["token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghij in header", "token [redacted] in header"],
    ["GET https://u:p4ss@ftp.example.com/x", "GET https://[redacted]@ftp.example.com/x"],
    ["/cb?code=1&session=xyz&ok=1", "/cb?code=1&session=[redacted]&ok=1"],
    ["mail from pooja.sharma@example.com", "mail from p***@example.com"],
    ["whatsapp +91 98290 12345 joined", "whatsapp +********2345 joined"],
    ["story 271026_JPR_RAIN_AV_POOJA filed at 2026-10-27", "story 271026_JPR_RAIN_AV_POOJA filed at 2026-10-27"],
  ];
  for (const [input, want] of cases) assert.equal(redactText(input), want, input);
});

await test("fields keep scalars only, at most 20, with secret keys blanked", () => {
  const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i]));
  assert.equal(Object.keys(redactFields(many)!).length, 20);
  assert.deepEqual(redactFields({ otp: "1234", nested: { a: 1 }, list: [1], ok: true, who: "a@b.co" }), { otp: "[redacted]", ok: true, who: "a***@b.co" });
  assert.equal(redactFields("text"), null);
});

// ─── Pulling ────────────────────────────────────────────────────────────────

const lines = [
  { id: "1", at: "2026-11-06T10:00:00.123456+05:30", system: "samvadia-api", level: "info", logger: "intake", message: "story received", slug: "S1", itemId: null, fields: null },
  { id: "2", at: "2026-11-06T10:00:01+05:30", system: "samvadia-worker", level: "error", logger: "jobs", message: "ftp upload failed password=hunter2", slug: "S1", itemId: "42", fields: { tries: 3, token: "x" } },
  { id: "3", at: "2026-11-06T10:00:02+05:30", system: "socia-api", level: "info", logger: null, message: "not ours", slug: null, itemId: null, fields: null }, // wrong backend: dropped
  { id: "4", at: "not a time", system: "samvadia-api", level: "info", logger: null, message: "bad time", slug: null, itemId: null, fields: null }, // dropped
  { id: "5", at: "2026-11-06T10:00:03+05:30", system: "samvadia-api", level: "warn", logger: "auth", message: "slow login", slug: null, itemId: null, fields: null },
];

const calls: string[] = [];
const fakeFetch = (async (url: string | URL) => {
  calls.push(String(url));
  const after = Number(new URL(String(url)).searchParams.get("after"));
  const entries = lines.filter((l) => Number(l.id) > after);
  const body = {
    system: "samvadia",
    entries,
    next: entries.length ? entries[entries.length - 1].id : null,
    heartbeats: [{ process: "worker", system: "samvadia-worker", host: "box", pid: 1, startedAt: "2026-11-06T09:00:00Z", beatAt: new Date().toISOString(), info: null }],
    dropped: 2,
  };
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

process.env.SAMVADIA_API_URL = "http://127.0.0.1:8000";
process.env.SAMVADIA_OWNER_KEY = "k".repeat(40);

await test("a pull stores valid lines once, redacted, and moves the cursor", async () => {
  assert.equal(sync.logsLive(), true);
  assert.equal(await sync.pullSource("samvadia", fakeFetch), 3);
  assert.match(calls[0], /\/owner\/logs\?after=0&limit=1000$/);
  assert.equal(await sync.pullSource("samvadia", fakeFetch), 0, "a second pull adds nothing");
  assert.match(calls[1], /after=5/);
  const err = logs.getLog("samvadia-2");
  assert.equal(err.message, "ftp upload failed password=[redacted]");
  assert.deepEqual(err.fields, { tries: 3, token: "[redacted]" });
  assert.equal(err.itemId, "42");
  const [status] = sync.sourceStatus();
  assert.equal(status.dropped, 2);
  assert.equal(status.processes[0].process, "worker");
  assert.equal(status.lastError, null);
});

await test("a failing backend is recorded, not thrown away silently", async () => {
  const down = (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
  await assert.rejects(sync.pullSource("samvadia", down));
  assert.match(sync.sourceStatus()[0].lastError ?? "", /error \(500\)/);
  await sync.pullSource("samvadia", fakeFetch);
  assert.equal(sync.sourceStatus()[0].lastError, null, "cleared by the next good pull");
});

// ─── Reading ────────────────────────────────────────────────────────────────

const q = (s: string) => logs.queryLogs(logs.parseLogQuery(new URLSearchParams(s)));

await test("filters, newest first, and (at, id) paging", () => {
  const all = q("");
  assert.equal(all.live, true);
  assert.deepEqual(all.entries.map((e) => e.id), ["samvadia-5", "samvadia-2", "samvadia-1"]);
  assert.equal(q("level=warn").total, 2, "warn and above");
  assert.equal(q("system=samvadia-worker").total, 1);
  assert.equal(q("slug=S1").total, 2);
  assert.equal(q("q=FTP UPLOAD").total, 1);
  assert.equal(q("q=50%").total, 0, "% is not a wildcard");
  const p1 = q("limit=2");
  assert.equal(p1.entries.length, 2);
  const p2 = q(`limit=2&cursor=${p1.nextCursor}`);
  assert.deepEqual(p2.entries.map((e) => e.id), ["samvadia-1"]);
  assert.equal(p2.nextCursor, null);
});

await test("a range counts from the real clock for live logs", () => {
  const start = logs.rangeStart("1h", Date.parse("2026-11-06T10:30:00+05:30"))!;
  assert.equal(new Date(start).toISOString(), "2026-11-06T04:00:00.000Z");
  assert.equal(new Date(logs.rangeStart("today", Date.parse("2026-11-06T01:00:00+05:30"))!).toISOString(), "2026-11-05T18:30:00.000Z");
  assert.equal(q("range=all").total, 3);
  assert.equal(q("range=15m").total, 0, "the test lines are older than 15 minutes");
});

await test("old lines are pruned after 30 days", () => {
  assert.equal(sync.pruneLogs(Date.parse("2026-12-07T00:00:00Z")), 3);
  assert.equal(q("").total, 0);
});

await test("with no backend configured the demo data is served", () => {
  delete process.env.SAMVADIA_API_URL;
  const page = q("range=all");
  assert.equal(page.live, false);
  assert.ok(page.total > 0);
});

await test("the action log and sign-in log survive a restart", async () => {
  const st = await load<typeof import("./store")>("./store.ts");
  st.recordAction({ at: st.liveNow(), user: "ada", kind: "team", text: "Made otto an operator" });
  await st.saveAudit();
  (globalThis as { __sentryStore?: unknown }).__sentryStore = undefined; // what a restart does to memory
  const after = st.store().actionLog;
  assert.equal(after.at(-1)?.text, "Made otto an operator");
  assert.ok(after.at(-1)?.realAt, "real time kept");
});

process.chdir(tmpdir());
try {
  (globalThis as { __sentryDb?: { db: { close(): void } } }).__sentryDb?.db.close();
  rmSync(dir, { recursive: true, force: true });
} catch {
  // Windows can hold the WAL files a moment longer; the temp folder is cleaned by the OS
}
console.log(`logs.test: ${passed} passed`);
