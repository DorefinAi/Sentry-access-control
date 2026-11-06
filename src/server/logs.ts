// Log lines for the Logs page, the system pages and the summaries.
// Live (a backend is configured): lines pulled into sentry.local.db by logSync.ts, real time.
// Demo (no backend configured): the Phase 1 data in src/data/logs.ts on the frozen clock.
import type { LogEntry, LogLevel, LogPage, LogQuery, LogRange, SystemId } from "@/types/control";
import { LOGS } from "@/data/logs";
import { db } from "./db";
import { badRequest, notFound } from "./http";
import { logsLive, sourceStatus } from "./logSync";
import { liveNow } from "./store";
import { intParam, isoParam, LOG_LEVELS, oneOf, systemList } from "./validate";

export interface LogFilter {
  system?: SystemId[];
  level?: LogLevel[];
  q?: string;
  fromMs?: number;
  toMs?: number;
  slug?: string;
}

const RANGES: LogRange[] = ["15m", "1h", "6h", "24h", "today", "all"];
const IST_OFFSET_MS = 5.5 * 3600e3;

/** "Now" for time presets: the real clock for live logs, the demo clock for demo data. */
const clockMs = () => (logsLive() ? Date.now() : Date.parse(liveNow()));

export function rangeStart(range: LogRange, now: number): number | undefined {
  const back: Partial<Record<LogRange, number>> = { "15m": 15 * 60e3, "1h": 3600e3, "6h": 6 * 3600e3, "24h": 24 * 3600e3 };
  if (range === "all") return undefined;
  if (range === "today") {
    const day = new Date(now + IST_OFFSET_MS).toISOString().slice(0, 10);
    return Date.parse(`${day}T00:00:00+05:30`);
  }
  return now - back[range]!;
}

export function parseLogQuery(params: URLSearchParams): LogQuery & { fromMs?: number; toMs?: number } {
  const system = params.get("system") ? systemList(params.get("system"), "system") : undefined;
  let level: LogLevel[] | undefined;
  const rawLevel = params.get("level");
  if (rawLevel) {
    const levels = rawLevel.split(",").map((l) => l.trim().toLowerCase());
    const bad = levels.filter((l) => !(LOG_LEVELS as string[]).includes(l));
    if (bad.length) throw badRequest(`level must be one of: ${LOG_LEVELS.join(", ")}.`);
    level = levels as LogLevel[];
  }
  let fromMs = isoParam(params.get("from"), "from");
  const toMs = isoParam(params.get("to"), "to", "end");
  const range = params.get("range") ? oneOf(params.get("range"), RANGES, "range") : undefined;
  if (range && fromMs === undefined && toMs === undefined) fromMs = rangeStart(range, clockMs());
  if (fromMs !== undefined && toMs !== undefined && fromMs > toMs) throw badRequest("from must be before to.");
  const q = params.get("q")?.trim() || undefined;
  if (q && q.length > 200) throw badRequest("q is too long (max 200 characters).");
  const slug = params.get("slug")?.trim() || undefined;
  const cursor = params.get("cursor") || undefined;
  if (cursor && !/^\d+(?:_\d+)?$/.test(cursor)) throw badRequest("cursor is not valid. Use the nextCursor from the last page.");
  const limit = intParam(params.get("limit"), "limit", 1, 500, 100);
  return {
    system,
    level,
    q,
    from: params.get("from") || undefined,
    to: params.get("to") || undefined,
    range,
    fromMs,
    toMs,
    slug,
    cursor,
    limit,
  };
}

// One level means "this level and above"; several mean exactly those.
function levelsFor(level?: LogLevel[]): LogLevel[] | null {
  if (!level?.length) return null;
  if (level.length === 1) return LOG_LEVELS.slice(LOG_LEVELS.indexOf(level[0]));
  return level;
}

// ─── Live: sentry.local.db ──────────────────────────────────────────────────

interface DbRow {
  seq: number;
  source: string;
  src_id: string;
  at_ms: number;
  at: string;
  system: string;
  level: string;
  logger: string | null;
  message: string;
  slug: string | null;
  item_id: string | null;
  fields: string | null;
}

const COLUMNS = "seq, source, src_id, at_ms, at, system, level, logger, message, slug, item_id, fields";

function toEntry(r: DbRow): LogEntry {
  let fields: LogEntry["fields"];
  try {
    fields = r.fields ? (JSON.parse(r.fields) as LogEntry["fields"]) : undefined;
  } catch {
    fields = undefined;
  }
  return {
    id: `${r.source}-${r.src_id}`,
    at: r.at,
    system: r.system as SystemId,
    level: r.level as LogLevel,
    logger: r.logger ?? undefined,
    message: r.message,
    slug: r.slug,
    itemId: r.item_id,
    fields,
  };
}

function where(f: LogFilter): { sql: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  if (f.system?.length) {
    parts.push(`system IN (${f.system.map(() => "?").join(", ")})`);
    params.push(...f.system);
  }
  const levels = levelsFor(f.level);
  if (levels) {
    parts.push(`level IN (${levels.map(() => "?").join(", ")})`);
    params.push(...levels);
  }
  if (f.slug) {
    parts.push("slug = ?");
    params.push(f.slug);
  }
  if (f.fromMs !== undefined) {
    parts.push("at_ms >= ?");
    params.push(f.fromMs);
  }
  if (f.toMs !== undefined) {
    parts.push("at_ms <= ?");
    params.push(f.toMs);
  }
  if (f.q) {
    // instr, not LIKE: the text is matched as typed, % and _ included
    parts.push("instr(lower(message || ' ' || coalesce(logger, '') || ' ' || coalesce(slug, '') || ' ' || coalesce(item_id, '') || ' ' || source || '-' || src_id), ?) > 0");
    params.push(f.q.toLowerCase());
  }
  return { sql: parts.length ? `WHERE ${parts.join(" AND ")}` : "", params };
}

function queryLive(query: ReturnType<typeof parseLogQuery>): LogPage {
  const limit = query.limit ?? 100;
  const w = where(query);
  const total = (db().prepare(`SELECT count(*) AS n FROM logs ${w.sql}`).get(...w.params) as { n: number }).n;
  let sql = w.sql;
  const params = [...w.params];
  if (query.cursor) {
    // Newest first by (at_ms, seq): the next page is everything strictly older than the last row shown
    const [atMs, seq] = query.cursor.split("_").map(Number);
    if (seq === undefined) throw badRequest("cursor is not valid. Use the nextCursor from the last page.");
    sql += `${sql ? " AND" : "WHERE"} (at_ms < ? OR (at_ms = ? AND seq < ?))`;
    params.push(atMs, atMs, seq);
  }
  const rows = db().prepare(`SELECT ${COLUMNS} FROM logs ${sql} ORDER BY at_ms DESC, seq DESC LIMIT ?`).all(...params, limit + 1) as DbRow[];
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    live: true,
    sources: sourceStatus(),
    entries: page.map(toEntry),
    nextCursor: rows.length > limit && last ? `${last.at_ms}_${last.seq}` : null,
    total,
  };
}

// ─── Demo: src/data/logs.ts ─────────────────────────────────────────────────

function filterDemo(f: LogFilter): LogEntry[] {
  const levels = levelsFor(f.level);
  const q = f.q?.toLowerCase();
  return LOGS.filter((l) => {
    if (f.system && !f.system.includes(l.system)) return false;
    if (levels && !levels.includes(l.level)) return false;
    if (f.slug && l.slug !== f.slug) return false;
    const t = Date.parse(l.at);
    if (f.fromMs !== undefined && t < f.fromMs) return false;
    if (f.toMs !== undefined && t > f.toMs) return false;
    if (q) {
      const hay = `${l.message} ${l.logger ?? ""} ${l.slug ?? ""} ${l.itemId ?? ""} ${l.id}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

// ─── Shared ─────────────────────────────────────────────────────────────────

/** Counts over every matching line, for summaries. Exact however many lines match. */
export interface LogStats {
  total: number;
  byLevel: Record<LogLevel, number>;
  bySystem: [SystemId, number][]; // most lines first
  // The most common error message; ties go to the one seen first. firstId is its oldest matching line.
  topError: { message: string; count: number; firstId: string } | null;
}

export function logStats(f: LogFilter): LogStats {
  const byLevel: Record<LogLevel, number> = { error: 0, warn: 0, info: 0, debug: 0 };
  if (!logsLive()) {
    const entries = filterDemo(f); // oldest first
    const bySystem = new Map<SystemId, number>();
    const errors = new Map<string, { count: number; firstId: string; order: number }>();
    entries.forEach((e, i) => {
      byLevel[e.level]++;
      bySystem.set(e.system, (bySystem.get(e.system) ?? 0) + 1);
      if (e.level === "error") {
        const m = errors.get(e.message);
        if (m) m.count++;
        else errors.set(e.message, { count: 1, firstId: e.id, order: i });
      }
    });
    const top = [...errors.entries()].sort((a, b) => b[1].count - a[1].count || a[1].order - b[1].order)[0];
    return {
      total: entries.length,
      byLevel,
      bySystem: [...bySystem.entries()].sort((a, b) => b[1] - a[1]),
      topError: top ? { message: top[0], count: top[1].count, firstId: top[1].firstId } : null,
    };
  }
  const w = where(f);
  const d = db();
  for (const r of d.prepare(`SELECT level, count(*) AS n FROM logs ${w.sql} GROUP BY level`).all(...w.params) as { level: string; n: number }[]) {
    if (r.level in byLevel) byLevel[r.level as LogLevel] = Number(r.n);
  }
  const total = (d.prepare(`SELECT count(*) AS n FROM logs ${w.sql}`).get(...w.params) as { n: number }).n;
  const bySystem = (d.prepare(`SELECT system, count(*) AS n FROM logs ${w.sql} GROUP BY system ORDER BY n DESC, system`).all(...w.params) as { system: string; n: number }[]).map(
    (r): [SystemId, number] => [r.system as SystemId, Number(r.n)]
  );
  // Errors only, whatever level filter is set (if the filter excludes errors, there are none)
  const errSql = `${w.sql}${w.sql ? " AND" : "WHERE"} level = 'error'`;
  const top = d
    .prepare(`SELECT message, count(*) AS n FROM logs ${errSql} GROUP BY message ORDER BY n DESC, min(at_ms) ASC, min(seq) ASC LIMIT 1`)
    .get(...w.params) as { message: string; n: number } | undefined;
  let topError: LogStats["topError"] = null;
  if (top) {
    const first = d
      .prepare(`SELECT source, src_id FROM logs ${errSql} AND message = ? ORDER BY at_ms ASC, seq ASC LIMIT 1`)
      .get(...w.params, top.message) as { source: string; src_id: string };
    topError = { message: top.message, count: Number(top.n), firstId: `${first.source}-${first.src_id}` };
  }
  return { total: Number(total), byLevel, bySystem, topError };
}

export function queryLogs(query: ReturnType<typeof parseLogQuery>): LogPage {
  if (logsLive()) return queryLive(query);
  if (query.cursor && !/^\d+$/.test(query.cursor)) throw badRequest("cursor is not valid. Use the nextCursor from the last page.");
  const matching = filterDemo(query).reverse(); // newest first
  const offset = query.cursor ? Number(query.cursor) : 0;
  const limit = query.limit ?? 100;
  const entries = matching.slice(offset, offset + limit);
  const next = offset + limit;
  return { live: false, sources: [], entries, nextCursor: next < matching.length ? String(next) : null, total: matching.length };
}

/** The newest `limit` lines of one system, newest first. */
export function recentLogs(system: SystemId, limit = 50): LogEntry[] {
  if (!logsLive()) return LOGS.filter((l) => l.system === system).slice(-limit).reverse();
  const rows = db().prepare(`SELECT ${COLUMNS} FROM logs WHERE system = ? ORDER BY at_ms DESC, seq DESC LIMIT ?`).all(system, limit) as DbRow[];
  return rows.map(toEntry);
}

export function getLog(id: string): LogEntry {
  if (logsLive()) {
    const m = /^(samvadia|socia)-(\d{1,19})$/.exec(id);
    const row = m ? (db().prepare(`SELECT ${COLUMNS} FROM logs WHERE source = ? AND src_id = ?`).get(m[1], m[2]) as DbRow | undefined) : undefined;
    if (!row) throw notFound(`No log line with id ${id}.`);
    return toEntry(row);
  }
  const entry = LOGS.find((l) => l.id === id);
  if (!entry) throw notFound(`No log line with id ${id}.`);
  return entry;
}
