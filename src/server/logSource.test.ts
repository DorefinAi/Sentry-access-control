// The pull cursor belongs to one backend database: a URL change or a reset backend starts again.
// Run: node --no-warnings --import ./scripts/test-resolve.mjs src/server/logSource.test.ts
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sentry-logsource-test-"));
process.chdir(dir); // db.ts puts sentry.local.db in process.cwd()

const load = async <T>(rel: string): Promise<T> => (await import(new URL(rel, import.meta.url).href)) as T;
const sync = await load<typeof import("./logSync")>("./logSync.ts");
const { db } = await load<typeof import("./db")>("./db.ts");

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
}

// A fake backend whose ids run from `first` to `last`
function backend(first: number, last: number) {
  const calls: string[] = [];
  const impl = (async (url: string | URL) => {
    calls.push(String(url));
    const u = new URL(String(url));
    const after = Number(u.searchParams.get("after"));
    const limit = Number(u.searchParams.get("limit"));
    let ids = Array.from({ length: last - first + 1 }, (_, i) => first + i).filter((id) => id > after);
    if (after === 0) ids = ids.slice(-limit); // the newest `limit`, still ascending
    else ids = ids.slice(0, limit);
    const entries = ids.map((id) => ({ id: String(id), at: new Date().toISOString(), system: "samvadia-api", level: "info", logger: null, message: `line ${id}`, slug: null, itemId: null, fields: null }));
    return new Response(JSON.stringify({ system: "samvadia", entries, next: entries.length ? entries[entries.length - 1].id : null, heartbeats: [], dropped: 0 }), { status: 200 });
  }) as typeof fetch;
  return { impl, calls };
}

const count = () => (db().prepare("SELECT count(*) AS n FROM logs WHERE source = 'samvadia'").get() as { n: number }).n;
const row = () => db().prepare("SELECT cursor, base FROM log_sources WHERE source = 'samvadia'").get() as { cursor: string; base: string | null };

process.env.SAMVADIA_OWNER_KEY = "k".repeat(40);
process.env.SAMVADIA_API_URL = "http://127.0.0.1:8000";

await test("a normal pull stores the base URL and moves the cursor", async () => {
  const b = backend(1, 5);
  assert.equal(await sync.pullSource("samvadia", b.impl), 5);
  assert.deepEqual({ ...row() }, { cursor: "5", base: "http://127.0.0.1:8000" });
  const b2 = backend(1, 7);
  assert.equal(await sync.pullSource("samvadia", b2.impl), 2, "only the new lines");
  assert.match(b2.calls[0], /after=5&/);
  assert.equal(row().cursor, "7");
});

await test("empty pulls with matching ids never reset", async () => {
  const b = backend(1, 7);
  for (let i = 0; i < 25; i++) await sync.pullSource("samvadia", b.impl);
  assert.equal(count(), 7);
  assert.equal(row().cursor, "7");
  assert.ok(b.calls.some((c) => /after=0&limit=1$/.test(c)), "the probe ran");
});

await test("a changed URL drops the old lines and starts from the newest", async () => {
  process.env.SAMVADIA_API_URL = "http://localhost:9000";
  const b = backend(100, 103);
  assert.equal(await sync.pullSource("samvadia", b.impl), 4);
  assert.match(b.calls[0], /after=0&/, "started again");
  assert.equal(count(), 4, "old lines gone");
  assert.deepEqual({ ...row() }, { cursor: "103", base: "http://localhost:9000" });
});

await test("a backend whose ids restart below the cursor is found by the probe", async () => {
  const reset = backend(1, 3); // new database: ids 1..3, our cursor is 103
  for (let i = 0; i < 9; i++) await sync.pullSource("samvadia", reset.impl);
  assert.equal(row().cursor, "103", "not before the 10th empty pull");
  await sync.pullSource("samvadia", reset.impl);
  assert.equal(row().cursor, "0", "reset on the probe");
  assert.equal(count(), 0);
  assert.equal(await sync.pullSource("samvadia", reset.impl), 3, "then pulls the new database");
  assert.equal(row().cursor, "3");
});

process.chdir(tmpdir());
try {
  (globalThis as { __sentryDb?: { db: { close(): void } } }).__sentryDb?.db.close();
  rmSync(dir, { recursive: true, force: true });
} catch {
  // Windows can hold the WAL files a moment longer
}
console.log(`logSource.test: ${passed} passed`);
