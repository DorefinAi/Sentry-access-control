// Thresholds the team can move, kept in memory and in thresholds.local.json (gitignored) so they
// survive a restart:
// - gauge levels (warnAt / dangerAt per dial), changed from the Overview knobs;
// - detection rule levels under "rules" (detect/rules.ts), changed by editing the file. Missing
//   keys get their defaults, and the defaults are written into the file once so they are easy to find.
import { readFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { badRequest, notFound } from "./http";
import { addNotification } from "./notifications";
import { recordAction } from "./store";
import { nowIso } from "./time";
import { isRecord } from "./validate";

export type GaugeId = "stuck" | "queue" | "uptime" | "to-feed" | "octopus-lag";

export interface GaugeSpec {
  label: string;
  unit: string;
  max: number;
  direction: "up" | "down"; // up = higher is worse
  warnAt: number;
  dangerAt: number;
}

export const GAUGE_SPECS: Record<GaugeId, GaugeSpec> = {
  stuck: { label: "Stuck stories", unit: "stories", max: 20, direction: "up", warnAt: 1, dangerAt: 5 },
  queue: { label: "Queue depth", unit: "jobs", max: 30, direction: "up", warnAt: 10, dangerAt: 25 },
  uptime: { label: "Uptime 24h", unit: "%", max: 100, direction: "down", warnAt: 99.5, dangerAt: 99 },
  "to-feed": { label: "Median time to feed", unit: "min", max: 30, direction: "up", warnAt: 15, dangerAt: 25 },
  "octopus-lag": { label: "Octopus last poll", unit: "s", max: 300, direction: "up", warnAt: 120, dangerAt: 300 },
};

export const GAUGE_IDS = Object.keys(GAUGE_SPECS) as GaugeId[];

/** Detection levels (detect/rules.ts). Times in seconds or minutes as named; hours are IST. */
export interface RuleLevels {
  heartbeatWarnSec: number; // a process silent this long is a warning
  heartbeatDownSec: number; // ... and this long is down (critical)
  heartbeatGoneSec: number; // ... and this long is "gone" (a retired process): unknown, no alert
  errorSpikeWindowMin: number; // errors are counted over this window
  errorSpikeMin: number; // at least this many errors in the window
  errorSpikeFactor: number; // and this many times the normal rate (last 24 h)
  errorRepeatCount: number; // the same error this many times...
  errorRepeatWindowMin: number; // ...within this many minutes
  noIntakeMinutes: number; // no story in for this long during working hours
  workStartHour: number; // working hours, IST
  workEndHour: number;
  backupMaxHours: number; // the newest backup may be this old
  quietOctopusMin: number; // in working hours, a check whose last success is older than this is "gone quiet"
  quietWhatsappMin: number;
  quietOutlookMin: number;
  quietShareMin: number;
  stuckMinMinutes: number; // Sentry's own floor on top of the backends' stuck limits (0 = take theirs)
  autoIncidentMinutes: number; // a critical alert open this long opens an incident
  opsStaleSec: number; // an ops summary older than this is not used
}

export const RULE_DEFAULTS: RuleLevels = {
  heartbeatWarnSec: 90,
  heartbeatDownSec: 300,
  heartbeatGoneSec: 3600,
  errorSpikeWindowMin: 10,
  errorSpikeMin: 5,
  errorSpikeFactor: 3,
  errorRepeatCount: 5,
  errorRepeatWindowMin: 30,
  noIntakeMinutes: 60,
  workStartHour: 8,
  workEndHour: 23,
  backupMaxHours: 26,
  quietOctopusMin: 15,
  quietWhatsappMin: 120,
  quietOutlookMin: 60,
  quietShareMin: 60,
  stuckMinMinutes: 0,
  autoIncidentMinutes: 5,
  opsStaleSec: 120,
};

const RULE_LIMITS: Record<keyof RuleLevels, [number, number]> = {
  heartbeatWarnSec: [10, 3600],
  heartbeatDownSec: [10, 86_400],
  heartbeatGoneSec: [60, 30 * 86_400],
  errorSpikeWindowMin: [1, 120],
  errorSpikeMin: [1, 100_000],
  errorSpikeFactor: [1, 1000],
  errorRepeatCount: [2, 100_000],
  errorRepeatWindowMin: [1, 1440],
  noIntakeMinutes: [5, 1440],
  workStartHour: [0, 23],
  workEndHour: [1, 24],
  backupMaxHours: [1, 24 * 30],
  quietOctopusMin: [1, 1440],
  quietWhatsappMin: [1, 1440],
  quietOutlookMin: [1, 1440],
  quietShareMin: [1, 1440],
  stuckMinMinutes: [0, 1440],
  autoIncidentMinutes: [0, 1440],
  opsStaleSec: [30, 3600],
};

const FILE = () => path.join(process.cwd(), "thresholds.local.json");

type Levels = Record<GaugeId, { warnAt: number; dangerAt: number }>;
interface Saved {
  levels: Levels;
  rules: RuleLevels;
  file: string;
}
const g = globalThis as typeof globalThis & { __sentryThresholds?: Saved };

function valid(id: GaugeId, warnAt: number, dangerAt: number): string | null {
  const { max, direction } = GAUGE_SPECS[id];
  const inRange = (n: number) => Number.isFinite(n) && n >= 0 && n <= max;
  if (!inRange(warnAt) || !inRange(dangerAt)) return `warnAt and dangerAt must be between 0 and ${max}.`;
  if (direction === "up" && !(warnAt < dangerAt)) return "warnAt must be below dangerAt (higher is worse on this gauge).";
  if (direction === "down" && !(warnAt > dangerAt)) return "warnAt must be above dangerAt (lower is worse on this gauge).";
  return null;
}

function load(): Saved {
  const file = FILE();
  if (g.__sentryThresholds?.file === file) return g.__sentryThresholds;
  const levels = Object.fromEntries(GAUGE_IDS.map((id) => [id, { warnAt: GAUGE_SPECS[id].warnAt, dangerAt: GAUGE_SPECS[id].dangerAt }])) as Levels;
  const rules: RuleLevels = { ...RULE_DEFAULTS };
  let raw: Record<string, unknown> | null = null;
  let readable = true;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    raw = isRecord(parsed) ? parsed : null;
  } catch (e) {
    // No file yet: defaults. Unreadable or not JSON: defaults, and the file is left alone.
    readable = (e as NodeJS.ErrnoException).code === "ENOENT";
  }
  if (raw) {
    for (const id of GAUGE_IDS) {
      const s = raw[id];
      if (isRecord(s) && typeof s.warnAt === "number" && typeof s.dangerAt === "number" && !valid(id, s.warnAt, s.dangerAt)) levels[id] = { warnAt: s.warnAt, dangerAt: s.dangerAt };
    }
    const r = isRecord(raw.rules) ? raw.rules : {};
    for (const k of Object.keys(RULE_DEFAULTS) as (keyof RuleLevels)[]) {
      const v = r[k];
      const [lo, hi] = RULE_LIMITS[k];
      if (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi) rules[k] = v;
    }
    if (rules.heartbeatDownSec <= rules.heartbeatWarnSec) rules.heartbeatDownSec = Math.max(RULE_DEFAULTS.heartbeatDownSec, rules.heartbeatWarnSec + 1);
    if (rules.heartbeatGoneSec <= rules.heartbeatDownSec) rules.heartbeatGoneSec = Math.max(RULE_DEFAULTS.heartbeatGoneSec, rules.heartbeatDownSec + 1);
    if (rules.workEndHour <= rules.workStartHour) Object.assign(rules, { workStartHour: RULE_DEFAULTS.workStartHour, workEndHour: RULE_DEFAULTS.workEndHour });
  }
  const saved = (g.__sentryThresholds = { levels, rules, file });
  // Write the rule defaults into the file once, so the team can see and change them there
  const missing = !raw || !isRecord(raw.rules) || Object.keys(RULE_DEFAULTS).some((k) => !(k in (raw!.rules as Record<string, unknown>)));
  if (readable && missing) void save(saved).catch((e) => console.error(`[thresholds] could not write thresholds.local.json: ${(e as Error).message}`));
  return saved;
}

export function thresholds(): Levels {
  return load().levels;
}

export function ruleThresholds(): RuleLevels {
  return load().rules;
}

/** For tests: forget what was loaded, so the next read comes from the file (or the defaults). */
export function resetThresholds(rules?: Partial<RuleLevels>): void {
  g.__sentryThresholds = undefined;
  if (rules) Object.assign(load().rules, rules);
}

export function isGaugeId(id: string): id is GaugeId {
  return (GAUGE_IDS as string[]).includes(id);
}

export function parseThresholdPatch(id: string, body: unknown): { warnAt: number; dangerAt: number } {
  if (!isGaugeId(id)) throw notFound(`There is no gauge called "${id}". Gauges: ${GAUGE_IDS.join(", ")}.`);
  if (!isRecord(body)) throw badRequest('Send {"warnAt": 85} and/or {"dangerAt": 95}.');
  for (const k of ["warnAt", "dangerAt"] as const) {
    if (body[k] !== undefined && typeof body[k] !== "number") throw badRequest(`${k} must be a number.`);
  }
  if (body.warnAt === undefined && body.dangerAt === undefined) throw badRequest("Nothing to change. Send warnAt and/or dangerAt.");
  const cur = thresholds()[id];
  const next = { warnAt: (body.warnAt as number | undefined) ?? cur.warnAt, dangerAt: (body.dangerAt as number | undefined) ?? cur.dangerAt };
  const problem = valid(id, next.warnAt, next.dangerAt);
  if (problem) throw badRequest(problem);
  return next;
}

// One write at a time; the in-memory value changes only after the file is saved
let writing: Promise<void> = Promise.resolve();
function save(s: Saved): Promise<void> {
  const body = JSON.stringify({ ...s.levels, rules: s.rules }, null, 2) + "\n";
  const run = writing.then(async () => {
    const tmp = `${s.file}.tmp`;
    await writeFile(tmp, body);
    await rename(tmp, s.file);
  });
  writing = run.catch(() => undefined);
  return run;
}

const fmt = (id: GaugeId, n: number) => `${n}${GAUGE_SPECS[id].unit === "%" ? "%" : ` ${GAUGE_SPECS[id].unit}`}`;

export async function setThreshold(id: GaugeId, next: { warnAt: number; dangerAt: number }, actor: string): Promise<void> {
  const s = load();
  const before = s.levels[id];
  await save({ ...s, levels: { ...s.levels, [id]: next } });
  s.levels[id] = next;

  const at = nowIso();
  const changes = [
    before.warnAt !== next.warnAt ? `${GAUGE_SPECS[id].label} warning to ${fmt(id, next.warnAt)}` : null,
    before.dangerAt !== next.dangerAt ? `${GAUGE_SPECS[id].label} danger to ${fmt(id, next.dangerAt)}` : null,
  ].filter(Boolean);
  if (changes.length) {
    const text = `${actor} set ${changes.join(" and ")}`;
    recordAction({ at, user: actor, kind: "settings", text });
    addNotification({ at, kind: "team_change", severity: "info", title: text, body: "Gauge threshold changed", evidence: [] });
  }
}
