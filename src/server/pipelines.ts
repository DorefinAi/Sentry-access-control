// Both pipelines, stage by stage, from the backends' ops summaries (contract section 1.1):
// Samvadia's stages make "assignment", Socia's make "digital". The number on a stage is the
// contract's count; waiting, failed and stuck items go in the note and colour the stage.
// A backend Sentry cannot read gives "unknown" stages with the reason, never numbers.
import type { Alert, Health, Pipeline, PipelineId, PipelineStage, SystemId } from "@/types/control";
import type { Moment } from "./moment";
import type { OpsSource } from "./ops/types";
import { worst } from "./systems";

interface StageSpec {
  id: string;
  label: string;
  countLabel: string;
  systems: SystemId[];
  checks?: string[]; // backend check ids whose failure colours this stage
}

const PIPELINES: { id: PipelineId; source: OpsSource; name: string; stages: StageSpec[] }[] = [
  {
    id: "assignment",
    source: "samvadia",
    name: "Assignment: intake to Octopus",
    stages: [
      { id: "intake", label: "Intake", countLabel: "in today", systems: ["whatsapp", "outlook", "reporter-portal", "samvadia-api"], checks: ["whatsapp", "outlook"] },
      { id: "desk", label: "Desk", countLabel: "decided today", systems: ["assignment-desk", "samvadia-api"] },
      { id: "ftp", label: "FTP", countLabel: "uploaded today", systems: ["ftp", "samvadia-worker"], checks: ["ftp"] },
      { id: "feed", label: "Feed", countLabel: "in feed today", systems: ["samvadia-api"] },
      { id: "octopus", label: "Octopus", countLabel: "collected today", systems: ["octopus"], checks: ["octopus"] },
    ],
  },
  {
    id: "digital",
    source: "socia",
    name: "Digital: breaking news to X",
    stages: [
      { id: "ingest", label: "Ingest", countLabel: "taken in", systems: ["socia-ingest"], checks: ["share"] },
      { id: "convert", label: "Convert", countLabel: "converted", systems: ["socia-ingest"] },
      { id: "compose", label: "Compose", countLabel: "drafts made", systems: ["socia-ingest"] },
      { id: "render", label: "Render", countLabel: "cards made", systems: ["socia-render"] },
      { id: "operator", label: "Operator", countLabel: "acted on", systems: ["digital-desk"] },
      { id: "publish", label: "Publish", countLabel: "posted on X", systems: ["socia-publish", "x"] },
    ],
  },
];

const sevHealth = (a: Alert): Health => (a.severity === "critical" ? "down" : a.severity === "warning" ? "warn" : "ok");

/** Health a stage gets from unresolved alerts about it (stuck stories there, its checks failing). */
function alertHealth(spec: StageSpec, alerts: Alert[]): Health {
  const about = alerts.filter((a) => {
    if (a.state === "resolved") return false;
    if (a.ruleId === "stories-stuck") return a.title.includes(` at ${spec.id} in `) && a.systems.some((s) => spec.systems.includes(s));
    if (a.ruleId === "check-failing") return (spec.checks ?? []).some((c) => a.title.toLowerCase().includes(c));
    if (a.ruleId === "heartbeat-stale" || a.ruleId === "service-down") return a.systems.some((s) => spec.systems.includes(s)) && a.severity === "critical";
    return false;
  });
  return worst(about.map(sevHealth));
}

const minutesSince = (iso: string, now: number) => Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));

export function buildPipelines(m: Moment): Pipeline[] {
  return PIPELINES.map((p) => {
    const view = m.ops[p.source];
    const summary = view.summary;
    const stages: PipelineStage[] = p.stages.map((spec) => {
      if (!summary) {
        return { id: spec.id, label: spec.label, health: "unknown", count: 0, countLabel: "no data", systems: spec.systems, note: view.problem ?? "No data" };
      }
      const st = summary.stages.find((s) => s.id === spec.id);
      if (!st) {
        return { id: spec.id, label: spec.label, health: "unknown", count: 0, countLabel: "not reported", systems: spec.systems, note: "The backend does not report this stage." };
      }
      const stuck = summary.stuck.filter((s) => s.stage === spec.id);
      const notes = [
        st.waiting ? `${st.waiting} waiting${st.oldestWaitingAt ? `, oldest ${minutesSince(st.oldestWaitingAt, m.atMs)} min` : ""}` : null,
        st.failed ? `${st.failed} failed today` : null,
        stuck.length ? `${stuck.length} stuck over the limit` : null,
        st.note,
      ].filter(Boolean);
      const own: Health = stuck.length || st.failed ? "warn" : "ok";
      return {
        id: spec.id,
        label: spec.label,
        health: worst([own, alertHealth(spec, m.alerts)]),
        count: st.count,
        countLabel: spec.countLabel,
        systems: spec.systems,
        note: notes.length ? notes.join("; ") : "Nothing waiting",
      };
    });
    // A stage the backend reports that Sentry has no name for still shows
    for (const st of summary?.stages ?? []) {
      if (p.stages.some((s) => s.id === st.id)) continue;
      stages.push({ id: st.id, label: st.id, health: st.failed ? "warn" : "ok", count: st.count, countLabel: "today", systems: [], note: st.note ?? undefined });
    }
    const known = stages.filter((s) => s.health !== "unknown").map((s) => s.health);
    return { id: p.id, name: p.name, health: known.length ? worst(known) : "unknown", stages };
  });
}
