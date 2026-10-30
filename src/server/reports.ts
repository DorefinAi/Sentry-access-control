import type { BuildLogEntry, DailyReport } from "@/types/control";
import { BUILD_LOG } from "@/data/buildLog";
import { YESTERDAY_FAILURES, YESTERDAY_FLOW, YESTERDAY_HOURLY_IN, YESTERDAY_UPTIME } from "@/data/daily";
import { LOGS } from "@/data/logs";
import { dayStats, storiesOn } from "@/data/stats";
import type { Story } from "@/data/stories";
import { SYSTEM_BY_ID, SYSTEMS } from "@/data/systems";
import { dateOf, minutesBetween, NOW, TODAY, YESTERDAY } from "@/data/time";
import { OCTOPUS_GAP } from "@/data/world";
import { dayNarrative } from "./ai/summary";
import { notFound } from "./http";
import { toSummary } from "./incidents";
import { liveMoment } from "./moment";
import { liveNow, store } from "./store";

export const REPORT_DATES = [TODAY, YESTERDAY];

function errorsByHour(date: string): number[] {
  const hours = Array<number>(24).fill(0);
  for (const l of LOGS) {
    if (l.level === "error" && dateOf(l.at) === date) hours[Number(l.at.slice(11, 13))]++;
  }
  return hours;
}

function stuckAt(s: Story): string {
  if (s.feedAt) return "Added to feed";
  if (s.desk === "waiting") return "Desk review";
  return "Uploaded to FTP";
}

export function dailyReport(date: string): DailyReport {
  if (!REPORT_DATES.includes(date)) {
    throw notFound(`No report for ${date}. Reports exist for ${REPORT_DATES.join(" and ")}.`);
  }
  const { incidents } = store();
  const now = liveNow();
  const narrative = dayNarrative(date, liveMoment(), now);
  const dayIncidents = incidents.filter((i) => i.openedAt.startsWith(date)).map(toSummary);
  const errors = errorsByHour(date);
  const list = storiesOn(date);

  // Slowest: minutes from intake to feed, or to now for stories not in the feed yet.
  const slowest = list
    .filter((s) => s.desk !== "rejected")
    .map((s) => ({ slug: s.slug, minutes: minutesBetween(s.receivedAt, s.feedAt ?? NOW), stuckAt: stuckAt(s) }))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 5);

  if (date === YESTERDAY) {
    return {
      date,
      generatedAt: now,
      narrative,
      uptime: YESTERDAY_UPTIME.map((u) => ({ ...u, name: SYSTEM_BY_ID.get(u.system)!.name })),
      flow: YESTERDAY_FLOW,
      failures: YESTERDAY_FAILURES,
      incidents: dayIncidents,
      slowest,
      hourly: YESTERDAY_HOURLY_IN.map((n, hour) => ({ hour, storiesIn: n, errors: errors[hour] })),
    };
  }

  const s = dayStats(TODAY);
  const hourlyIn = Array<number>(24).fill(0);
  for (const st of list) hourlyIn[Number(st.receivedAt.slice(11, 13))]++;
  return {
    date,
    generatedAt: now,
    narrative,
    uptime: SYSTEMS.filter((x) => x.uptimePct24h !== null).map((x) => ({ system: x.id, name: x.name, pct: x.uptimePct24h! })),
    flow: {
      storiesIn: s.storiesIn,
      bySource: s.bySource,
      approved: s.approved,
      rejected: s.rejected,
      inFeed: s.inFeed,
      collected: s.collected,
      medianMinutesToFeed: s.medianMinutesToFeed,
      xPosts: s.xPosts,
      xRecalled: s.xRecalled,
    },
    failures: [
      { label: "FTP upload", count: s.ftpFailedFiles },
      { label: "Render failed", count: s.renderFailed },
      { label: "Dead email (mail_dead)", count: 1 },
      { label: "Unmatched WhatsApp sender", count: 1 },
      { label: "Missed Octopus polls", count: OCTOPUS_GAP.minutesBlind },
    ],
    incidents: dayIncidents,
    slowest,
    hourly: hourlyIn.map((n, hour) => ({ hour, storiesIn: n, errors: errors[hour] })),
  };
}

export function buildLog(): BuildLogEntry[] {
  return BUILD_LOG;
}
