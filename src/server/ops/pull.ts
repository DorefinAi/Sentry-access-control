// Pulls GET /owner/ops/summary from each configured backend (every 30 s from monitor.ts).
// The latest answer is cached in memory; every pull, good or failed, is recorded in ops_snapshots
// (kept SNAPSHOT_KEEP_DAYS, for replay and telemetry). A row is written only when the answer
// changed (ignoring generatedAt); an unchanged answer just moves that row's until_ms forward, so
// a row stands for every pull from at_ms to until_ms. The latest summary of each day is kept
// in ops_daily for the daily reports. A backend that cannot be reached keeps its last good summary
// in the cache, but freshSummary() stops returning it after opsStaleSec: screens then say
// "unknown" with the reason, never old numbers as if they were current.
import { SYSTEM_LABEL } from "@/types/people";
import { db, transaction } from "../db";
import { noteRefusal, pausedFor } from "../backoff";
import { ownerConfig, ownerEnvSet, NotConnected } from "../ownerApi";
import { ruleThresholds } from "../thresholds";
import { nowMs, previousDate } from "../time";
import { fetchSummary } from "./client";
import { OPS_SOURCES, type OpsSource, type OpsStuck, type OpsSummary } from "./types";

const SNAPSHOT_KEEP_DAYS = 2;
const DAILY_KEEP_DAYS = 400;
const REPLAY_GAP_MS = 120_000; // a snapshot further than this before a moment does not describe it

export interface OpsState {
  source: OpsSource;
  configured: boolean;
  triedAt: number | null; // last pull attempt
  okAt: number | null; // last good pull
  error: string | null; // why the last pull failed (or why the backend is not connected)
  summary: OpsSummary | null; // the last good answer; check okAt before trusting it
}

const g = globalThis as typeof globalThis & { __sentryOps?: Partial<Record<OpsSource, OpsState>> };
const cache = () => (g.__sentryOps ??= {});

/** For tests: forget the in-memory cache (the database stays). */
export function resetOpsCache(): void {
  g.__sentryOps = {};
}

interface SnapRow {
  at_ms: number;
  until_ms?: number | null;
  ok: number;
  error: string | null;
  body: string | null;
  date: string | null;
}

function parse(body: string | null): OpsSummary | null {
  if (!body) return null;
  try {
    return JSON.parse(body) as OpsSummary;
  } catch {
    return null;
  }
}

/** The state from the database, for a process that just started (nothing pulled yet). */
function loadState(source: OpsSource): OpsState {
  const last = db().prepare("SELECT at_ms, ok, error, body, date FROM ops_snapshots WHERE source = ? ORDER BY at_ms DESC LIMIT 1").get(source) as SnapRow | undefined;
  const good = db().prepare("SELECT at_ms, ok, error, body, date FROM ops_snapshots WHERE source = ? AND ok = 1 ORDER BY at_ms DESC LIMIT 1").get(source) as SnapRow | undefined;
  return {
    source,
    configured: true,
    triedAt: last?.at_ms ?? null,
    okAt: good?.at_ms ?? null,
    error: last && !last.ok ? last.error : null,
    summary: parse(good?.body ?? null),
  };
}

/** What Sentry knows about one backend right now. */
export function opsState(source: OpsSource): OpsState {
  if (!ownerEnvSet(source)) {
    const c = ownerConfig(source);
    return { source, configured: false, triedAt: null, okAt: null, error: c instanceof NotConnected ? c.message : `${SYSTEM_LABEL[source]} is not connected.`, summary: null };
  }
  return (cache()[source] ??= loadState(source));
}

/** The summary only while it is fresh (pulled within opsStaleSec); null otherwise. */
export function freshSummary(source: OpsSource, now = nowMs()): OpsSummary | null {
  const s = opsState(source);
  if (!s.summary || s.okAt === null) return null;
  return now - s.okAt <= ruleThresholds().opsStaleSec * 1000 ? s.summary : null;
}

/** Why the summary of a backend cannot be used right now, or null when it can. */
export function opsProblem(source: OpsSource, now = nowMs()): string | null {
  const s = opsState(source);
  if (!s.configured) return s.error;
  if (freshSummary(source, now)) return null;
  if (s.error) return s.error;
  if (s.okAt === null) return `Sentry has not read ${SYSTEM_LABEL[source]}'s ops status yet.`;
  return `No ops status from ${SYSTEM_LABEL[source]} for ${Math.round((now - s.okAt) / 1000)} s.`;
}

function mergeSlowest(old: string | null, stuck: OpsStuck[]): string {
  let map: Record<string, { minutes: number; stage: string }> = {};
  try {
    map = old ? (JSON.parse(old) as typeof map) : {};
  } catch {
    map = {};
  }
  for (const s of stuck) {
    if (!map[s.slug] || map[s.slug].minutes < s.minutes) map[s.slug] = { minutes: s.minutes, stage: s.stage };
  }
  // Keep the 50 slowest so the row stays small
  const top = Object.entries(map)
    .sort((a, b) => b[1].minutes - a[1].minutes)
    .slice(0, 50);
  return JSON.stringify(Object.fromEntries(top));
}

// mergeStuck: false for a past day's final summary read after midnight: its stuck list is what is
// stuck now (today), not what was stuck that day, so it must not go into that day's "slowest".
function storeDaily(source: OpsSource, summary: OpsSummary, at: number, mergeStuck = true): void {
  if (!summary.date) return;
  const row = db().prepare("SELECT slowest FROM ops_daily WHERE source = ? AND date = ?").get(source, summary.date) as { slowest: string | null } | undefined;
  db()
    .prepare("INSERT INTO ops_daily (source, date, at_ms, body, slowest) VALUES (?, ?, ?, ?, ?) ON CONFLICT (source, date) DO UPDATE SET at_ms = excluded.at_ms, body = excluded.body, slowest = excluded.slowest")
    .run(source, summary.date, at, JSON.stringify(summary), mergeStuck ? mergeSlowest(row?.slowest ?? null, summary.stuck) : (row?.slowest ?? null));
}

/** The answer without generatedAt, to tell whether anything changed since the last pull. */
const sameAs = (summary: OpsSummary | null) => (summary ? JSON.stringify({ ...summary, generatedAt: "" }) : null);

/** Records one pull: extends the last row when nothing changed, else adds a row. */
function recordSnapshot(source: OpsSource, now: number, summary: OpsSummary | null, error: string | null): void {
  const last = db().prepare("SELECT id, ok, error, body FROM ops_snapshots WHERE source = ? ORDER BY at_ms DESC, id DESC LIMIT 1").get(source) as
    | { id: number; ok: number; error: string | null; body: string | null }
    | undefined;
  const unchanged = last && (summary ? last.ok === 1 && sameAs(parse(last.body)) === sameAs(summary) : last.ok === 0 && last.error === error);
  if (unchanged) {
    db().prepare("UPDATE ops_snapshots SET until_ms = ? WHERE id = ?").run(now, last!.id);
    return;
  }
  db()
    .prepare("INSERT INTO ops_snapshots (source, at_ms, until_ms, date, ok, error, body) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(source, now, now, summary?.date || null, summary ? 1 : 0, error, summary ? JSON.stringify(summary) : null);
}

/** One pull from one backend. Never throws: a failure is stored and kept in the state. */
export async function pullOps(source: OpsSource, fetchImpl?: typeof fetch, now = nowMs()): Promise<OpsState> {
  const prev = opsState(source);
  if (!prev.configured) return prev;
  // After a refused key or a rate limit, wait before asking again (backoff.ts)
  const pause = pausedFor(source, now);
  if (pause) return failed(source, prev, now, pause.reason);
  try {
    const summary = await fetchSummary(source, { fetchImpl });
    transaction(() => {
      recordSnapshot(source, now, summary, null);
      storeDaily(source, summary, now);
    });
    // The day turned over: read yesterday's final numbers once, so its report is complete
    const before = prev.summary?.date;
    if (before && summary.date && before !== summary.date && before === previousDate(summary.date)) {
      try {
        const last = await fetchSummary(source, { date: before, fetchImpl });
        storeDaily(source, last, now, false);
      } catch (e) {
        console.error(`[ops] ${SYSTEM_LABEL[source]}: could not read the final summary of ${before}: ${(e as Error).message}`);
      }
    }
    const next: OpsState = { source, configured: true, triedAt: now, okAt: now, error: null, summary };
    cache()[source] = next;
    return next;
  } catch (e) {
    const paused = noteRefusal(source, e, now);
    const error = paused ? pausedFor(source, now)!.reason : e instanceof Error ? e.message.slice(0, 300) : "The ops summary could not be read.";
    return failed(source, prev, now, error);
  }
}

/** A failed (or skipped) pull: kept in memory and, if the database lets us, in the snapshots. */
function failed(source: OpsSource, prev: OpsState, now: number, error: string): OpsState {
  try {
    recordSnapshot(source, now, null, error);
  } catch (e) {
    console.error(`[ops] ${SYSTEM_LABEL[source]}: could not store the failed pull: ${(e as Error).message}`);
  }
  const next: OpsState = { ...prev, triedAt: now, error: error.slice(0, 400) };
  cache()[source] = next;
  return next;
}

/** Pulls every configured backend; one failing never stops the others (or the probe round after). */
export async function pullAllOps(fetchImpl?: typeof fetch): Promise<void> {
  const results = await Promise.allSettled(OPS_SOURCES.filter(ownerEnvSet).map((s) => pullOps(s, fetchImpl)));
  for (const r of results) if (r.status === "rejected") console.error(`[ops] pull failed: ${(r.reason as Error)?.message ?? r.reason}`);
}

export function pruneOps(now = nowMs()): void {
  db().prepare("DELETE FROM ops_snapshots WHERE coalesce(until_ms, at_ms) < ?").run(now - SNAPSHOT_KEEP_DAYS * 86_400_000);
  db().prepare("DELETE FROM ops_daily WHERE at_ms < ?").run(now - DAILY_KEEP_DAYS * 86_400_000);
}

// ─── History ────────────────────────────────────────────────────────────────

export interface Snapshot {
  atMs: number;
  summary: OpsSummary | null;
  error: string | null;
}

/** The snapshot that describes moment t: the newest one at or before t, if it is recent enough. */
export function snapshotAt(source: OpsSource, t: number): Snapshot | null {
  const row = db()
    .prepare("SELECT at_ms, until_ms, ok, error, body, date FROM ops_snapshots WHERE source = ? AND at_ms <= ? ORDER BY at_ms DESC, id DESC LIMIT 1")
    .get(source, t) as SnapRow | undefined;
  // The row holds from at_ms to until_ms; past that by more than a gap, Sentry did not know
  if (!row || t - (row.until_ms ?? row.at_ms) > REPLAY_GAP_MS) return null;
  return { atMs: row.at_ms, summary: parse(row.body), error: row.ok ? null : row.error };
}

/** Good snapshots in [fromMs, toMs], oldest first. */
export function snapshotsBetween(source: OpsSource, fromMs: number, toMs: number): { atMs: number; summary: OpsSummary }[] {
  const rows = db().prepare("SELECT at_ms, ok, error, body, date FROM ops_snapshots WHERE source = ? AND ok = 1 AND coalesce(until_ms, at_ms) >= ? AND at_ms <= ? ORDER BY at_ms").all(source, fromMs, toMs) as unknown as SnapRow[];
  return rows.map((r) => ({ atMs: r.at_ms, summary: parse(r.body) })).filter((r): r is { atMs: number; summary: OpsSummary } => r.summary !== null);
}

/** The earliest stored snapshot at or after fromMs (any backend), or null. */
export function firstSnapshotSince(fromMs: number): number | null {
  const row = db().prepare("SELECT min(max(at_ms, ?)) AS t FROM ops_snapshots WHERE coalesce(until_ms, at_ms) >= ?").get(fromMs, fromMs) as { t: number | null };
  return row.t ?? null;
}

/** The final (latest) summary Sentry stored for a day. */
export function dailySummary(source: OpsSource, date: string): OpsSummary | null {
  const row = db().prepare("SELECT body FROM ops_daily WHERE source = ? AND date = ?").get(source, date) as { body: string } | undefined;
  return parse(row?.body ?? null);
}

/** When the stored summary of a day was pulled (epoch ms), or null. */
export function dailyAt(source: OpsSource, date: string): number | null {
  const row = db().prepare("SELECT at_ms FROM ops_daily WHERE source = ? AND date = ?").get(source, date) as { at_ms: number } | undefined;
  return row?.at_ms ?? null;
}

/** The longest-stuck stories seen during a day, slowest first. */
export function dailySlowest(source: OpsSource, date: string): { slug: string; minutes: number; stage: string }[] {
  const row = db().prepare("SELECT slowest FROM ops_daily WHERE source = ? AND date = ?").get(source, date) as { slowest: string | null } | undefined;
  try {
    const map = row?.slowest ? (JSON.parse(row.slowest) as Record<string, { minutes: number; stage: string }>) : {};
    return Object.entries(map)
      .map(([slug, v]) => ({ slug, minutes: v.minutes, stage: v.stage }))
      .sort((a, b) => b.minutes - a.minutes);
  } catch {
    return [];
  }
}

/** Days with a stored summary from any backend. */
export function opsDates(): string[] {
  return (db().prepare("SELECT DISTINCT date FROM ops_daily ORDER BY date DESC").all() as { date: string }[]).map((r) => r.date);
}
