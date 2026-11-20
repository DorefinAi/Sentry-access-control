// The daily report and the build log, from what Sentry stored: each backend's summary for the day
// (ops_daily, or the live pull for today), uptime from the health samples, incidents from the
// database. Only days with stored data have a report.
import type { BuildLogEntry, DailyReport, SystemId } from "@/types/control";
import { SYSTEM_LABEL } from "@/types/people";
import { dayNarrative, missingLine, type DayFacts } from "./ai/summary";
import { listAlerts } from "./alerts";
import { allSystemInfo } from "./catalog";
import { notFound } from "./http";
import { incidentRecords, toSummary } from "./incidents";
import { errorsPerBucket } from "./logs";
import { logsLive } from "./logSync";
import { latestProbes } from "./monitor";
import { dailyAt, dailySlowest, dailySummary, freshSummary, opsDates, opsProblem, opsState } from "./ops/pull";
import { OPS_SOURCES, type OpsSource, type OpsSummary } from "./ops/types";
import { healthDates, uptimePct } from "./probes/health";
import { dayStartMs, hhmm, istDate, nowIso, nowMs, todayIst } from "./time";

const DAY = 86_400_000;

/** Days with stored data (ops summaries, health samples or incidents), newest first, at most 60. */
export function reportDates(): string[] {
  const dates = new Set<string>([...opsDates(), ...healthDates(), ...incidentRecords().map((i) => istDate(i.openedAt))]);
  return [...dates].sort().reverse().slice(0, 60);
}

/**
 * A backend's summary for a day. Today: the fresh pull; when there is none, the last stored one,
 * with its time so it is shown as stale. Past days: the stored final one.
 */
function summaryFor(source: OpsSource, date: string): { summary: OpsSummary | null; staleAt: number | null } {
  if (date === todayIst()) {
    const live = freshSummary(source);
    if (live && live.date === date) return { summary: live, staleAt: null };
    const stored = dailySummary(source, date);
    return { summary: stored, staleAt: stored ? dailyAt(source, date) : null };
  }
  return { summary: dailySummary(source, date), staleAt: null };
}

/** The facts the day's paragraph is written from. */
export function dayFacts(date: string): DayFacts {
  const today = date === todayIst();
  const sam = summaryFor("samvadia", date);
  const soc = summaryFor("socia", date);
  const samvadia = sam.summary;
  const socia = soc.summary;
  const problems: string[] = [];
  for (const [source, s] of [["samvadia", sam], ["socia", soc]] as const) {
    if (s.summary && s.staleAt !== null) {
      problems.push(`${SYSTEM_LABEL[source]} numbers are as of ${hhmm(s.staleAt)} (stale): ${(opsProblem(source) ?? "no fresh answer").replace(/[.\s]+$/, "")}.`);
      continue;
    }
    if (s.summary || !opsState(source).configured) continue;
    problems.push(missingLine(source, today ? opsProblem(source) : `Sentry stored no ${SYSTEM_LABEL[source]} summary for ${date}`));
  }
  return { date, today, samvadia, socia, problems, alerts: today ? listAlerts() : [], incidents: incidentRecords().filter((i) => istDate(i.openedAt) === date) };
}

export function dailyReport(date: string): DailyReport {
  const dates = reportDates();
  if (!dates.includes(date) && date !== todayIst()) {
    throw notFound(dates.length ? `No report for ${date}. Days with data: ${dates.slice(0, 10).join(", ")}.` : `No report for ${date}: Sentry has not stored any data yet.`);
  }
  const facts = dayFacts(date);
  const now = nowIso();
  const start = dayStartMs(date);
  const end = Math.min(start + DAY, nowMs());
  const sam = facts.samvadia;
  const soc = facts.socia;

  const uptime = allSystemInfo()
    .map((s) => ({ system: s.id as SystemId, name: s.name, pct: uptimePct(s.id, start, end) }))
    .filter((u): u is { system: SystemId; name: string; pct: number } => u.pct !== null);

  const failures = new Map<string, number>();
  for (const s of [sam, soc]) for (const f of s?.failures ?? []) failures.set(f.label, (failures.get(f.label) ?? 0) + f.count);

  // Errors per hour: the backends' own counts when they have them, else the stored log lines
  const logErrors = errorsPerBucket(start, start + DAY, 3_600_000);
  const hourly = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    storiesIn: sam?.hourly[hour]?.storiesIn ?? 0,
    errors: sam || soc ? (sam?.hourly[hour]?.errors ?? 0) + (soc?.hourly[hour]?.errors ?? 0) : (logErrors[hour] ?? 0),
  }));

  const slowest = OPS_SOURCES.flatMap((s) => dailySlowest(s, date))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 5)
    .map((s) => ({ slug: s.slug, minutes: s.minutes, stuckAt: s.stage }));

  return {
    date,
    generatedAt: now,
    narrative: dayNarrative(facts, now),
    uptime,
    flow: {
      storiesIn: sam?.flow.storiesIn ?? 0,
      bySource: { portal: sam?.flow.bySource.portal ?? 0, outlook: sam?.flow.bySource.outlook ?? 0, whatsapp: sam?.flow.bySource.whatsapp ?? 0 },
      approved: sam?.flow.approved ?? 0,
      rejected: sam?.flow.rejected ?? 0,
      inFeed: sam?.flow.inFeed ?? 0,
      collected: sam?.flow.collected ?? 0,
      medianMinutesToFeed: sam?.flow.medianMinutesToFeed ?? null,
      xPosts: soc?.flow.posts ?? 0,
      xRecalled: soc?.flow.recalled ?? 0,
    },
    failures: [...failures].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
    incidents: facts.incidents.map(toSummary),
    slowest,
    hourly,
  };
}

/** What Sentry watches right now, and what it cannot see: one entry built from the live state. */
export function buildLog(): BuildLogEntry[] {
  const connected: string[] = [];
  const missing: string[] = [];
  for (const source of OPS_SOURCES) {
    const label = SYSTEM_LABEL[source];
    const st = opsState(source);
    if (!st.configured) missing.push(`${label}: not connected (${st.error})`);
    else if (freshSummary(source)) connected.push(`${label}: ops status every 30 s (pipelines, checks, heartbeats, stuck stories)`);
    else missing.push(`${label} ops status: ${opsProblem(source)}`);
  }
  if (logsLive()) connected.push("Backend log lines every 15 s");
  else missing.push("Backend logs: no backend configured");
  const { at, probes } = latestProbes();
  if (at === null) missing.push("Health probes: the first round has not run yet");
  for (const p of probes) {
    if (p.target.startsWith("ops:") || p.target.startsWith("hb:")) continue;
    if (p.target.startsWith("db-via:")) continue;
    if (p.health === "unknown") missing.push(`${p.label}: ${p.reason}`);
    else connected.push(`${p.label} (now: ${p.reason})`);
  }
  connected.push("Detection rules every 60 s, alerts and incidents stored in sentry.local.db");
  missing.push("Alert delivery outside this console (WhatsApp, email, desktop push)");
  return [{ at: at ? new Date(at).toISOString() : nowIso(), phase: 2, title: "What Sentry watches right now", connected, missing }];
}
