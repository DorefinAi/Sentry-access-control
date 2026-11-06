// Log summaries count every matching line, not the newest few thousand.
// Run: node --no-warnings --import ./scripts/test-resolve.mjs src/server/logSummary.test.ts
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sentry-logsummary-test-"));
process.chdir(dir); // db.ts puts sentry.local.db in process.cwd()
process.env.SAMVADIA_API_URL = "http://127.0.0.1:8000";
process.env.SAMVADIA_OWNER_KEY = "k".repeat(40);

const load = async <T>(rel: string): Promise<T> => (await import(new URL(rel, import.meta.url).href)) as T;
const { transaction } = await load<typeof import("./db")>("./db.ts");
const logs = await load<typeof import("./logs")>("./logs.ts");
const { logsSummary } = await load<typeof import("./ai/summary")>("./ai/summary.ts");
const { getSummary } = await load<typeof import("./summaries")>("./summaries.ts");

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
}

// 6000 lines over 6000 seconds: every 10th is an error ("ftp timeout" mostly, the oldest at id 10),
// every 4th of the rest a warning; the worker writes the odd ids.
const BASE = Date.parse("2026-11-06T04:00:00Z");
const N = 6000;
let errors = 0;
let ftp = 0;
let warns = 0;
let worker = 0;
transaction((d) => {
  const insert = d.prepare("INSERT INTO logs (source, src_id, at_ms, at, system, level, logger, message, slug, item_id, fields) VALUES ('samvadia', ?, ?, ?, ?, ?, 'jobs', ?, NULL, NULL, NULL)");
  for (let i = 1; i <= N; i++) {
    const at = BASE + i * 1000;
    const level = i % 10 === 0 ? "error" : i % 4 === 0 ? "warn" : "info";
    const message = level === "error" ? (i % 30 === 0 ? "db locked" : "ftp timeout") : `line ${i}`;
    const system = i % 2 ? "samvadia-worker" : "samvadia-api";
    if (level === "error") errors++;
    if (message === "ftp timeout") ftp++;
    if (level === "warn") warns++;
    if (system === "samvadia-worker") worker++;
    insert.run(String(i), at, new Date(at).toISOString(), system, level, message);
  }
});

await test("stats count every matching line, past 5000", () => {
  const s = logs.logStats({});
  assert.equal(s.total, N);
  assert.deepEqual(s.byLevel, { error: errors, warn: warns, info: N - errors - warns, debug: 0 });
  assert.deepEqual(s.bySystem, [["samvadia-api", N - worker], ["samvadia-worker", worker]]);
  assert.deepEqual(s.topError, { message: "ftp timeout", count: ftp, firstId: "samvadia-10" });
});

await test("filters apply to the counts and the top error", () => {
  const late = logs.logStats({ fromMs: BASE + 3000 * 1000 }); // ids 3000..6000
  assert.equal(late.total, 3001);
  assert.equal(late.topError?.firstId, "samvadia-3010");
  assert.equal(logs.logStats({ level: ["warn"] }).total, errors + warns, "warn and above");
  assert.equal(logs.logStats({ q: "db locked" }).topError?.count, N / 30);
  assert.equal(logs.logStats({ level: ["info"], system: ["samvadia-api"] }).total, N - worker);
  assert.equal(logs.logStats({ q: "no such text" }).topError, null);
});

await test("the summary text uses the exact counts and links the oldest error", () => {
  const summary = logsSummary(logs.logStats({}), "all filters", "2026-11-06T12:00:00+05:30");
  assert.match(summary.text, new RegExp(`^${N} log lines match all filters: ${errors} errors, ${warns} warnings\\.`));
  assert.match(summary.text, new RegExp(`"ftp timeout" \\(${ftp} times\\)`));
  assert.deepEqual(summary.evidence.map((e) => e.id), ["samvadia-10"]);
  assert.deepEqual(summary.unverifiedNumbers ?? [], [], "every number is a fact");
});

await test("the /api/summaries scope=logs path counts everything too", () => {
  const s = getSummary(new URLSearchParams("scope=logs&range=all"));
  assert.match(s.text, new RegExp(`^${N} log lines match`));
});

process.chdir(tmpdir());
try {
  (globalThis as { __sentryDb?: { db: { close(): void } } }).__sentryDb?.db.close();
  rmSync(dir, { recursive: true, force: true });
} catch {
  // Windows can hold the WAL files a moment longer; the temp folder is cleaned by the OS
}
console.log(`logSummary.test: ${passed} passed`);
