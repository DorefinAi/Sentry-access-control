// Detection rules. Each rule looks at the current context (probes, ops summaries, logs) and returns
// findings: "this is wrong right now, about this target". The engine (engine.ts) turns findings into
// alerts, keyed by rule + target, and resolves an alert when its finding goes away. Rules never
// write anything themselves, so each one can be tested with a plain context.
import type { Evidence, Runbook, Severity, SystemId } from "@/types/control";
import { SYSTEM_LABEL } from "@/types/people";
import { systemName } from "../catalog";
import type { OpsSource, OpsSummary } from "../ops/types";
import type { ProbeResult, SystemHealth } from "../probes/probes";
import type { RuleLevels } from "../thresholds";
import { hhmm, istDate, istHour } from "../time";

export interface Finding {
  ruleId: string;
  target: string; // with ruleId, the dedupe key: one unresolved alert per rule and target
  severity: Severity;
  title: string;
  systems: SystemId[];
  evidence: Evidence[];
  runbook: Runbook;
}

export interface ErrorCount {
  system: string;
  n: number;
}

export interface RepeatedError {
  system: string;
  key: string; // what the lines were grouped on: logger + fields.tmpl when the line has a template, else the message
  message: string; // the template when there is one, else the message
  n: number;
  firstId: string;
  lastAt: string;
}

export interface DetectContext {
  now: number;
  levels: RuleLevels;
  probes: ProbeResult[];
  systems: Record<SystemId, SystemHealth>;
  ops: Record<OpsSource, { configured: boolean; summary: OpsSummary | null; problem: string | null }>;
  /** Error lines per system with at_ms in [fromMs, toMs). */
  errorCounts: (fromMs: number, toMs: number) => ErrorCount[];
  /** Error messages seen at least `min` times in [fromMs, toMs), per system. */
  repeatedErrors: (fromMs: number, toMs: number, min: number) => RepeatedError[];
  /** Samvadia's stories-in count for the day as it stood at moment t, from stored snapshots (null = no snapshot then). */
  storiesInAt: (t: number) => number | null;
  /** Backends whose log pull is behind (last good pull older than ~2 sync intervals): their error counts are not trusted. */
  logsStale?: Set<OpsSource>;
}

/**
 * A rule returns what is wrong. When it cannot judge (outside working hours, no snapshot to compare
 * with, a check never reported), it calls blind(): for one target, or with no target for the whole
 * rule. Alerts it cannot judge keep their state; they are not auto-resolved.
 */
export type Rule = (ctx: DetectContext, blind?: (target?: string) => void) => Finding[];
const noop = () => undefined;

const MIN = 60_000;
const sys = (id: SystemId): Evidence => ({ kind: "system", id, label: systemName(id) });
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const mins = (sec: number) => (sec >= 120 ? `${Math.round(sec / 60)} min` : `${sec} s`);

// ─── 1. Service down or unreachable ─────────────────────────────────────────

const CRITICAL_TARGETS = new Set(["http:samvadia-api", "http:socia-api", "http:socia-worker"]);

export const serviceDown: Rule = (ctx) => {
  const out: Finding[] = [];
  for (const p of ctx.probes) {
    if (p.health !== "down") continue;
    const isHttp = p.target.startsWith("http:") || p.target.startsWith("service:");
    const isDb = /^check:(samvadia|socia):db$/.test(p.target);
    const isOps = p.target.startsWith("ops:");
    if (!isHttp && !isDb && !isOps) continue;
    if (isOps) {
      const source = p.target.slice(4) as OpsSource;
      const label = SYSTEM_LABEL[source];
      out.push({
        ruleId: "service-down",
        target: p.target,
        severity: "warning",
        title: `Sentry cannot read ${label}'s ops status`,
        systems: [source === "samvadia" ? "samvadia-api" : "socia-api"],
        evidence: [sys(source === "samvadia" ? "samvadia-api" : "socia-api")],
        runbook: {
          meaning: `Sentry asks ${label} for its ops summary every 30 s and the last answer failed: ${p.reason}. Pipelines, checks and heartbeats for ${label} show as unknown until it answers.`,
          checkFirst: [`Is the ${label} API running? Open its /health page.`, `Is the owner key in Sentry's .env.local the same as OWNER_API_KEY on ${label}?`, `Does ${label} have GET /owner/ops/summary (dev-docs/ops-status-contract.md)?`],
          fix: [`Start or restart the ${label} API.`, "Fix the key or URL in .env.local and restart Sentry.", "This alert clears by itself at the next good pull."],
        },
      });
      continue;
    }
    const id = p.systems[0];
    const name = isDb ? "Postgres" : id ? systemName(id) : p.label;
    const critical = isDb || CRITICAL_TARGETS.has(p.target);
    out.push({
      ruleId: "service-down",
      target: isDb ? `postgres:${p.target.split(":")[1]}` : p.target,
      severity: critical ? "critical" : "warning",
      title: isDb ? `Postgres check failing in ${SYSTEM_LABEL[p.target.split(":")[1] as OpsSource]}` : `${name} is down: ${p.reason}`,
      systems: isDb ? ["postgres"] : p.systems,
      evidence: (isDb ? ["postgres" as SystemId] : p.systems).map(sys),
      runbook: {
        meaning: `${p.label} did not pass its check: ${p.reason}.${critical ? " Stories stop moving while this lasts." : ""}`,
        checkFirst: isDb
          ? ["Is the Windows service postgresql-x64-* running?", "Can you connect with psql?", "Is the disk full?"]
          : p.target === "service:tunnel"
            ? ["Run \"sc query Cloudflared\" in a terminal.", "Look at the cloudflared log for errors."]
            : [`Open ${p.label.replace(/ web page$/, "")} in a browser.`, "Is the process running? Look at its window or log.", "Did the port change?"],
        fix: isDb
          ? ["Start the Postgres Windows service.", "Free disk space if it is full.", "Restart the backends after Postgres is back."]
          : p.target === "service:tunnel"
            ? ["Start the service: \"sc start Cloudflared\" (as administrator)."]
            : ["Start or restart it (start scripts: digital/start-socia.ps1, testing/local-dev/start.ps1).", "Check its log for the error that stopped it."],
      },
    });
  }
  return out;
};

// ─── 2. Heartbeat stale ─────────────────────────────────────────────────────

export const heartbeatStale: Rule = (ctx) =>
  ctx.probes
    .filter((p) => p.target.startsWith("hb:") && (p.health === "warn" || p.health === "down"))
    .map((p) => {
      const [, source, ...rest] = p.target.split(":");
      const process = rest.join(":");
      const age = p.value ?? 0;
      return {
        ruleId: "heartbeat-stale",
        target: p.target,
        severity: p.health === "down" ? "critical" : "warning",
        title: `${SYSTEM_LABEL[source as OpsSource]} ${process} has not beaten for ${mins(age)}`,
        systems: p.systems.length ? p.systems : [source === "samvadia" ? "samvadia-worker" : "socia-ingest"],
        evidence: p.systems.map(sys),
        runbook: {
          meaning: `The process writes a heartbeat every 30 s. None for ${mins(age)} means it is stuck or has stopped (warning at ${ctx.levels.heartbeatWarnSec} s, down at ${ctx.levels.heartbeatDownSec} s).`,
          checkFirst: ["Is the process still running (Task Manager / its window)?", "Look at its last log lines on the Logs page.", "Is the database reachable? Heartbeats are written there."],
          fix: ["Restart the process.", "If it stops again, look at the error just before it went quiet."],
        },
      } satisfies Finding;
    });

// ─── 3. Error spike ─────────────────────────────────────────────────────────

export const errorSpike: Rule = (ctx) => {
  const w = ctx.levels.errorSpikeWindowMin * MIN;
  const recent = ctx.errorCounts(ctx.now - w, ctx.now);
  const day = ctx.errorCounts(ctx.now - 24 * 60 * MIN - w, ctx.now - w);
  const out: Finding[] = [];
  for (const r of recent) {
    const normal = ((day.find((d) => d.system === r.system)?.n ?? 0) * w) / (24 * 60 * MIN);
    if (r.n < ctx.levels.errorSpikeMin || r.n < ctx.levels.errorSpikeFactor * normal) continue;
    const id = r.system as SystemId;
    out.push({
      ruleId: "error-spike",
      target: r.system,
      severity: "warning",
      title: `${systemName(id)}: ${r.n} errors in the last ${ctx.levels.errorSpikeWindowMin} min`,
      systems: [id],
      evidence: [sys(id)],
      runbook: {
        meaning: `${r.n} error lines in ${ctx.levels.errorSpikeWindowMin} min; the last 24 h averaged ${Math.round(normal * 10) / 10} per ${ctx.levels.errorSpikeWindowMin} min.`,
        checkFirst: [`Open Logs filtered to ${systemName(id)}, errors only, last 15 min.`, "Is it one error repeating (see the repeated errors list) or many different ones?", "Did something change just before (Changes)?"],
        fix: ["Fix the cause the errors name (a service down, a full disk, a bad file).", "This alert clears once the rate is back to normal."],
      },
    });
  }
  return out;
};

// ─── 4. Same error repeating ────────────────────────────────────────────────

/** A short stable key for a message (dedupe target). */
export function messageKey(message: string): string {
  let h = 5381;
  for (let i = 0; i < message.length; i++) h = ((h << 5) + h + message.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export const errorRepeat: Rule = (ctx) =>
  ctx.repeatedErrors(ctx.now - ctx.levels.errorRepeatWindowMin * MIN, ctx.now, ctx.levels.errorRepeatCount).map((r) => {
    const id = r.system as SystemId;
    const short = r.message.length > 90 ? `${r.message.slice(0, 87)}...` : r.message;
    return {
      ruleId: "error-repeat",
      target: `${r.system}:${messageKey(r.key)}`,
      severity: "warning",
      title: `${systemName(id)}: "${short}" ${r.n} times in ${ctx.levels.errorRepeatWindowMin} min`,
      systems: [id],
      evidence: [sys(id), { kind: "log", id: r.firstId, label: "First of these errors" }],
      runbook: {
        meaning: `The same error keeps coming back (${r.n} times in ${ctx.levels.errorRepeatWindowMin} min, last at ${hhmm(r.lastAt)}). Something is retrying and failing the same way.`,
        checkFirst: ["Open the first of these errors and read its fields (slug, item, file).", "Is it always the same story or file?"],
        fix: ["Fix or remove what keeps failing (a bad file, a wrong setting).", "This alert clears once the error stops repeating."],
      },
    } satisfies Finding;
  });

// ─── 5. Share / FTP / Outlook (and the other backend checks) failing ────────

const CHECK_SEVERITY: Record<string, Severity> = { ftp: "critical", share: "critical" };
const CHECK_HELP: Record<string, { check: string[]; fix: string[] }> = {
  ftp: { check: ["Is the FTP server running (127.0.0.1:2121 locally)?", "Is a file over the upload size limit?", "Look at the Samvadia worker errors on Logs."], fix: ["Start the FTP server or fix its login.", "Re-run the failed uploads from the desk."] },
  share: { check: ["Can this PC open the breaking-news share?", "Did the share password or path change?"], fix: ["Reconnect the share (net use) and check Socia's share settings.", "Socia picks the files up again on its next scan."] },
  outlook: { check: ["Is the desk mailbox reachable in Outlook on the web?", "Did the Microsoft Graph app secret expire?"], fix: ["Renew the secret or sign-in, then wait for the next poll."] },
  whatsapp: { check: ["Is the WhatsApp webhook still registered with Meta?", "Did the access token expire?"], fix: ["Renew the token or re-register the webhook."] },
  octopus: { check: ["Can the feed URL be opened?", "Is Octopus itself up (ask Octopus IT)?"], fix: ["Restore the feed, or ask Octopus IT to restart their poller."] },
};

export const checkFailing: Rule = (ctx) =>
  ctx.probes
    .filter((p) => p.target.startsWith("check:") && !p.target.endsWith(":db") && p.health === "down")
    .map((p) => {
      const id = p.target.split(":")[2];
      const help = CHECK_HELP[id] ?? { check: [`Read the ${id} check on the system page.`], fix: ["Fix what the check reports; the alert clears at the next good check."] };
      return {
        ruleId: "check-failing",
        target: p.target,
        severity: CHECK_SEVERITY[id] ?? "warning",
        title: `${p.label} is failing`,
        systems: p.systems,
        evidence: p.systems.map(sys),
        runbook: { meaning: `${p.reason}.`, checkFirst: help.check, fix: help.fix },
      } satisfies Finding;
    });

// ─── 6. No intake during working hours ──────────────────────────────────────

export const noIntake: Rule = (ctx, blind = noop) => {
  const { noIntakeMinutes, workStartHour, workEndHour } = ctx.levels;
  const hour = istHour(ctx.now);
  const since = ctx.now - noIntakeMinutes * MIN;
  const nowCount = ctx.ops.samvadia.summary?.flow.storiesIn ?? null;
  const then = ctx.storiesInAt(since);
  // Outside working hours, a window reaching back before their start, or nothing to compare: no judgement
  if (hour < workStartHour || hour >= workEndHour || istDate(since) !== istDate(ctx.now) || istHour(since) < workStartHour || nowCount === null || then === null) {
    blind();
    return [];
  }
  if (nowCount > then) return [];
  return [
    {
      ruleId: "no-intake",
      target: "samvadia",
      severity: "warning",
      title: `No story came in for ${noIntakeMinutes} min during working hours`,
      systems: ["samvadia-api", "whatsapp", "outlook", "reporter-portal"],
      evidence: [sys("samvadia-api"), sys("whatsapp"), sys("outlook")],
      runbook: {
        meaning: `Samvadia's stories-in count has stayed at ${nowCount} since ${hhmm(since)}. Between ${workStartHour}:00 and ${workEndHour}:00 IST something usually arrives within ${noIntakeMinutes} min.`,
        checkFirst: ["Are the WhatsApp and Outlook checks OK on Systems?", "Can a reporter sign in to the portal?", "Is it simply a quiet hour (holiday)?"],
        fix: ["Fix the intake channel that is down.", "Ask a reporter to send a test story.", "The alert clears as soon as a story comes in."],
      },
    },
  ];
};

// ─── 7. Stories stuck ───────────────────────────────────────────────────────

const STAGE_SYSTEMS: Record<string, SystemId[]> = {
  intake: ["samvadia-api"],
  desk: ["assignment-desk", "samvadia-api"],
  ftp: ["ftp", "samvadia-worker"],
  feed: ["samvadia-api"],
  octopus: ["octopus"],
  ingest: ["socia-ingest"],
  convert: ["socia-ingest"],
  compose: ["socia-ingest"],
  render: ["socia-render"],
  operator: ["digital-desk"],
  publish: ["socia-publish", "x"],
};

/** Stages where a story waits for a person (desk decision, operator): never critical, never an auto incident. */
export const HUMAN_STAGES = new Set(["desk", "operator"]);

export const storiesStuck: Rule = (ctx) => {
  const out: Finding[] = [];
  for (const source of ["samvadia", "socia"] as OpsSource[]) {
    const stuck = (ctx.ops[source].summary?.stuck ?? []).filter((s) => s.minutes >= ctx.levels.stuckMinMinutes);
    const byStage = new Map<string, typeof stuck>();
    for (const s of stuck) byStage.set(s.stage, [...(byStage.get(s.stage) ?? []), s]);
    for (const [stage, items] of byStage) {
      const oldest = items.reduce((a, b) => (b.minutes > a.minutes ? b : a));
      const systems = STAGE_SYSTEMS[stage] ?? [source === "samvadia" ? "samvadia-api" : "socia-api"];
      out.push({
        ruleId: "stories-stuck",
        target: `${source}:${stage}`,
        severity: !HUMAN_STAGES.has(stage) && items.length >= 5 ? "critical" : "warning",
        title: `${plural(items.length, "story", "stories")} stuck at ${stage} in ${SYSTEM_LABEL[source]} (oldest ${oldest.minutes} min)`,
        systems,
        evidence: [...items.slice(0, 10).map((s): Evidence => ({ kind: "trace", id: s.slug, label: s.slug })), ...systems.map(sys)],
        runbook: {
          meaning: `${SYSTEM_LABEL[source]} reports ${plural(items.length, "story", "stories")} waiting at ${stage} longer than its limit. The oldest, ${oldest.slug}, has waited ${oldest.minutes} min.`,
          checkFirst: [`Open the trace of ${oldest.slug}.`, `Is the system behind ${stage} healthy on Systems?`, "Is a person needed (desk decision, operator)?"],
          fix: ["Unblock the stage (restart the worker, fix the upload, decide on the desk).", "The alert clears when nothing is stuck there any more."],
        },
      });
    }
  }
  return out;
};

// ─── 9. A check gone quiet ──────────────────────────────────────────────────

const QUIET: { source: OpsSource; id: string; level: keyof RuleLevels; systems: SystemId[] }[] = [
  { source: "samvadia", id: "octopus", level: "quietOctopusMin", systems: ["octopus"] },
  { source: "samvadia", id: "whatsapp", level: "quietWhatsappMin", systems: ["whatsapp"] },
  { source: "samvadia", id: "outlook", level: "quietOutlookMin", systems: ["outlook"] },
  { source: "socia", id: "share", level: "quietShareMin", systems: ["socia-ingest"] },
];

/** In working hours, a check that has not succeeded for a while (Octopus not fetching, no mail polled...). */
export const checkQuiet: Rule = (ctx, blind = noop) => {
  const { workStartHour, workEndHour } = ctx.levels;
  const hour = istHour(ctx.now);
  if (hour < workStartHour || hour >= workEndHour) {
    blind();
    return [];
  }
  const out: Finding[] = [];
  for (const q of QUIET) {
    const target = `${q.source}:${q.id}`;
    const c = ctx.ops[q.source].summary?.checks.find((x) => x.id === q.id);
    // Already failing: check-failing covers it, and this alert may clear
    if (c?.ok === false) continue;
    // Not reported or never succeeded: nothing to judge by
    if (!c || c.ok === null || !c.lastOkAt) {
      blind(target);
      continue;
    }
    const limit = ctx.levels[q.level] * MIN;
    const since = Date.parse(c.lastOkAt);
    const quietFor = ctx.now - since;
    // The whole quiet stretch that counts must be inside today's working hours
    const windowStart = ctx.now - limit;
    if (istDate(windowStart) !== istDate(ctx.now) || istHour(windowStart) < workStartHour) {
      blind(target);
      continue;
    }
    if (quietFor < limit) continue;
    const minutes = Math.round(quietFor / MIN);
    out.push({
      ruleId: "check-quiet",
      target: `${q.source}:${q.id}`,
      severity: "warning",
      title: `${c.label}: nothing for ${minutes >= 120 ? `${Math.round(minutes / 60)} h` : `${minutes} min`} (last at ${hhmm(c.lastOkAt)})`,
      systems: q.systems,
      evidence: q.systems.map(sys),
      runbook: {
        meaning: `${SYSTEM_LABEL[q.source]} last saw ${c.label} succeed at ${hhmm(c.lastOkAt)}, ${minutes} min ago. During working hours that usually happens within ${ctx.levels[q.level]} min.`,
        checkFirst: CHECK_HELP[q.id]?.check ?? [`Read the ${q.id} check on the system page.`],
        fix: CHECK_HELP[q.id]?.fix ?? ["Fix what stopped it; the alert clears at the next success."],
      },
    });
  }
  return out;
};

// ─── 8. Backup too old ──────────────────────────────────────────────────────

export const backupOld: Rule = (ctx) =>
  ctx.probes
    .filter((p) => p.target === "backups" && (p.health === "warn" || p.health === "down"))
    .map((p) => ({
      ruleId: "backup-old",
      target: "backups",
      severity: "warning",
      title: p.value === null || p.value === undefined ? "No database backup found" : `Newest database backup is ${Math.round(p.value)} h old`,
      systems: ["backups"],
      evidence: [sys("backups")],
      runbook: {
        meaning: `${p.reason}. A backup older than ${ctx.levels.backupMaxHours} h means a bad day could lose more than a day of work.`,
        checkFirst: ["Did the scheduled task run? Look at Task Scheduler history.", "Is the backup folder's disk full?"],
        fix: ["Run: powershell -ExecutionPolicy Bypass -File C:\\vartmaan\\code\\digital\\backup-socia-db.ps1 -NoPause", "Fix the scheduled task so it runs every night."],
      },
    }) satisfies Finding);

export const RULES: Record<string, Rule> = {
  "service-down": serviceDown,
  "heartbeat-stale": heartbeatStale,
  "error-spike": errorSpike,
  "error-repeat": errorRepeat,
  "check-failing": checkFailing,
  "no-intake": noIntake,
  "stories-stuck": storiesStuck,
  "backup-old": backupOld,
  "check-quiet": checkQuiet,
};

/** Which backend's summary an alert depends on (from its rule and target), or null. */
export function alertSource(ruleId: string, target: string): OpsSource | null {
  const m =
    /^(?:hb|check):(samvadia|socia):/.exec(target) ??
    /^postgres:(samvadia|socia)$/.exec(target) ??
    (["stories-stuck", "check-quiet"].includes(ruleId) ? /^(samvadia|socia):/.exec(target) : null);
  if (m) return m[1] as OpsSource;
  return ruleId === "no-intake" ? "samvadia" : null;
}

/** What one round could not look at: its alerts must stay as they are (no auto-resolve). */
export interface Blind {
  rules: Set<string>; // rules that threw, or had nothing to look at
  sources: Set<OpsSource>; // backends whose summary is missing or stale
  logSources?: Set<OpsSource>; // backends whose log pull is behind (error-spike, error-repeat)
  keys?: Set<string>; // single rule + target pairs ("heartbeat-stale:hb:samvadia:worker")
}

const LOG_RULES = new Set(["error-spike", "error-repeat"]);

/** The backend a system id's log lines come from ("samvadia-worker" -> samvadia). */
const logSourceOf = (target: string): OpsSource | null => (target.startsWith("samvadia-") ? "samvadia" : target.startsWith("socia-") ? "socia" : null);

export function isBlind(blind: Blind, ruleId: string, target: string): boolean {
  if (blind.rules.has(ruleId) || blind.keys?.has(`${ruleId}:${target}`)) return true;
  if (LOG_RULES.has(ruleId)) {
    const src = logSourceOf(target);
    if (src && blind.logSources?.has(src)) return true;
  }
  const src = alertSource(ruleId, target);
  return src !== null && blind.sources.has(src);
}

/** Every rule over one context, and what it could not see. A rule that throws is reported, marked blind and skipped. */
export function evaluate(ctx: DetectContext): { findings: Finding[]; blind: Blind } {
  const findings: Finding[] = [];
  const blind: Blind = { rules: new Set(), sources: new Set(), logSources: new Set(ctx.logsStale ?? []), keys: new Set() };
  for (const src of ["samvadia", "socia"] as OpsSource[]) if (!ctx.ops[src].summary) blind.sources.add(src);
  // A process whose heartbeat is "gone" (older than heartbeatGoneSec) raises no new alert, but an
  // alert already open for it is not proof it recovered: only a person resolves that one
  for (const p of ctx.probes) if (p.target.startsWith("hb:") && p.gone) blind.keys!.add(`heartbeat-stale:${p.target}`);
  // Before the first probe round there is nothing to judge probe-based alerts by
  if (!ctx.probes.length) for (const r of ["service-down", "heartbeat-stale", "check-failing", "backup-old"]) blind.rules.add(r);
  // The backup folder could not be read: the backup alert stays as it is
  if (ctx.probes.some((p) => p.target === "backups" && p.health === "unknown")) blind.rules.add("backup-old");
  for (const [id, rule] of Object.entries(RULES)) {
    try {
      findings.push(...rule(ctx, (target) => (target === undefined ? blind.rules.add(id) : blind.keys!.add(`${id}:${target}`))));
    } catch (e) {
      blind.rules.add(id);
      console.error(`[detect] rule ${id} failed: ${(e as Error).message}`);
    }
  }
  return { findings, blind };
}
