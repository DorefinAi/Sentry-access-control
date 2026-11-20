import type { Overview } from "@/types/control";
import { dayNarrative, headlineFor, missingLine } from "./ai/summary";
import { latestChange } from "./changes";
import { listFixes } from "./fixes";
import { gauges, stackUptime, streaks, telemetry } from "./mission";
import { liveMoment, momentAt, parseReplayAt, replayFrom, type Moment } from "./moment";
import { buildPipelines } from "./pipelines";
import { systemsFor, worst } from "./systems";
import { istDate, nowIso } from "./time";

export function buildOverview(m: Moment): Overview {
  const now = nowIso();
  const pipelines = buildPipelines(m);
  const systems = systemsFor(m);
  const uptime = stackUptime(m);
  const sam = m.ops.samvadia.summary;
  const soc = m.ops.socia.summary;
  const date = istDate(m.atMs);
  const problems = (["samvadia", "socia"] as const).filter((s) => m.ops[s].configured && !m.ops[s].summary).map((s) => missingLine(s, m.ops[s].problem));
  return {
    generatedAt: now,
    asOf: m.asOf,
    replay: m.replay,
    replayFrom: replayFrom(),
    health: worst([...pipelines.map((p) => p.health), ...systems.map((x) => x.health)]),
    headline: headlineFor(m.alerts),
    aiSummary: dayNarrative({ date, today: true, samvadia: sam, socia: soc, problems, alerts: m.alerts, incidents: m.incidents.filter((i) => istDate(i.openedAt) === date) }, now),
    pipelines,
    counts: {
      storiesIn: sam?.flow.storiesIn ?? 0,
      approved: sam?.flow.approved ?? 0,
      inFeed: sam?.flow.inFeed ?? 0,
      collectedByOctopus: sam?.flow.collected ?? 0,
      xPosts: soc?.flow.posts ?? 0,
      openAlerts: m.alerts.filter((a) => a.state === "open").length,
      openIncidents: m.incidents.filter((i) => i.status !== "resolved").length,
    },
    fixes: listFixes(m).slice(0, 5),
    systems,
    uptime,
    streaks: streaks(m, systems),
    telemetry: telemetry(m),
    gauges: gauges(m, uptime),
    lastChange: latestChange(m.atMs),
  };
}

// No `at` is the live board; `at` replays today up to that moment from stored history.
export function getOverview(at?: string | null): Overview {
  if (at === undefined || at === null || at === "") return buildOverview(liveMoment());
  return buildOverview(momentAt(parseReplayAt(at)));
}

export function liveGauges() {
  const m = liveMoment();
  return gauges(m, stackUptime(m));
}
