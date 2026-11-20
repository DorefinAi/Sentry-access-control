// A one-off look at the live data path against the real backends, on a COPY of sentry.local.db in a
// temp folder (the real file is never written). Reads .env.local for the backend URLs and keys
// without printing them. Run from the project folder:
//   node --no-warnings --import ./scripts/test-resolve.mjs scripts/live-check.mts
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const project = process.cwd();
for (const line of readFileSync(path.join(project, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && /^(SAMVADIA|SOCIA)_(API_URL|OWNER_KEY)$/.test(m[1])) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const dir = mkdtempSync(path.join(tmpdir(), "sentry-live-check-"));
// The database runs in WAL mode: a plain file copy can miss what is still in the -wal file, so take a
// consistent copy with VACUUM INTO (read-only on the real file)
const real = path.join(project, "sentry.local.db");
if (existsSync(real)) {
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as { DatabaseSync: new (file: string, opts?: { readOnly?: boolean }) => { prepare(sql: string): { run(...p: unknown[]): unknown }; close(): void } };
  const src = new DatabaseSync(real, { readOnly: true });
  src.prepare("VACUUM INTO ?").run(path.join(dir, "sentry.local.db"));
  src.close();
}
if (existsSync(path.join(project, "thresholds.local.json"))) copyFileSync(path.join(project, "thresholds.local.json"), path.join(dir, "thresholds.local.json"));
process.chdir(dir);

const src = new URL("../src/server/", import.meta.url);
const load = async <T,>(rel: string): Promise<T> => (await import(new URL(rel, src).href)) as T;
const monitor = await load<typeof import("../src/server/monitor")>("monitor.ts");
const overview = await load<typeof import("../src/server/overview")>("overview.ts");
const systems = await load<typeof import("../src/server/systems")>("systems.ts");
const reports = await load<typeof import("../src/server/reports")>("reports.ts");
const trace = await load<typeof import("../src/server/trace")>("trace.ts");
const logins = await load<typeof import("../src/server/logins")>("logins.ts");
const logs = await load<typeof import("../src/server/logs")>("logs.ts");
const changes = await load<typeof import("../src/server/changes")>("changes.ts");
const time = await load<typeof import("../src/server/time")>("time.ts");

await monitor.monitorOnce();
await new Promise((r) => setTimeout(r, 1500));
await monitor.monitorOnce();
const o = overview.getOverview();
console.log("health:", o.health, "| headline:", o.headline, "| replayFrom:", o.replayFrom);
console.log("pipelines:", o.pipelines.map((p) => `${p.id}=${p.health} [${p.stages.map((s) => `${s.id}:${s.health}:${s.count}`).join(" ")}]`).join(" | "));
console.log("gauges:", o.gauges.map((g) => `${g.id}=${g.display}(${g.health})`).join(" "));
console.log("counts:", JSON.stringify(o.counts));
console.log("telemetry buckets:", o.telemetry.length, "errors today:", o.telemetry.reduce((n, p) => n + p.errors, 0));
console.log("streaks:", o.streaks.length, "| uptime:", JSON.stringify({ ...o.uptime, lastOutage: o.uptime.lastOutage?.reason ?? null }));
console.log("summary:", o.aiSummary.text, "| unverified:", o.aiSummary.unverifiedNumbers);
for (const s of systems.listSystems()) console.log(`  ${s.id.padEnd(16)} ${s.health.padEnd(7)} ${s.summary.slice(0, 110)}`);
console.log("alerts:", o.fixes.map((f) => `${f.severity}: ${f.impact}`));
console.log("report dates:", reports.reportDates());
const r = reports.dailyReport(time.todayIst());
console.log("daily:", JSON.stringify(r.flow), "failures:", JSON.stringify(r.failures), "uptime rows:", r.uptime.length);
console.log("build log:", JSON.stringify(reports.buildLog()[0], null, 1).slice(0, 1500));
try {
  const { hits, partial } = await trace.searchTraces("");
  console.log("trace search:", hits.length, hits.slice(0, 2), partial ? `partial: ${partial}` : "");
  if (hits[0]) {
    const t = await trace.getTrace(hits[0].slug);
    console.log("trace:", t.slug, t.state, t.steps.map((s) => `${s.stage}:${s.state}:${s.evidence?.length ?? 0}`).join(" | "));
  }
} catch (e) {
  console.log("trace:", (e as Error).message);
}
const lr = await logins.loginReport(time.todayIst());
console.log("logins:", JSON.stringify(lr.totals), JSON.stringify(lr.byApp));
const page = logs.queryLogs(logs.parseLogQuery(new URLSearchParams("range=all")));
console.log("logs: total", page.total, "noise", JSON.stringify(page.noise), "groups", page.errorGroups?.length);
const ch = await changes.listChanges(new URLSearchParams("limit=5"));
console.log("changes:", ch.map((c) => `${c.repo} ${c.at} ${c.summary.slice(0, 50)}`));
console.log("temp folder:", dir);
process.exit(0);
