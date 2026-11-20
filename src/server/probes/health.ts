// Health over time. Each probe round (every 30 s) records one sample per system and one for the
// whole stack. Samples are stored run-length encoded in health_spans: while the health stays the
// same the open span is stretched, a change starts a new span. A gap longer than SPAN_GAP_MS
// (Sentry was not running) is left out, so uptime counts only time Sentry actually watched.
import type { Health, Outage } from "@/types/control";
import { db } from "../db";
import { ist, istDate, nowMs } from "../time";

export const SPAN_GAP_MS = 120_000;
const KEEP_DAYS = 35;
const DAY = 86_400_000;

export interface Span {
  id: number;
  target: string;
  health: Health;
  reason: string | null;
  fromMs: number;
  toMs: number;
}

interface Row {
  id: number;
  target: string;
  health: string;
  reason: string | null;
  from_ms: number;
  to_ms: number;
}

const toSpan = (r: Row): Span => ({ id: r.id, target: r.target, health: r.health as Health, reason: r.reason, fromMs: r.from_ms, toMs: r.to_ms });

/** Records one sample: stretches the open span, or starts a new one when the health changed. */
export function recordHealth(target: string, health: Health, reason: string, at = nowMs()): void {
  const last = db().prepare("SELECT id, target, health, reason, from_ms, to_ms FROM health_spans WHERE target = ? ORDER BY to_ms DESC, id DESC LIMIT 1").get(target) as Row | undefined;
  if (last && at < last.to_ms) return; // out of order: ignore
  const touching = !!last && at - last.to_ms <= SPAN_GAP_MS;
  if (last && touching && last.health === health) {
    // Same health: stretch it. The reason of an ongoing problem keeps its latest wording.
    db().prepare("UPDATE health_spans SET to_ms = ?, reason = ? WHERE id = ?").run(at, health === "ok" ? last.reason : reason, last.id);
    return;
  }
  // A change joins the previous span without a gap; after a gap it starts fresh
  db().prepare("INSERT INTO health_spans (target, health, reason, from_ms, to_ms) VALUES (?, ?, ?, ?, ?)").run(target, health, reason, touching ? last!.to_ms : at, at);
}

export function spansBetween(target: string, fromMs: number, toMs: number): Span[] {
  return (
    db()
      .prepare("SELECT id, target, health, reason, from_ms, to_ms FROM health_spans WHERE target = ? AND to_ms >= ? AND from_ms <= ? ORDER BY from_ms, id")
      .all(target, fromMs, toMs) as unknown as Row[]
  ).map(toSpan);
}

/** Percent of watched time in [fromMs, toMs] that was up (ok or warn); null when nothing was watched. */
export function uptimePct(target: string, fromMs: number, toMs: number): number | null {
  let up = 0;
  let down = 0;
  for (const s of spansBetween(target, fromMs, toMs)) {
    const len = Math.max(0, Math.min(s.toMs, toMs) - Math.max(s.fromMs, fromMs));
    if (s.health === "ok" || s.health === "warn") up += len;
    else if (s.health === "down") down += len;
  }
  if (up + down === 0) return null;
  return Math.round((up / (up + down)) * 10_000) / 100;
}

/** The health recorded at moment t, if Sentry was watching then. */
export function healthAt(target: string, t: number): { health: Health; reason: string | null } | null {
  const row = db()
    .prepare("SELECT id, target, health, reason, from_ms, to_ms FROM health_spans WHERE target = ? AND from_ms <= ? ORDER BY from_ms DESC, id DESC LIMIT 1")
    .get(target, t) as Row | undefined;
  if (!row || t - row.to_ms > SPAN_GAP_MS) return null;
  return { health: row.health as Health, reason: row.reason };
}

/** Down stretches in a window, joined when they touch; `to` is null while still down at the end. */
export function outages(target: string, fromMs: number, toMs: number): Outage[] {
  const out: (Outage & { fromMs: number; toMs: number })[] = [];
  const spans = spansBetween(target, fromMs, toMs);
  for (const s of spans) {
    if (s.health !== "down") continue;
    const prev = out.at(-1);
    if (prev && s.fromMs - prev.toMs <= SPAN_GAP_MS) {
      prev.toMs = s.toMs;
      continue;
    }
    out.push({ from: ist(s.fromMs), to: null, reason: s.reason ?? "down", fromMs: s.fromMs, toMs: s.toMs });
  }
  const last = spans.at(-1);
  return out.map((o) => {
    const ongoing = !!last && last.health === "down" && o.toMs === last.toMs && toMs - o.toMs <= SPAN_GAP_MS;
    return { from: o.from, to: ongoing ? null : ist(o.toMs), reason: o.reason };
  });
}

export interface Streak {
  known: boolean; // false: Sentry has no samples for this target in the window
  upSince: string;
  streakSec: number;
  longestStreakSec: number;
  lastOutage: Outage | null;
}

/** The current up streak at t, the longest in the last 30 days, and the last outage. */
export function streakAt(target: string, t: number): Streak {
  const from = t - 30 * DAY;
  const spans = spansBetween(target, from, t);
  if (!spans.length) return { known: false, upSince: ist(t), streakSec: 0, longestStreakSec: 0, lastOutage: null };
  const downs = outages(target, from, t);
  const firstKnown = Math.max(spans[0].fromMs, from);
  const last = downs.at(-1) ?? null;
  if (last && last.to === null) {
    return { known: true, upSince: ist(t), streakSec: 0, longestStreakSec: longest(downs, firstKnown, 0), lastOutage: last };
  }
  const upSinceMs = last ? Date.parse(last.to!) : firstKnown;
  const streakSec = Math.max(0, Math.round((t - upSinceMs) / 1000));
  return { known: true, upSince: ist(upSinceMs), streakSec, longestStreakSec: longest(downs, firstKnown, streakSec), lastOutage: last };
}

function longest(downs: Outage[], firstKnown: number, current: number): number {
  let best = current;
  let prevEnd = firstKnown;
  for (const d of downs) {
    best = Math.max(best, Math.round((Date.parse(d.from) - prevEnd) / 1000));
    if (d.to) prevEnd = Date.parse(d.to);
  }
  return best;
}

/** The earliest sample at or after fromMs (any target), or null. */
export function firstSampleSince(fromMs: number): number | null {
  const row = db().prepare("SELECT min(from_ms) AS t FROM health_spans WHERE to_ms >= ?").get(fromMs) as { t: number | null };
  return row.t === null ? null : Math.max(row.t, fromMs);
}

/** IST days on which Sentry recorded any health sample. */
export function healthDates(): string[] {
  const rows = db().prepare("SELECT from_ms, to_ms FROM health_spans WHERE target = 'stack'").all() as { from_ms: number; to_ms: number }[];
  const dates = new Set<string>();
  for (const r of rows) {
    // Every IST day the span touches (a long healthy stretch covers several days)
    for (let t = r.from_ms; t <= r.to_ms; t += DAY) dates.add(istDate(t));
    dates.add(istDate(r.to_ms));
  }
  return [...dates].sort().reverse();
}

export function pruneHealth(now = nowMs()): void {
  db().prepare("DELETE FROM health_spans WHERE to_ms < ?").run(now - KEEP_DAYS * DAY);
}
