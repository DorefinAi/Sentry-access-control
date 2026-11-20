// The mission-control readouts, all from stored history: telemetry from ops snapshots and the logs
// table, streaks and uptime from health samples, gauges from the moment's ops summaries. Each takes
// the moment it describes, so the live board and a replay are built by the same code.
import type { Gauge, Health, StackUptime, System, TelemetryPoint, UptimeStreak } from "@/types/control";
import { db } from "./db";
import { errorsPerBucket } from "./logs";
import type { Moment } from "./moment";
import { streakAt, uptimePct } from "./probes/health";
import { GAUGE_SPECS, thresholds, type GaugeId } from "./thresholds";
import { dayStartMs, ist, istDate } from "./time";

const MIN = 60_000;
const DAY = 86_400_000;
const BUCKET_MS = 10 * MIN;
const NEAR_MS = 2 * MIN; // a snapshot this close before a bucket edge stands for that edge

interface SnapPoint {
  atMs: number;
  untilMs: number; // the same answer was seen until then
  storiesIn: number | null;
  octopusOkAt: string | null;
}

/** Samvadia's snapshots of one day, reduced in SQL to the two numbers telemetry needs. */
function samvadiaPoints(fromMs: number, toMs: number): SnapPoint[] {
  const rows = db()
    .prepare(
      `SELECT at_ms, coalesce(until_ms, at_ms) AS until_ms,
              json_extract(body, '$.flow.storiesIn') AS n,
              (SELECT json_extract(value, '$.lastOkAt') FROM json_each(body, '$.checks') WHERE json_extract(value, '$.id') = 'octopus') AS oct
         FROM ops_snapshots WHERE source = 'samvadia' AND ok = 1 AND coalesce(until_ms, at_ms) >= ? AND at_ms <= ? ORDER BY at_ms`,
    )
    .all(fromMs, toMs) as { at_ms: number; until_ms: number; n: number | null; oct: string | null }[];
  return rows.map((r) => ({ atMs: r.at_ms, untilMs: r.until_ms, storiesIn: typeof r.n === "number" ? r.n : null, octopusOkAt: r.oct }));
}

/** Today's activity in 10-minute buckets up to the moment. */
export function telemetry(m: Moment): TelemetryPoint[] {
  const date = istDate(m.atMs);
  const start = dayStartMs(date);
  const end = m.atMs;
  const points = samvadiaPoints(start, end);
  const valueAt = (t: number): number | null => {
    if (t <= start) return 0;
    let best: SnapPoint | null = null;
    for (const p of points) {
      if (p.atMs > t) break;
      best = p;
    }
    return best && t - best.untilMs <= NEAR_MS ? best.storiesIn : null;
  };
  const buckets = Math.max(1, Math.ceil((end - start + 1) / BUCKET_MS));
  const errors = errorsPerBucket(start, end + 1, BUCKET_MS);
  const polls = new Set(points.map((p) => p.octopusOkAt).filter((x): x is string => !!x).map((x) => Date.parse(x)).filter((t) => t >= start && t <= end));

  const stories: (number | null)[] = [];
  for (let b = 0; b < buckets; b++) {
    const v0 = valueAt(start + b * BUCKET_MS);
    const v1 = valueAt(Math.min(start + (b + 1) * BUCKET_MS, end));
    stories.push(v0 !== null && v1 !== null ? Math.max(0, v1 - v0) : null);
  }
  // Hours Sentry did not watch fully: the backend's hourly count, shown in the hour's first bucket
  const hourly = m.ops.samvadia.summary && m.ops.samvadia.summary.date === date ? m.ops.samvadia.summary.hourly : null;
  for (let h = 0; h < 24; h++) {
    const idx = Array.from({ length: 6 }, (_, k) => h * 6 + k).filter((i) => i < buckets);
    if (!idx.length || !idx.some((i) => stories[i] === null)) continue;
    idx.forEach((i, k) => (stories[i] = k === 0 ? (hourly?.[h]?.storiesIn ?? 0) : 0));
  }

  return Array.from({ length: buckets }, (_, b) => {
    const from = start + b * BUCKET_MS;
    const to = from + BUCKET_MS;
    let feedPolls = 0;
    for (const t of polls) if (t >= from && t < to) feedPolls++;
    return { at: ist(from), storiesIn: stories[b] ?? 0, errors: errors[b] ?? 0, feedPolls };
  });
}

export function streaks(m: Moment, systems: System[]): UptimeStreak[] {
  return systems
    .map((sys): UptimeStreak | null => {
      const s = streakAt(sys.id, m.atMs);
      if (!s.known) return null; // never watched: no streak to show
      return {
        system: sys.id,
        name: sys.name,
        health: sys.health,
        upSince: s.upSince,
        streakSec: s.streakSec,
        longestStreakSec: s.longestStreakSec,
        uptimePct7d: uptimePct(sys.id, m.atMs - 7 * DAY, m.atMs) ?? 0,
        lastOutage: s.lastOutage,
      };
    })
    .filter((x): x is UptimeStreak => x !== null)
    .sort((a, b) => b.streakSec - a.streakSec);
}

export function stackUptime(m: Moment): StackUptime {
  const s = streakAt("stack", m.atMs);
  return {
    upSince: s.upSince,
    streakSec: s.streakSec,
    longestStreakSec: s.longestStreakSec,
    uptimePct24h: uptimePct("stack", m.atMs - DAY, m.atMs) ?? 0,
    uptimePct7d: uptimePct("stack", m.atMs - 7 * DAY, m.atMs) ?? 0,
    lastOutage: s.lastOutage,
  };
}

function level(value: number | null, warnAt: number, dangerAt: number, direction: "up" | "down"): Health {
  if (value === null) return "unknown";
  if (direction === "down") return value <= dangerAt ? "down" : value <= warnAt ? "warn" : "ok";
  return value >= dangerAt ? "down" : value >= warnAt ? "warn" : "ok";
}

// One dial from its spec and the team's current thresholds. A null value shows "–" and unknown.
function dial(id: GaugeId, value: number | null, display: string, hint: string, live?: Gauge["live"]): Gauge {
  const spec = GAUGE_SPECS[id];
  const { warnAt, dangerAt } = thresholds()[id];
  return {
    id,
    label: spec.label,
    value: value ?? 0,
    max: spec.max,
    unit: spec.unit,
    display: value === null ? "–" : display,
    health: level(value, warnAt, dangerAt, spec.direction),
    warnAt,
    dangerAt,
    direction: spec.direction,
    hint,
    ...(live ? { live } : {}),
  };
}

export function gauges(m: Moment, uptime: StackUptime): Gauge[] {
  const sam = m.ops.samvadia.summary;
  const soc = m.ops.socia.summary;
  const anyOps = !!sam || !!soc;

  const stuck = anyOps ? (sam?.stuck.length ?? 0) + (soc?.stuck.length ?? 0) : null;
  const queues = [...(sam?.queues ?? []), ...(soc?.queues ?? [])];
  const pending = anyOps ? queues.reduce((n, q) => n + q.pending, 0) : null;
  const upKnown = uptimePct("stack", m.atMs - DAY, m.atMs) !== null;
  const median = sam ? sam.flow.medianMinutesToFeed : null;
  const octopus = sam?.checks.find((c) => c.id === "octopus");
  const lag = octopus?.lastOkAt ? Math.max(0, Math.round((m.atMs - Date.parse(octopus.lastOkAt)) / 1000)) : null;
  const { warnAt: lagWarn } = thresholds()["octopus-lag"];
  // On the live board the lag keeps counting up from the last poll until the next refresh
  const lagLive = !m.replay && octopus?.lastOkAt ? { since: octopus.lastOkAt, ratePerSec: 1, cap: GAUGE_SPECS["octopus-lag"].max } : undefined;
  const why = (src: string | null) => src ?? "No data";

  return [
    dial("stuck", stuck, String(stuck), stuck === null ? why(m.ops.samvadia.problem ?? m.ops.socia.problem) : stuck ? `${stuck} ${stuck === 1 ? "story waits" : "stories wait"} past the stage limit` : "Nothing stuck"),
    dial("queue", pending, String(pending), pending === null ? why(m.ops.samvadia.problem) : `${pending} ${pending === 1 ? "job" : "jobs"} pending in the job queues`),
    dial(
      "uptime",
      upKnown ? uptime.uptimePct24h : null,
      `${uptime.uptimePct24h}%`,
      !upKnown ? "No health history yet" : uptime.lastOutage ? `Last outage: ${uptime.lastOutage.reason}` : "No outage in the last 24 h",
    ),
    dial("to-feed", median, `${median} min`, sam ? `${sam.flow.inFeed} stories in the feed today` : why(m.ops.samvadia.problem)),
    dial("octopus-lag", lag, `${lag} s`, lag === null ? (sam ? "Samvadia has not seen Octopus fetch the feed" : why(m.ops.samvadia.problem)) : lag >= lagWarn ? "Octopus is not fetching the feed" : "Octopus fetches the feed", lagLive),
  ];
}
