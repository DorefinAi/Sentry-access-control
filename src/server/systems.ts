// Every system's card: health from the probes (or the stored samples on a replay), raised to warn
// while an alert on it is unresolved; metrics from the probes and the backends' ops summaries;
// uptime from the stored health samples; the last error from the logs.
import type { Alert, Health, Metric, QueueStat, System, SystemDetail, SystemId } from "@/types/control";
import { allSystemInfo, systemInfo } from "./catalog";
import { db } from "./db";
import { notFound } from "./http";
import { recentLogs } from "./logs";
import { liveMoment, type Moment } from "./moment";
import type { OpsSource } from "./ops/types";
import { uptimePct } from "./probes/health";
import { backendOf, processSystems } from "./probes/probes";
import { isSystemId } from "./validate";

const RANK: Record<Health, number> = { ok: 0, unknown: 1, warn: 2, down: 3 };
const DAY = 86_400_000;

export function worst(list: Health[]): Health {
  return list.reduce<Health>((w, h) => (RANK[h] > RANK[w] ? h : w), "ok");
}

const ago = (iso: string, now: number) => {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  return s < 120 ? `${s} s ago` : s < 7200 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
};

function lastErrorOf(id: SystemId, beforeMs: number): System["lastError"] {
  const row = db().prepare("SELECT at, message FROM logs WHERE system = ? AND level = 'error' AND at_ms <= ? ORDER BY at_ms DESC, seq DESC LIMIT 1").get(id, beforeMs) as { at: string; message: string } | undefined;
  return row ? { at: row.at, message: row.message } : null;
}

const STAGE_METRICS: Partial<Record<SystemId, [OpsSource, string, string][]>> = {
  "samvadia-api": [
    ["samvadia", "intake", "Stories in today"],
    ["samvadia", "desk", "Decided today"],
    ["samvadia", "feed", "In feed today"],
  ],
  "samvadia-worker": [["samvadia", "ftp", "Uploads today"]],
  ftp: [["samvadia", "ftp", "Uploads today"]],
  octopus: [["samvadia", "octopus", "Collected today"]],
  "socia-ingest": [
    ["socia", "ingest", "Taken in today"],
    ["socia", "convert", "Converted today"],
    ["socia", "compose", "Drafts today"],
  ],
  "socia-render": [["socia", "render", "Cards today"]],
  "socia-publish": [["socia", "publish", "Posted today"]],
  "digital-desk": [["socia", "operator", "Acted on today"]],
};

function metricsFor(id: SystemId, m: Moment): { metrics: Metric[]; queues?: QueueStat[]; lastHeartbeat: string | null } {
  const metrics: Metric[] = [];
  for (const [source, stageId, label] of STAGE_METRICS[id] ?? []) {
    const stage = m.ops[source].summary?.stages.find((s) => s.id === stageId);
    if (!stage) continue;
    metrics.push({ label, value: String(stage.count) });
    if (stage.waiting) metrics.push({ label: `Waiting at ${stageId}`, value: String(stage.waiting), health: "warn" });
    if (stage.failed) metrics.push({ label: `Failed at ${stageId} today`, value: String(stage.failed), health: "warn" });
  }
  if (id === "x") {
    const flow = m.ops.socia.summary?.flow;
    if (flow) metrics.push({ label: "Posted today", value: String(flow.posts) }, { label: "Recalled today", value: String(flow.recalled) });
  }
  // What each probe says (live board only; a replay has the stored health, not the probe details)
  for (const p of m.systems[id].parts) metrics.push({ label: p.label, value: p.reason, health: p.health === "unknown" ? undefined : p.health });

  let lastHeartbeat: string | null = null;
  for (const source of ["samvadia", "socia"] as OpsSource[]) {
    for (const p of m.ops[source].summary?.processes ?? []) {
      if (processSystems(source, p.process, p.system).includes(id) && (!lastHeartbeat || Date.parse(p.beatAt) > Date.parse(lastHeartbeat))) lastHeartbeat = p.beatAt;
    }
  }
  if (lastHeartbeat) metrics.unshift({ label: "Last heartbeat", value: ago(lastHeartbeat, m.atMs) });

  let queues: QueueStat[] | undefined;
  if (id === "samvadia-worker") queues = m.ops.samvadia.summary?.queues;
  if (id === "socia-ingest") queues = m.ops.socia.summary?.queues;
  return { metrics: metrics.slice(0, 12), queues: queues?.length ? queues : undefined, lastHeartbeat };
}

// A system that is running but has an unresolved warning or critical alert shows as warn.
function withAlerts(health: Health, id: SystemId, alerts: Alert[]): Health {
  const live = alerts.some((a) => a.state !== "resolved" && a.severity !== "info" && a.systems.includes(id));
  return live && health !== "down" ? worst([health, "warn"]) : health;
}

export function buildSystem(id: SystemId, m: Moment): System {
  const info = systemInfo(id);
  const sh = m.systems[id];
  const { metrics, queues, lastHeartbeat } = metricsFor(id, m);
  const source = backendOf(id);
  return {
    id,
    name: info.name,
    group: info.group,
    health: withAlerts(sh.health, id, m.alerts),
    summary: sh.reason || (source ? (m.ops[source].problem ?? "No data") : "No data"),
    where: info.where,
    lastHeartbeat,
    uptimePct24h: uptimePct(id, m.atMs - DAY, m.atMs),
    metrics,
    ...(queues ? { queues } : {}),
    lastError: lastErrorOf(id, m.atMs),
  };
}

export function systemsFor(m: Moment): System[] {
  return allSystemInfo().map((s) => buildSystem(s.id, m));
}

export function listSystems(): System[] {
  return systemsFor(liveMoment());
}

export function getSystemDetail(id: string): SystemDetail {
  if (!isSystemId(id)) throw notFound(`There is no system called "${id}".`);
  const m = liveMoment();
  return { ...buildSystem(id, m), recentLogs: recentLogs(id, 50), openAlerts: m.alerts.filter((a) => a.state !== "resolved" && a.systems.includes(id)) };
}
