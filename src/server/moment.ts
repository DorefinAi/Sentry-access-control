// The inputs for one board: live (the store, frozen world at 16:30) or a replay of an earlier
// moment today, rebuilt from the seed data with everything after that moment taken out.
// Changes made through the API only exist on the live board.
import type { Alert } from "@/types/control";
import { seedAlerts } from "@/data/alerts";
import { seedIncidents, type IncidentRecord } from "@/data/incidents";
import { statsAt, storiesAt, xCapAt, type DayStats, type XCap } from "@/data/stats";
import type { Story } from "@/data/stories";
import { at as atTime, minutesBetween, ms, NOW, TODAY } from "@/data/time";
import { cleanEvidence } from "./evidence";
import { badRequest } from "./http";
import { liveNow, store } from "./store";

export interface Moment {
  at: string; // the cut for data (NOW on the live board)
  asOf: string; // what the board says it shows
  replay: boolean;
  alerts: Alert[];
  incidents: IncidentRecord[];
  stories: Story[];
  stats: DayStats;
  cap: XCap;
}

export function liveMoment(): Moment {
  const { alerts, incidents } = store();
  return { at: NOW, asOf: liveNow(), replay: false, alerts, incidents, stories: storiesAt(NOW), stats: statsAt(NOW), cap: xCapAt(NOW) };
}

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

// ?at=11:45 (today, IST) or a full ISO time. Clamped to today 00:00 .. 16:30.
export function parseReplayAt(value: string): string {
  let t: number;
  if (HHMM_RE.test(value)) t = Date.parse(atTime(value));
  else if (ISO_RE.test(value)) t = Date.parse(value);
  else throw badRequest("at must be a time today like 11:45, or a full ISO time like 2026-10-27T11:45:00+05:30.");
  if (Number.isNaN(t)) throw badRequest("at is not a real time.");
  const start = Date.parse(atTime("00:00", TODAY));
  const clamped = Math.min(Math.max(t, start), ms(NOW));
  return new Date(clamped + 5.5 * 3600_000).toISOString().slice(0, 19) + "+05:30";
}

function alertAt(a: Alert, at: string): Alert | null {
  const t = ms(at);
  if (ms(a.firedAt) > t) return null;
  const resolved = !!a.resolvedAt && ms(a.resolvedAt) <= t;
  const acked = !!a.ackedAt && ms(a.ackedAt) <= t;
  const out: Alert = {
    ...a,
    state: resolved ? "resolved" : acked ? "acked" : "open",
    lastSeenAt: ms(a.lastSeenAt) > t ? at : a.lastSeenAt,
    ackedAt: acked ? a.ackedAt : null,
    resolvedAt: resolved ? a.resolvedAt : null,
    note: resolved || acked ? a.note : null,
    evidence: cleanEvidence(a.evidence),
  };
  // Titles that quote a running number are rewritten for the moment.
  if (a.ruleId === "desk-unmatched") out.title = a.title.replace(/waiting \d+ min/, `waiting ${minutesBetween(a.firedAt, at) + 15} min`);
  if (a.ruleId === "x-cap") out.title = a.title.replace(/\d+% used/, `${xCapAt(at).pct}% used`);
  return out;
}

function incidentAt(i: IncidentRecord, at: string): IncidentRecord | null {
  const t = ms(at);
  if (ms(i.openedAt) > t) return null;
  const resolved = !!i.resolvedAt && ms(i.resolvedAt) <= t;
  const out: IncidentRecord = { ...i, timeline: i.timeline.filter((e) => ms(e.at) <= t) };
  if (!resolved && i.resolvedAt) {
    // Still being worked on at that moment: the cause and fix were written later.
    Object.assign(out, { status: "open", resolvedAt: null, rootCause: "", fix: "", followUps: [] });
  }
  return out;
}

export function momentAt(at: string): Moment {
  return {
    at,
    asOf: at,
    replay: true,
    alerts: seedAlerts().map((a) => alertAt(a, at)).filter((a): a is Alert => !!a),
    incidents: seedIncidents().map((i) => incidentAt(i, at)).filter((i): i is IncidentRecord => !!i),
    stories: storiesAt(at),
    stats: statsAt(at),
    cap: xCapAt(at),
  };
}
