import type { Alert, Health, Pipeline, PipelineStage } from "@/types/control";
import { waitingMinutes } from "@/data/stats";
import { SLUGS } from "@/data/stories";
import { hhmm, ms } from "@/data/time";
import { MAX_UPLOAD_MB, OCTOPUS_GAP } from "@/data/world";
import { octopusLagSec } from "./mission";
import type { Moment } from "./moment";
import { worst } from "./systems";

// Which stage each alert rule colours.
const STAGE_OF_RULE: Record<string, string> = {
  "mail-dead": "intake",
  "desk-unmatched": "desk",
  "ftp-upload-failed": "ftp",
  "octopus-silent": "octopus",
  "render-failed": "render",
  "x-cap": "publish",
};

function stageHealth(stageId: string, alerts: Alert[]): Health {
  return worst(
    alerts
      .filter((a) => a.state !== "resolved" && STAGE_OF_RULE[a.ruleId] === stageId)
      .map((a): Health => (a.severity === "critical" ? "down" : a.severity === "warning" ? "warn" : "ok")),
  );
}

function octopusNote(at: string): string {
  const lag = `last poll ${octopusLagSec(at)} s ago`;
  if (ms(at) < ms(OCTOPUS_GAP.from)) return lag;
  if (ms(at) < ms(OCTOPUS_GAP.resumedAt)) return `no poll since ${hhmm(OCTOPUS_GAP.lastPollBefore)}`;
  return `${lag}; blind ${hhmm(OCTOPUS_GAP.from)} to ${hhmm(OCTOPUS_GAP.resumedAt)} (INC-0007)`;
}

export function buildPipelines(m: Moment): Pipeline[] {
  const { stats: s, cap, alerts } = m;
  const unknown = m.stories.find((st) => st.slug === SLUGS.unknown && st.desk === "waiting");
  const stage = (st: Omit<PipelineStage, "health">): PipelineStage => ({ ...st, health: stageHealth(st.id, alerts) });

  const assignment: PipelineStage[] = [
    stage({
      id: "intake",
      label: "Intake",
      count: s.storiesIn,
      countLabel: "in today",
      systems: ["whatsapp", "outlook", "reporter-portal", "samvadia-api"],
      note: `${s.bySource.whatsapp} WhatsApp, ${s.bySource.outlook} Outlook, ${s.bySource.portal} portal`,
    }),
    stage({
      id: "desk",
      label: "Desk",
      count: s.waitingDesk,
      countLabel: "waiting",
      systems: ["assignment-desk", "samvadia-api"],
      note: unknown ? `${s.waitingDesk} waiting; 1 from an unknown number for ${waitingMinutes(unknown, m.at)} min` : `${s.waitingDesk} waiting`,
    }),
    stage({
      id: "ftp",
      label: "FTP",
      count: s.ftpFailedFiles,
      countLabel: "uploads failed",
      systems: ["ftp", "samvadia-worker"],
      note: `${s.ftpFailedFiles} uploads refused (over ${MAX_UPLOAD_MB} MB); ${s.uploading} ${s.uploading === 1 ? "upload" : "uploads"} running`,
    }),
    stage({
      id: "feed",
      label: "Feed",
      count: s.inFeed,
      countLabel: "in feed today",
      systems: ["samvadia-api"],
      note: `median ${s.medianMinutesToFeed} min from intake to feed`,
    }),
    stage({
      id: "octopus",
      label: "Octopus",
      count: s.collected,
      countLabel: "collected today",
      systems: ["octopus"],
      note: octopusNote(m.at),
    }),
  ];

  const digital: PipelineStage[] = [
    stage({ id: "ingest", label: "Ingest", count: s.ingested, countLabel: "taken in", systems: ["socia-ingest"], note: `${s.skipped} skipped (no visuals)` }),
    stage({ id: "convert", label: "Convert", count: s.drafts, countLabel: "converted", systems: ["socia-api"] }),
    stage({ id: "compose", label: "Compose", count: s.drafts, countLabel: "drafts made", systems: ["socia-api", "ollama"] }),
    stage({
      id: "render",
      label: "Render",
      count: s.renderFailed,
      countLabel: "failed",
      systems: ["socia-render"],
      note: `${s.drafts - s.renderFailed} cards made; ${s.renderFailed} failed on text overflow`,
    }),
    stage({
      id: "operator",
      label: "Operator",
      count: s.waitingOperator,
      countLabel: "waiting",
      systems: ["digital-desk"],
      note: `${s.operatorRejected} rejected by an operator today`,
    }),
    stage({
      id: "publish",
      label: "Publish",
      count: s.xPosts,
      countLabel: "posted on X",
      systems: ["socia-publish", "x"],
      note: `${s.xRecalled} recalled; daily cap ${cap.pct}% used (fake mode)`,
    }),
  ];

  return [
    { id: "assignment", name: "Assignment: intake to Octopus", health: worst(assignment.map((x) => x.health)), stages: assignment },
    { id: "digital", name: "Digital: feed to X", health: worst(digital.map((x) => x.health)), stages: digital },
  ];
}
