import type { Overview } from "@/types/control";
import { ms, TODAY } from "@/data/time";
import { dayNarrative, headlineFor } from "./ai/summary";
import { latestChange } from "./changes";
import { listFixes } from "./fixes";
import { gauges, stackUptime, streaks, telemetry } from "./mission";
import { liveMoment, momentAt, parseReplayAt, type Moment } from "./moment";
import { buildPipelines } from "./pipelines";
import { liveNow } from "./store";
import { systemsFor, worst } from "./systems";

export function buildOverview(m: Moment): Overview {
  const now = liveNow();
  const pipelines = buildPipelines(m);
  const systems = systemsFor(m.alerts, m.at);
  const uptime = stackUptime(m);
  return {
    generatedAt: now,
    asOf: m.asOf,
    replay: m.replay,
    health: worst([...pipelines.map((p) => p.health), ...systems.map((x) => x.health)]),
    headline: headlineFor(m.alerts),
    aiSummary: dayNarrative(TODAY, m, now),
    pipelines,
    counts: {
      storiesIn: m.stats.storiesIn,
      approved: m.stats.approved,
      inFeed: m.stats.inFeed,
      collectedByOctopus: m.stats.collected,
      xPosts: m.stats.xPosts,
      openAlerts: m.alerts.filter((a) => a.state === "open").length,
      openIncidents: m.incidents.filter((i) => i.status !== "resolved").length,
    },
    fixes: listFixes(m).slice(0, 5),
    systems,
    uptime,
    streaks: streaks(m, systems),
    telemetry: telemetry(m),
    gauges: gauges(m, uptime),
    lastChange: latestChange(ms(m.at)),
  };
}

// No `at` is the live board; `at` replays today up to that moment.
export function getOverview(at?: string | null): Overview {
  if (at === undefined || at === null || at === "") return buildOverview(liveMoment());
  return buildOverview(momentAt(parseReplayAt(at)));
}

export function liveGauges() {
  const m = liveMoment();
  return gauges(m, stackUptime(m));
}
