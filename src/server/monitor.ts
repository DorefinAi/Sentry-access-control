// The watch loop, started once per process by instrumentation.ts:
// - every 30 s: pull each backend's ops summary (ops/pull.ts), run the health probes
//   (probes/probes.ts) and record one health sample per system and for the stack (probes/health.ts);
// - every 60 s: run the detection rules (detect/engine.ts);
// - every hour: prune old snapshots, health history, and resolved alerts / incidents over 180 days;
//   every 5 min: refresh the git history.
// The latest probe round is kept in memory for the screens.
import type { SystemId } from "@/types/control";
import { pruneAlerts } from "./alerts";
import { pruneIncidents } from "./incidents";
import { refreshChanges } from "./changes";
import { runDetection, type DetectResult } from "./detect/engine";
import type { DetectContext } from "./detect/rules";
import { errorCounts, repeatedErrors } from "./logs";
import { freshSummary, opsProblem, opsState, pruneOps, pullAllOps, snapshotAt } from "./ops/pull";
import { OPS_SOURCES, type OpsSource } from "./ops/types";
import { db } from "./db";
import { pruneHealth, recordHealth } from "./probes/health";
import { backendOf, composeSystems, defaultProbeDeps, runProbes, stackHealth, type ProbeDeps, type ProbeResult, type SystemHealth } from "./probes/probes";
import { ruleThresholds } from "./thresholds";
import { nowMs } from "./time";

const TICK_MS = 30_000;

interface MonitorState {
  timer: ReturnType<typeof setInterval> | null;
  running: Promise<void> | null;
  ticks: number;
  probeAt: number | null;
  probes: ProbeResult[];
  systems: Record<SystemId, SystemHealth> | null;
  lastDetect: DetectResult | null;
  lastPrune: number;
  lastChanges: number;
}

const g = globalThis as typeof globalThis & { __sentryMonitor?: MonitorState };
const state = (): MonitorState =>
  (g.__sentryMonitor ??= { timer: null, running: null, ticks: 0, probeAt: null, probes: [], systems: null, lastDetect: null, lastPrune: 0, lastChanges: 0 });

/** Why a system has no probe data: its backend's problem, or Socia's phase for X. */
export function noDataReason(id: SystemId, now = nowMs()): string {
  if (id === "x") {
    const phase = freshSummary("socia", now)?.phase;
    if (phase === 1) return "Phase 1: posts are marked on X by hand, so there is nothing to watch";
    return "Socia does not report an X check";
  }
  const source = backendOf(id);
  if (source) return opsProblem(source, now) ?? "No check reported for it yet";
  if (id === "postgres") return "Neither backend could be asked about its database";
  return "Not measured yet";
}

/** The latest probe round (null before the first one has run). */
export function latestProbes(): { at: number | null; probes: ProbeResult[]; systems: Record<SystemId, SystemHealth> | null } {
  const s = state();
  return { at: s.probeAt, probes: s.probes, systems: s.systems };
}

/** One probe round: probes → system health → health samples. */
export async function probeRound(deps: ProbeDeps = defaultProbeDeps()): Promise<Record<SystemId, SystemHealth>> {
  const results = await runProbes(deps);
  const systems = composeSystems(results, (id) => noDataReason(id, deps.now));
  for (const [id, h] of Object.entries(systems)) recordHealth(id, h.health, h.reason, deps.now);
  const stack = stackHealth(systems);
  recordHealth("stack", stack.health, stack.reason, deps.now);
  Object.assign(state(), { probeAt: deps.now, probes: results, systems });
  return systems;
}

const LOG_STALE_MS = 45_000; // about 2 log sync intervals (15 s) plus slack

/** Configured backends whose last good log pull is older than LOG_STALE_MS. */
export function staleLogSources(now = nowMs()): Set<OpsSource> {
  const out = new Set<OpsSource>();
  for (const src of OPS_SOURCES) {
    if (!opsState(src).configured) continue;
    const row = db().prepare("SELECT last_ok_ms FROM log_sources WHERE source = ?").get(src) as { last_ok_ms: number | null } | undefined;
    if (!row?.last_ok_ms || now - row.last_ok_ms > LOG_STALE_MS) out.add(src);
  }
  return out;
}

/** The detection rules' view of now. */
export function detectionContext(now = nowMs()): DetectContext {
  const s = state();
  const ops = Object.fromEntries(OPS_SOURCES.map((src) => [src, { configured: opsState(src).configured, summary: freshSummary(src, now), problem: opsProblem(src, now) }])) as DetectContext["ops"];
  return {
    now,
    levels: ruleThresholds(),
    probes: s.probes,
    systems: s.systems ?? composeSystems([], (id) => noDataReason(id, now)),
    ops,
    errorCounts,
    repeatedErrors: (from, to, min) => repeatedErrors(from, to, min), // every group: detection needs them all
    logsStale: staleLogSources(now),
    storiesInAt: (t) => {
      const snap = snapshotAt("samvadia", t);
      return snap?.summary ? snap.summary.flow.storiesIn : null;
    },
  };
}

async function tick(): Promise<void> {
  const s = state();
  s.ticks++;
  await pullAllOps();
  await probeRound();
  // Detection every second round (60 s), once a probe round has given it something to look at
  if (s.ticks % 2 === 1) s.lastDetect = runDetection(detectionContext());
  const now = nowMs();
  if (now - s.lastPrune > 3_600_000) {
    s.lastPrune = now;
    pruneOps(now);
    pruneHealth(now);
    pruneAlerts(now); // resolved alerts and incidents are kept 180 days
    pruneIncidents(now);
  }
  if (now - s.lastChanges > 300_000) {
    s.lastChanges = now;
    void refreshChanges().catch((e) => console.error(`[changes] reading git history failed: ${(e as Error).message}`));
  }
}

/** One full round now; overlapping calls share the round in progress. */
export function monitorOnce(): Promise<void> {
  const s = state();
  if (s.running) return s.running;
  s.running = tick()
    .catch((e) => console.error(`[monitor] round failed: ${e instanceof Error ? e.message : e}`))
    .finally(() => {
      s.running = null;
    });
  return s.running;
}

/** Starts the 30 s loop once per process (instrumentation.ts). */
export function startMonitor(): void {
  const s = state();
  if (s.timer) return;
  s.timer = setInterval(() => void monitorOnce(), TICK_MS);
  s.timer.unref?.();
  void monitorOnce();
}
