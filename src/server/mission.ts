// The mission-control readouts: telemetry, gauges, uptime streaks. Each takes the moment it
// describes, so the live board and a replay are built by the same code.
import type { Gauge, Health, Outage, StackUptime, System, SystemId, TelemetryPoint, UptimeStreak } from "@/types/control";
import { LOGS } from "@/data/logs";
import { at as atTime, ms, TODAY } from "@/data/time";
import { OUTAGES, STACK_OUTAGES, uptimePct } from "@/data/uptime";
import { OCTOPUS_GAP, POLL_SECOND } from "@/data/world";
import type { Moment } from "./moment";
import { GAUGE_SPECS, thresholds, type GaugeId } from "./thresholds";

const MIN = 60_000;
const DAY_MS = 86_400_000;
const BUCKET_MIN = 10;

const dayStart = () => ms(atTime("00:00", TODAY));

function polledAt(minute: number): boolean {
  const t = dayStart() + minute * MIN;
  return t < ms(OCTOPUS_GAP.from) || t >= ms(OCTOPUS_GAP.resumedAt);
}

// Seconds since Octopus last polled (polls land at :28 past each minute).
export function octopusLagSec(at: string): number {
  const t = ms(at);
  for (let m = Math.floor((t - dayStart()) / MIN); m >= 0; m--) {
    const pollMs = dayStart() + m * MIN + POLL_SECOND * 1000;
    if (pollMs <= t && polledAt(m)) return Math.round((t - pollMs) / 1000);
  }
  return Math.round((t - dayStart()) / 1000);
}

export function telemetry(m: Moment): TelemetryPoint[] {
  const t = ms(m.at);
  const points: TelemetryPoint[] = [];
  for (let b = 0; dayStart() + b * BUCKET_MIN * MIN <= t; b++) {
    const from = dayStart() + b * BUCKET_MIN * MIN;
    const to = Math.min(from + BUCKET_MIN * MIN, t + 1);
    const inBucket = (iso: string) => ms(iso) >= from && ms(iso) < to;
    let polls = 0;
    for (let k = 0; k < BUCKET_MIN; k++) {
      const minute = b * BUCKET_MIN + k;
      if (dayStart() + minute * MIN + POLL_SECOND * 1000 < to && polledAt(minute)) polls++;
    }
    points.push({
      at: new Date(from + 5.5 * 3600_000).toISOString().slice(0, 19) + "+05:30",
      storiesIn: m.stories.filter((s) => inBucket(s.receivedAt)).length,
      errors: LOGS.filter((l) => l.level === "error" && inBucket(l.at)).length,
      feedPolls: polls,
    });
  }
  return points;
}

// Where `at` falls in a list of outages: the current streak, or the outage still going on.
function streakFrom(outages: Outage[], at: string): { upSince: string; streakSec: number; lastOutage: Outage | null } {
  const t = ms(at);
  const past = outages.filter((o) => ms(o.from) <= t).sort((a, b) => ms(a.from) - ms(b.from));
  const last = past.at(-1);
  if (!last) return { upSince: outages[0]?.from ?? at, streakSec: 0, lastOutage: null };
  if (!last.to || ms(last.to) > t) {
    return { upSince: at, streakSec: 0, lastOutage: { ...last, to: null } };
  }
  return { upSince: last.to, streakSec: Math.round((t - ms(last.to)) / 1000), lastOutage: last };
}

// Best streak between outages that had ended by `at`, or the current one if longer.
function longestFrom(outages: Outage[], at: string, floorSec: number, current: number): number {
  const t = ms(at);
  const ended = outages.filter((o) => o.to && ms(o.to) <= t).sort((a, b) => ms(a.from) - ms(b.from));
  let best = floorSec;
  for (let i = 1; i < ended.length; i++) best = Math.max(best, Math.round((ms(ended[i].from) - ms(ended[i - 1].to!)) / 1000));
  return Math.max(best, current);
}

export function streaks(m: Moment, systems: System[]): UptimeStreak[] {
  const t = ms(m.at);
  return systems
    .map((sys): UptimeStreak => {
      const o = OUTAGES[sys.id];
      const cur = streakFrom(o.outages, m.at);
      return {
        system: sys.id,
        name: sys.name,
        health: sys.health,
        ...cur,
        longestStreakSec: longestFrom(o.outages, m.at, o.longestSec, cur.streakSec),
        uptimePct7d: uptimePct(o.outages.filter((x) => ms(x.from) <= t), t - 7 * DAY_MS, t),
      };
    })
    .sort((a, b) => b.streakSec - a.streakSec);
}

export function stackUptime(m: Moment): StackUptime {
  const t = ms(m.at);
  const known = STACK_OUTAGES.filter((o) => ms(o.from) <= t);
  const cur = streakFrom(known, m.at);
  return {
    ...cur,
    longestStreakSec: longestFrom(known, m.at, 0, cur.streakSec),
    uptimePct24h: uptimePct(known, t - DAY_MS, t),
    uptimePct7d: uptimePct(known, t - 7 * DAY_MS, t),
  };
}

function level(value: number, warnAt: number, dangerAt: number, direction: "up" | "down"): Health {
  if (direction === "down") return value <= dangerAt ? "down" : value <= warnAt ? "warn" : "ok";
  return value >= dangerAt ? "down" : value >= warnAt ? "warn" : "ok";
}

// One dial from its spec and the team's current thresholds.
function dial(id: GaugeId, value: number, display: string, hint: string, live?: Gauge["live"]): Gauge {
  const spec = GAUGE_SPECS[id];
  const { warnAt, dangerAt } = thresholds()[id];
  return {
    id,
    label: spec.label,
    value,
    max: spec.max,
    unit: spec.unit,
    display,
    health: level(value, warnAt, dangerAt, spec.direction),
    warnAt,
    dangerAt,
    direction: spec.direction,
    hint,
    ...(live ? { live } : {}),
  };
}

export function gauges(m: Moment, uptime: StackUptime): Gauge[] {
  const { stats: s, cap } = m;
  const lag = octopusLagSec(m.at);
  const median = s.medianMinutesToFeed ?? 0;
  const { warnAt: lagWarn } = thresholds()["octopus-lag"];
  // On the live board the lag keeps counting up from the last poll until the next refresh.
  const lagLive = m.replay ? undefined : { since: new Date(ms(m.at) - lag * 1000 + 5.5 * 3600_000).toISOString().slice(0, 19) + "+05:30", ratePerSec: 1, cap: GAUGE_SPECS["octopus-lag"].max };
  return [
    dial("x-cap", cap.pct, `${cap.pct}%`, `${cap.used} of ${cap.limit} daily X writes used`),
    dial("queue", s.uploading, String(s.uploading), `${s.uploading} media ${s.uploading === 1 ? "job" : "jobs"} pending in the worker`),
    dial("uptime", uptime.uptimePct24h, `${uptime.uptimePct24h}%`, uptime.lastOutage ? `Last outage: ${uptime.lastOutage.reason}` : "No outage in the last 24 h"),
    dial("to-feed", median, s.medianMinutesToFeed === null ? "–" : `${median} min`, `${s.inFeed} stories in the feed today`),
    dial("octopus-lag", lag, `${lag} s`, lag >= lagWarn ? "Octopus is not polling the feed" : "Octopus polls every minute", lagLive),
  ];
}

// A system with an outage covering this moment is down, whatever its alerts say.
export function outageNow(id: SystemId, at: string): boolean {
  const t = ms(at);
  return OUTAGES[id].outages.some((o) => ms(o.from) <= t && (!o.to || ms(o.to) > t));
}
