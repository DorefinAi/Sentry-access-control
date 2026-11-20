// The inputs for one board: live (the latest pulls and probes, alerts and incidents from the
// database) or a replay of an earlier moment today, rebuilt only from what Sentry stored: ops
// snapshots, health samples, and alert / incident history cut at that moment. Without stored
// history there is no replay (replayFrom is null) rather than a made-up one.
import type { Alert, SystemId } from "@/types/control";
import { SYSTEM_LABEL } from "@/types/people";
import { alertsAt, listAlerts } from "./alerts";
import { badRequest, conflict } from "./http";
import { incidentRecords, incidentsAt, type IncidentRecord } from "./incidents";
import { latestProbes, noDataReason } from "./monitor";
import { firstSnapshotSince, freshSummary, opsProblem, opsState, snapshotAt } from "./ops/pull";
import { OPS_SOURCES, type OpsSource, type OpsSummary } from "./ops/types";
import { firstSampleSince, healthAt } from "./probes/health";
import { composeSystems, type ProbeResult, type SystemHealth } from "./probes/probes";
import { SYSTEM_IDS } from "./catalog";
import { dayStartMs, hhmm, ist, nowMs, todayIst } from "./time";

export interface OpsView {
  configured: boolean;
  summary: OpsSummary | null; // null when it cannot be used (problem says why)
  problem: string | null;
}

export interface Moment {
  atMs: number;
  at: string; // the moment the data describes
  asOf: string; // what the board says it shows
  replay: boolean;
  alerts: Alert[];
  incidents: IncidentRecord[];
  ops: Record<OpsSource, OpsView>;
  systems: Record<SystemId, SystemHealth>;
  probes: ProbeResult[]; // the live round; empty on a replay (probe details are not stored)
}

export function liveMoment(now = nowMs()): Moment {
  const ops = Object.fromEntries(OPS_SOURCES.map((s) => [s, { configured: opsState(s).configured, summary: freshSummary(s, now), problem: opsProblem(s, now) }])) as Moment["ops"];
  const latest = latestProbes();
  const systems = latest.systems ?? composeSystems([], (id) => (opsProblem("samvadia", now) || opsProblem("socia", now) ? noDataReason(id, now) : "Waiting for the first probe round"));
  return { atMs: now, at: ist(now), asOf: ist(now), replay: false, alerts: listAlerts(), incidents: incidentRecords(), ops, systems, probes: latest.probes };
}

/** The earliest moment today that stored history covers, or null when there is none. */
export function replayFrom(now = nowMs()): string | null {
  const start = dayStartMs(todayIst());
  const firsts = [firstSnapshotSince(start), firstSampleSince(start)].filter((t): t is number => t !== null && t < now);
  return firsts.length ? ist(Math.min(...firsts)) : null;
}

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

// ?at=11:45 (today, IST) or a full ISO time. Clamped to what stored history covers today .. now.
export function parseReplayAt(value: string, now = nowMs()): number {
  let t: number;
  if (HHMM_RE.test(value)) t = Date.parse(`${todayIst()}T${value.length === 5 ? `${value}:00` : value}+05:30`);
  else if (ISO_RE.test(value)) t = Date.parse(value);
  else throw badRequest("at must be a time today like 11:45, or a full ISO time like 2026-11-20T11:45:00+05:30.");
  if (Number.isNaN(t)) throw badRequest("at is not a real time.");
  const from = replayFrom(now);
  if (!from) throw conflict("There is no stored history for today yet, so there is nothing to replay.");
  return Math.min(Math.max(t, Date.parse(from)), now);
}

export function momentAt(t: number): Moment {
  const ops = Object.fromEntries(
    OPS_SOURCES.map((s): [OpsSource, OpsView] => {
      const configured = opsState(s).configured;
      const snap = snapshotAt(s, t);
      if (!snap) return [s, { configured, summary: null, problem: `Sentry has no stored ${SYSTEM_LABEL[s]} status for ${hhmm(t)}.` }];
      if (!snap.summary) return [s, { configured, summary: null, problem: `At ${hhmm(snap.atMs)}: ${snap.error ?? "no answer"}` }];
      return [s, { configured, summary: snap.summary, problem: null }];
    }),
  ) as Moment["ops"];
  const systems = Object.fromEntries(
    SYSTEM_IDS.map((id): [SystemId, SystemHealth] => {
      const h = healthAt(id, t);
      return [id, h ? { health: h.health, reason: h.reason ?? "", parts: [] } : { health: "unknown", reason: "Sentry was not watching at that moment", parts: [] }];
    }),
  ) as Moment["systems"];
  return { atMs: t, at: ist(t), asOf: ist(t), replay: true, alerts: alertsAt(t), incidents: incidentsAt(t), ops, systems, probes: [] };
}
