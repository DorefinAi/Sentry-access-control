// Detection rules and the engine (alerts, auto-resolve, auto-incidents), in a temp folder.
// Run: node --no-warnings --import ./scripts/test-resolve.mjs src/server/detect/detect.test.ts
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sentry-detect-test-"));
process.chdir(dir);

const load = async <T>(rel: string): Promise<T> => (await import(new URL(rel, import.meta.url).href)) as T;
const rules = await load<typeof import("./rules")>("./rules.ts");
const engine = await load<typeof import("./engine")>("./engine.ts");
const alerts = await load<typeof import("../alerts")>("../alerts.ts");
const incidents = await load<typeof import("../incidents")>("../incidents.ts");
const notifications = await load<typeof import("../notifications")>("../notifications.ts");
const time = await load<typeof import("../time")>("../time.ts");
const { RULE_DEFAULTS } = await load<typeof import("../thresholds")>("../thresholds.ts");
const { composeSystems } = await load<typeof import("../probes/probes")>("../probes/probes.ts");
type Ctx = import("./rules").DetectContext;
type Probe = import("../probes/probes").ProbeResult;
type Summary = import("../ops/types").OpsSummary;

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
}

const MIN = 60_000;
const NOW = Date.parse("2026-11-20T12:00:00+05:30");
let clock = NOW;
time.setClockForTests(() => clock);

const summary = (over: Partial<Summary> = {}): Summary => ({
  generatedAt: new Date(NOW).toISOString(),
  date: "2026-11-20",
  phase: null,
  processes: [],
  checks: [],
  stages: [],
  flow: { storiesIn: 10, bySource: { portal: 0, outlook: 0, whatsapp: 0, share: 0 }, approved: 0, rejected: 0, inFeed: 0, collected: 0, medianMinutesToFeed: null, posts: 0, recalled: 0 },
  hourly: [],
  stuck: [],
  failures: [],
  queues: [],
  ...over,
});

const probe = (target: string, health: Probe["health"], over: Partial<Probe> = {}): Probe => ({ target, label: target, health, reason: `${target} ${health}`, systems: [], at: NOW, ...over });

function ctx(over: Partial<Ctx> = {}): Ctx {
  return {
    now: clock,
    levels: { ...RULE_DEFAULTS },
    probes: [],
    systems: composeSystems([], () => "none"),
    ops: { samvadia: { configured: true, summary: summary(), problem: null }, socia: { configured: true, summary: summary(), problem: null } },
    errorCounts: () => [],
    repeatedErrors: () => [],
    storiesInAt: () => 9, // a story came in during the last hour
    ...over,
  };
}

// ─── Each rule ──────────────────────────────────────────────────────────────

await test("service-down: critical for the APIs, warning for desks, Postgres from the db check, ops unreadable", () => {
  const f = rules.serviceDown(
    ctx({
      probes: [
        probe("http:samvadia-api", "down", { systems: ["samvadia-api"], label: "Samvadia /health" }),
        probe("http:assignment-desk", "down", { systems: ["assignment-desk"] }),
        probe("check:socia:db", "down", { systems: ["postgres"] }),
        probe("ops:socia", "down"),
        probe("http:socia-api", "ok", { systems: ["socia-api"] }),
        probe("check:samvadia:ftp", "down", { systems: ["ftp"] }), // not this rule's
      ],
    }),
  );
  assert.deepEqual(f.map((x) => [x.target, x.severity]), [["http:samvadia-api", "critical"], ["http:assignment-desk", "warning"], ["postgres:socia", "critical"], ["ops:socia", "warning"]]);
  assert.ok(f[0].runbook.fix.length && f[0].runbook.checkFirst.length);
});

await test("heartbeat-stale: warn becomes a warning, down a critical alert", () => {
  const f = rules.heartbeatStale(ctx({ probes: [probe("hb:samvadia:worker", "warn", { value: 120, systems: ["samvadia-worker"] }), probe("hb:socia:api", "down", { value: 600, systems: ["socia-api"] }), probe("hb:socia:x", "ok")] }));
  assert.deepEqual(f.map((x) => [x.target, x.severity]), [["hb:samvadia:worker", "warning"], ["hb:socia:api", "critical"]]);
  assert.match(f[1].title, /10 min/);
});

await test("error-spike: at least the minimum and 3x the last 24 h rate", () => {
  const counts = (recent: number, day: number) => (from: number, to: number) => (to - from <= 10 * MIN + 1 ? [{ system: "samvadia-worker", n: recent }] : [{ system: "samvadia-worker", n: day }]);
  assert.equal(rules.errorSpike(ctx({ errorCounts: counts(4, 0) })).length, 0, "below the minimum of 5");
  assert.equal(rules.errorSpike(ctx({ errorCounts: counts(6, 0) })).length, 1);
  // 24 h of 288 errors is 2 per 10 min: 6 is exactly 3x, 5 is not
  assert.equal(rules.errorSpike(ctx({ errorCounts: counts(6, 288) })).length, 1);
  assert.equal(rules.errorSpike(ctx({ errorCounts: counts(5, 288) })).length, 0);
  assert.equal(rules.errorSpike(ctx({ errorCounts: counts(6, 0) }))[0].target, "samvadia-worker");
});

await test("error-repeat: the same message N times, keyed by system and message", () => {
  let asked: number[] = [];
  const f = rules.errorRepeat(
    ctx({
      repeatedErrors: (from, to, min) => {
        asked = [from, to, min];
        return [{ system: "socia-render", key: "msg:render failed: overflow", message: "render failed: overflow", n: 7, firstId: "socia-1", lastAt: new Date(NOW).toISOString() }];
      },
    }),
  );
  assert.deepEqual(asked, [NOW - 30 * MIN, NOW, 5]);
  assert.equal(f[0].target, `socia-render:${rules.messageKey("msg:render failed: overflow")}`);
  assert.deepEqual(f[0].evidence.map((e) => e.id), ["socia-render", "socia-1"]);
});

await test("check-failing: share and FTP are critical, Outlook a warning, db left to service-down", () => {
  const f = rules.checkFailing(
    ctx({ probes: [probe("check:socia:share", "down", { systems: ["socia-ingest"] }), probe("check:samvadia:ftp", "down", { systems: ["ftp"] }), probe("check:samvadia:outlook", "down", { systems: ["outlook"] }), probe("check:samvadia:db", "down"), probe("check:samvadia:octopus", "unknown")] }),
  );
  assert.deepEqual(f.map((x) => [x.target, x.severity]), [["check:socia:share", "critical"], ["check:samvadia:ftp", "critical"], ["check:samvadia:outlook", "warning"]]);
});

await test("no-intake: only in working hours, only when the count has not moved for the whole window", () => {
  const at = (hhmm: string) => Date.parse(`2026-11-20T${hhmm}:00+05:30`);
  const run = (now: number, then: number | null) => rules.noIntake(ctx({ now, storiesInAt: () => then }));
  assert.equal(run(at("12:00"), 10).length, 1, "10 then, 10 now: nothing came in for 60 min");
  assert.equal(run(at("12:00"), 9).length, 0, "a story came in");
  assert.equal(run(at("12:00"), null).length, 0, "no snapshot from then: not enough history");
  assert.equal(run(at("08:30"), 10).length, 0, "the window starts before 08:00");
  assert.equal(run(at("23:30"), 10).length, 0, "after hours");
  assert.equal(run(at("09:00"), 10).length, 1);
  assert.equal(rules.noIntake(ctx({ now: at("12:00"), levels: { ...RULE_DEFAULTS, noIntakeMinutes: 30 }, storiesInAt: (t) => (t === at("11:30") ? 10 : null) })).length, 1, "threshold is configurable");
});

await test("stories-stuck: one alert per backend and stage, critical from 5 stories", () => {
  const stuck = (n: number, stage: string) => Array.from({ length: n }, (_, i) => ({ slug: `S${stage}${i}`, headline: "", stage, since: new Date(NOW - 40 * MIN).toISOString(), minutes: 40 + i }));
  const f = rules.storiesStuck(ctx({ ops: { samvadia: { configured: true, summary: summary({ stuck: [...stuck(2, "ftp"), ...stuck(5, "desk")] }), problem: null }, socia: { configured: true, summary: null, problem: "down" } } }));
  assert.deepEqual(f.map((x) => [x.target, x.severity]), [["samvadia:ftp", "warning"], ["samvadia:desk", "warning"]], "desk waits for a person: never critical");
  const machine = rules.storiesStuck(ctx({ ops: { samvadia: { configured: true, summary: summary({ stuck: stuck(5, "ftp") }), problem: null }, socia: { configured: true, summary: summary({ stuck: stuck(6, "operator") }), problem: null } } }));
  assert.deepEqual(machine.map((x) => [x.target, x.severity]), [["samvadia:ftp", "critical"], ["socia:operator", "warning"]]);
  assert.match(f[0].title, /2 stories stuck at ftp in .* \(oldest 41 min\)/);
  assert.deepEqual(f[0].evidence.filter((e) => e.kind === "trace").map((e) => e.id), ["Sftp0", "Sftp1"]);
  assert.equal(rules.storiesStuck(ctx({ levels: { ...RULE_DEFAULTS, stuckMinMinutes: 45 }, ops: { samvadia: { configured: true, summary: summary({ stuck: stuck(2, "ftp") }), problem: null }, socia: { configured: false, summary: null, problem: null } } })).length, 0);
});

await test("backup-old: from the backups probe", () => {
  assert.equal(rules.backupOld(ctx({ probes: [probe("backups", "ok", { value: 3 })] })).length, 0);
  const f = rules.backupOld(ctx({ probes: [probe("backups", "warn", { value: 40.2 })] }));
  assert.equal(f[0].title, "Newest database backup is 40 h old");
  assert.equal(rules.backupOld(ctx({ probes: [probe("backups", "down", { value: null })] }))[0].title, "No database backup found");
});

await test("a rule that throws does not stop the others", () => {
  const { findings, blind } = rules.evaluate(ctx({ errorCounts: () => { throw new Error("db gone"); }, probes: [probe("backups", "warn", { value: 30 })] }));
  assert.deepEqual(findings.map((x) => x.ruleId), ["backup-old"]);
  assert.ok(blind.rules.has("error-spike"), "the rule that threw could not be evaluated");
});

// ─── The engine ─────────────────────────────────────────────────────────────

const clear = () => ctx({ probes: [probe("http:samvadia-api", "ok", { systems: ["samvadia-api"] }), probe("http:socia-api", "ok", { systems: ["socia-api"] })] });
const down = (target = "http:samvadia-api") => ctx({ probes: [probe(target, "down", { systems: ["samvadia-api"] })] });

await test("a finding opens one alert and a notification; the next round refreshes it", () => {
  const r1 = engine.runDetection(down());
  assert.equal(r1.fired.length, 1);
  clock += MIN;
  const r2 = engine.runDetection(down());
  assert.equal(r2.fired.length, 0, "deduped by rule + target");
  const all = alerts.listAlerts();
  assert.equal(all.length, 1);
  assert.equal(all[0].state, "open");
  assert.equal(Date.parse(all[0].lastSeenAt), clock);
  assert.ok(!("dedupeKey" in all[0]), "internal fields stay internal");
  const n = notifications.listNotifications("ada");
  assert.equal(n.items[0].kind, "alert_fired");
  assert.equal(n.items[0].severity, "critical");
});

await test("a critical alert open 5 min opens an auto incident with a timeline", () => {
  clock += 3 * MIN; // 4 min after firing: not yet
  assert.equal(engine.runDetection(down()).incidentsOpened.length, 0);
  clock += MIN; // 5 min
  const r = engine.runDetection(down());
  assert.equal(r.incidentsOpened.length, 1);
  const inc = incidents.getIncident(r.incidentsOpened[0]);
  assert.equal(inc.openedBy, "auto");
  assert.equal(inc.status, "open");
  assert.deepEqual(inc.alertIds, [alerts.listAlerts()[0].id]);
  assert.match(inc.timeline[0].text, /Opened automatically/);
  assert.equal(inc.timeline[1].kind, "alert");
  assert.equal(alerts.listAlerts()[0].incidentId, inc.id);
  assert.equal(notifications.listNotifications("ada").items[0].kind, "incident_opened");
});

await test("a second critical alert joins the open auto incident", () => {
  const both = () => ctx({ probes: [probe("http:samvadia-api", "down", { systems: ["samvadia-api"] }), probe("http:socia-api", "down", { systems: ["socia-api"] })] });
  engine.runDetection(both());
  clock += 5 * MIN;
  const r = engine.runDetection(both());
  assert.equal(r.incidentsOpened.length, 0);
  const inc = incidents.listIncidents();
  assert.equal(inc.length, 1);
  assert.deepEqual(incidents.getIncident(inc[0].id).alertIds.length, 2);
});

await test("flapping: a condition must be clear 3 rounds in a row before its alert resolves", () => {
  clock += MIN;
  assert.equal(engine.runDetection(clear()).resolved.length, 0, "1 clear round");
  clock += MIN;
  assert.equal(engine.runDetection(clear()).resolved.length, 0, "2 clear rounds");
  clock += MIN;
  const both = ctx({ probes: [probe("http:samvadia-api", "down", { systems: ["samvadia-api"] }), probe("http:socia-api", "down", { systems: ["socia-api"] })] });
  assert.equal(engine.runDetection(both).fired.length, 0, "back again: the same alerts, counters reset");
  clock += MIN;
  engine.runDetection(clear());
  clock += MIN;
  assert.equal(engine.runDetection(clear()).resolved.length, 0, "only 2 clear rounds since the reset");
});

await test("auto-resolve: a cleared condition resolves its alert; all cleared moves the incident to monitoring", () => {
  clock += MIN;
  const r = engine.runDetection(clear());
  assert.equal(r.resolved.length, 2);
  const a = alerts.listAlerts();
  assert.ok(a.every((x) => x.state === "resolved" && x.resolvedAt));
  assert.match(a[0].note!, /Cleared automatically/);
  assert.deepEqual(r.incidentsMonitoring.length, 1);
  const inc = incidents.getIncident(r.incidentsMonitoring[0]);
  assert.equal(inc.status, "monitoring");
  assert.ok(inc.timeline.some((e) => /cleared automatically/.test(e.text)));
  assert.ok(inc.timeline.some((e) => e.kind === "status" && / to monitoring/.test(e.text)));
});

await test("the same problem coming back reopens its monitoring incident", () => {
  clock += MIN;
  engine.runDetection(down());
  clock += 5 * MIN;
  engine.runDetection(down());
  const inc = incidents.listIncidents();
  assert.equal(inc.length, 1, "no new incident");
  assert.equal(inc[0].status, "open");
  assert.equal(incidents.getIncident(inc[0].id).alertIds.length, 3);
});

await test("resolved by a person while still failing: held, no new alert until it clears once", () => {
  const open = alerts.listAlerts("open")[0];
  alerts.patchAlert(open.id, { action: "resolve" }, "ada");
  clock += MIN;
  assert.equal(engine.runDetection(down()).fired.length, 0, "held");
  clock += MIN;
  engine.runDetection(clear()); // the condition clears: the hold is released
  clock += MIN;
  assert.equal(engine.runDetection(down()).fired.length, 1, "back again: a new alert");
});

await test("ack and notes persist in the database across a restart", () => {
  const open = alerts.listAlerts("open")[0];
  alerts.patchAlert(open.id, { action: "ack", note: "looking" }, "ada");
  (globalThis as { __sentryStore?: unknown }).__sentryStore = undefined;
  const again = alerts.getAlert(open.id);
  assert.equal(again.state, "acked");
  assert.equal(again.noteHistory?.at(-1)?.by, "ada");
  // Acked still counts as unresolved: it is refreshed, not fired again
  clock += MIN;
  assert.equal(engine.runDetection(down()).fired.length, 0);
});

await test("replay: alerts and incidents as they stood at an earlier moment", () => {
  const first = alerts.listAlerts().at(-1)!; // the oldest
  const before = alerts.alertsAt(Date.parse(first.firedAt) - 1);
  assert.ok(!before.some((a) => a.id === first.id));
  const during = alerts.alertsAt(Date.parse(first.firedAt) + MIN).find((a) => a.id === first.id)!;
  assert.equal(during.state, "open");
  const inc = incidents.incidentsAt(Date.parse(incidents.listIncidents()[0].openedAt) + 1)[0];
  assert.equal(inc.status, "open");
});

await test("no auto-resolve without evidence: a stale backend or no probe round leaves alerts as they are", () => {
  const stale = (over: Partial<Ctx> = {}) =>
    ctx({ ops: { samvadia: { configured: true, summary: null, problem: "Could not reach it" }, socia: { configured: true, summary: summary(), problem: null } }, probes: [probe("http:socia-api", "ok")], ...over });
  const hb = () => ctx({ probes: [probe("hb:samvadia:worker", "down", { value: 400, systems: ["samvadia-worker"] })] });
  clock += MIN;
  const id = engine.runDetection(hb()).fired[0];
  assert.ok(id);
  for (let i = 0; i < 5; i++) {
    clock += MIN;
    assert.ok(!engine.runDetection(stale()).resolved.includes(id), "Samvadia unreadable: its heartbeat alert stays");
  }
  assert.equal(alerts.getAlert(id).state, "open");
  for (let i = 0; i < 5; i++) {
    clock += MIN;
    engine.runDetection(ctx()); // no probe round at all
  }
  assert.equal(alerts.getAlert(id).state, "open", "nothing to judge by: still open");
  for (let i = 0; i < 3; i++) {
    clock += MIN;
    engine.runDetection(clear());
  }
  assert.equal(alerts.getAlert(id).state, "resolved", "seen clear 3 times with evidence");
  assert.ok(rules.isBlind({ rules: new Set(["error-repeat"]), sources: new Set() }, "error-repeat", "x"));
  assert.equal(rules.alertSource("stories-stuck", "socia:render"), "socia");
  assert.equal(rules.alertSource("service-down", "http:samvadia-api"), null);
});

await test("check-quiet: a check with no success for its limit, in working hours only", () => {
  const at = (hhmm: string) => Date.parse(`2026-11-20T${hhmm}:00+05:30`);
  const sam = (lastOkAt: string, ok: boolean | null = true) => summary({ checks: [{ id: "octopus", label: "Octopus fetch", ok, lastOkAt, lastError: null, detail: null }] });
  const run = (now: number, last: string, ok: boolean | null = true) =>
    rules.checkQuiet(ctx({ now, ops: { samvadia: { configured: true, summary: sam(last, ok), problem: null }, socia: { configured: true, summary: summary(), problem: null } } }));
  assert.equal(run(at("12:00"), "2026-11-20T11:50:00+05:30").length, 0, "10 min: under the 15 min default");
  const f = run(at("12:00"), "2026-11-20T11:40:00+05:30");
  assert.equal(f.length, 1);
  assert.equal(f[0].target, "samvadia:octopus");
  assert.equal(f[0].severity, "warning");
  assert.match(f[0].title, /nothing for 20 min \(last at 11:40\)/);
  assert.equal(run(at("12:00"), "2026-11-20T11:00:00+05:30", false).length, 0, "already failing: check-failing covers it");
  assert.equal(run(at("23:30"), "2026-11-20T20:00:00+05:30").length, 0, "after hours");
  assert.equal(run(at("08:10"), "2026-11-19T22:00:00+05:30").length, 0, "the limit reaches back before 08:00");
  const share = rules.checkQuiet(ctx({ now: at("12:00"), levels: { ...RULE_DEFAULTS, quietShareMin: 30 }, ops: { samvadia: { configured: true, summary: summary(), problem: null }, socia: { configured: true, summary: summary({ checks: [{ id: "share", label: "Share", ok: true, lastOkAt: "2026-11-20T11:20:00+05:30", lastError: null, detail: null }] }), problem: null } } }));
  assert.deepEqual(share.map((x) => x.target), ["socia:share"], "levels come from thresholds");
});

await test("error-repeat groups on logger + fields.tmpl, else on the message", async () => {
  const logs = await load<typeof import("../logs")>("../logs.ts");
  const { transaction } = await load<typeof import("../db")>("../db.ts");
  const t0 = NOW - 5 * MIN;
  transaction((d) => {
    const ins = d.prepare("INSERT INTO logs (source, src_id, at_ms, at, system, level, logger, message, slug, item_id, fields) VALUES ('samvadia', ?, ?, ?, 'samvadia-worker', 'error', ?, ?, NULL, NULL, ?)");
    for (let i = 0; i < 6; i++) ins.run(String(500 + i), t0 + i * 1000, new Date(t0 + i * 1000).toISOString(), "jobs", `job ${40 + i} failed`, JSON.stringify({ tmpl: "job %s failed" }));
    ins.run("510", t0, new Date(t0).toISOString(), "other", "job 99 failed", JSON.stringify({ tmpl: "job %s failed" })); // another logger: its own group
    for (let i = 0; i < 5; i++) ins.run(String(520 + i), t0 + i * 1000, new Date(t0 + i * 1000).toISOString(), "ftp", "ftp timeout", null);
  });
  const groups = logs.repeatedErrors(NOW - 30 * MIN, NOW + 1, 5);
  assert.deepEqual(groups.map((g) => [g.key, g.message, g.n, g.firstId]), [
    ["tmpl:jobs|job %s failed", "job %s failed", 6, "samvadia-500"],
    ["msg:ftp timeout", "ftp timeout", 5, "samvadia-520"],
  ]);
  const f = rules.errorRepeat(ctx({ now: NOW + 1, repeatedErrors: logs.repeatedErrors }));
  assert.equal(f[0].target, `samvadia-worker:${rules.messageKey("tmpl:jobs|job %s failed")}`);
  assert.match(f[0].title, /"job %s failed" 6 times/);
});

await test("a dead process's alert stays open when its heartbeat passes 'gone'; gone raises no new alert", () => {
  const hb = (value: number, gone = false) => ctx({ probes: [probe("http:socia-api", "ok"), probe("hb:socia:render-worker", gone ? "unknown" : "down", { value, systems: ["socia-render"], ...(gone ? { gone: true } : {}) })] });
  clock += MIN;
  const id = engine.runDetection(hb(400)).fired[0];
  assert.ok(id);
  for (let i = 0; i < 5; i++) {
    clock += MIN;
    engine.runDetection(hb(4000, true));
  }
  assert.equal(alerts.getAlert(id).state, "open", "only a person resolves it");
  alerts.patchAlert(id, { action: "resolve" }, "ada");
  clock += MIN;
  assert.equal(engine.runDetection(ctx({ probes: [probe("hb:socia:old", "unknown", { value: 9000, gone: true })] })).fired.length, 0, "a retired name never fires");
});

await test("error alerts stay while that backend's log pull is behind", () => {
  const spike = (n: number, stale: boolean) =>
    ctx({ probes: [probe("http:socia-api", "ok")], errorCounts: (f, t) => (t - f <= 10 * MIN + 1 ? [{ system: "socia-render", n }] : []), logsStale: stale ? new Set(["socia" as const]) : new Set() });
  clock += MIN;
  const id = engine.runDetection(spike(9, false)).fired[0];
  assert.ok(id);
  for (let i = 0; i < 4; i++) {
    clock += MIN;
    engine.runDetection(spike(0, true));
  }
  assert.equal(alerts.getAlert(id).state, "open", "no fresh logs: no evidence it stopped");
  for (let i = 0; i < 3; i++) {
    clock += MIN;
    engine.runDetection(spike(0, false));
  }
  assert.equal(alerts.getAlert(id).state, "resolved");
  assert.ok(rules.isBlind({ rules: new Set(), sources: new Set(), logSources: new Set(["samvadia"]) }, "error-repeat", "samvadia-worker:abc"));
  assert.ok(!rules.isBlind({ rules: new Set(), sources: new Set(), logSources: new Set(["samvadia"]) }, "error-repeat", "socia-api:abc"));
});

await test("no-intake and check-quiet are blind (not clear) when they cannot judge", () => {
  const at = (hhmm: string) => Date.parse(`2026-11-20T${hhmm}:00+05:30`);
  const marks: (string | undefined)[] = [];
  const mark = (t?: string) => void marks.push(t ?? "*");
  rules.noIntake(ctx({ now: at("23:30") }), mark);
  rules.noIntake(ctx({ now: at("08:30") }), mark);
  rules.noIntake(ctx({ now: at("12:00"), storiesInAt: () => null }), mark);
  assert.deepEqual(marks, ["*", "*", "*"]);
  marks.length = 0;
  rules.noIntake(ctx({ now: at("12:00"), storiesInAt: () => 9 }), mark);
  assert.deepEqual(marks, [], "judged: a story came in");
  rules.checkQuiet(ctx({ now: at("23:30") }), mark);
  assert.deepEqual(marks, ["*"]);
  marks.length = 0;
  rules.checkQuiet(ctx({ now: at("12:00") }), mark); // no checks reported at all
  assert.deepEqual(marks, ["samvadia:octopus", "samvadia:whatsapp", "samvadia:outlook", "socia:share"]);

  // In the engine: an open no-intake alert survives the night
  clock = at("12:00") + 7 * 86_400_000;
  const day = (h: string) => Date.parse(new Date(clock).toISOString().slice(0, 10) + `T${h}:00+05:30`);
  const noIn = (now: number) => ctx({ now, probes: [probe("http:socia-api", "ok")], storiesInAt: () => 10 });
  clock = day("12:00");
  const id = engine.runDetection(noIn(clock)).fired[0];
  assert.ok(id);
  for (const h of ["23:10", "23:20", "23:30", "23:40"]) {
    clock = day(h);
    engine.runDetection(noIn(clock));
  }
  assert.equal(alerts.getAlert(id).state, "open", "after hours it cannot judge, so it does not clear");
});

await test("reopening an alert resets its clear-round count", () => {
  clock += MIN;
  const id = engine.runDetection(down("http:reporter-portal")).fired[0];
  clock += MIN;
  engine.runDetection(clear()); // 1 clear round
  clock += MIN;
  engine.runDetection(clear()); // 2
  alerts.patchAlert(id, { action: "resolve" }, "ada");
  alerts.patchAlert(id, { action: "reopen" }, "ada");
  clock += MIN;
  engine.runDetection(clear());
  assert.equal(alerts.getAlert(id).state, "open", "the count started again at 0, so 1 round is not enough");
  clock += MIN;
  engine.runDetection(clear());
  clock += MIN;
  engine.runDetection(clear());
  assert.equal(alerts.getAlert(id).state, "resolved");
});

time.setClockForTests(null);
(globalThis as { __sentryDb?: { db: { close(): void } } }).__sentryDb?.db.close();
process.chdir(tmpdir());
try {
  rmSync(dir, { recursive: true, force: true });
} catch {
  // Windows can hold the WAL files a moment longer
}
console.log(`detect.test: ${passed} passed`);
