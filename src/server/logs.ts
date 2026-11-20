// Log lines for the Logs page, the system pages, the summaries and the detection rules: the lines
// pulled into sentry.local.db by logSync.ts. HTTP request lines ("incoming request" / "request
// completed", most of what Socia writes) are left out unless noise is asked for.
import type { LogEntry, LogErrorGroup, LogLevel, LogPage, LogQuery, LogRange, SystemId } from "@/types/control";
import { db } from "./db";
import { badRequest, notFound } from "./http";
import { logsLive, sourceStatus } from "./logSync";
import { nowMs } from "./time";
import { intParam, isoParam, LOG_LEVELS, oneOf, systemList } from "./validate";

/** Request lines hidden by default (Fastify / pino access logs). */
export const NOISE_MESSAGES = ["incoming request", "request completed"];

export interface LogFilter {
  system?: SystemId[];
  level?: LogLevel[];
  q?: string;
  fromMs?: number;
  toMs?: number;
  slug?: string;
  noise?: boolean; // true: keep the request lines
}

const RANGES: LogRange[] = ["15m", "1h", "6h", "24h", "today", "all"];
const IST_OFFSET_MS = 5.5 * 3600e3;


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
  if (range && fromMs === undefined && toMs === undefined) fromMs = rangeStart(range, nowMs());
  if (fromMs !== undefined && toMs !== undefined && fromMs > toMs) throw badRequest("from must be before to.");
  const q = params.get("q")?.trim() || undefined;
  if (q && q.length > 200) throw badRequest("q is too long (max 200 characters).");
  const slug = params.get("slug")?.trim() || undefined;
  const cursor = params.get("cursor") || undefined;
  if (cursor && !/^\d+(?:_\d+)?$/.test(cursor)) throw badRequest("cursor is not valid. Use the nextCursor from the last page.");
  const limit = intParam(params.get("limit"), "limit", 1, 500, 100);
  const rawNoise = params.get("noise");
  if (rawNoise !== null && !["0", "1", "true", "false"].includes(rawNoise)) throw badRequest("noise must be 1 or 0.");
  return {
    noise: rawNoise === "1" || rawNoise === "true",
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
  if (!f.noise) {
    parts.push(`message NOT IN (${NOISE_MESSAGES.map(() => "?").join(", ")})`);
    params.push(...NOISE_MESSAGES);
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
    live: logsLive(),
    sources: sourceStatus(),
    entries: page.map(toEntry),
    nextCursor: rows.length > limit && last ? `${last.at_ms}_${last.seq}` : null,
    total,
    // Only on the first page: the counts describe the whole window, not one page
    ...(query.cursor ? {} : { ...(query.noise ? {} : { noise: noiseStats(query) }), errorGroups: errorGroups(query) }),
  };
}

/** The request lines this view leaves out, and their average rate over the window. */
function noiseStats(f: LogFilter): { hidden: number; perMinute: number } {
  const w = where({ ...f, noise: true });
  const sql = `${w.sql}${w.sql ? " AND" : "WHERE"} message IN (${NOISE_MESSAGES.map(() => "?").join(", ")})`;
  const row = db().prepare(`SELECT count(*) AS n, min(at_ms) AS first FROM logs ${sql}`).get(...w.params, ...NOISE_MESSAGES) as { n: number; first: number | null };
  const hidden = Number(row.n);
  const to = Math.min(f.toMs ?? nowMs(), nowMs());
  const from = f.fromMs ?? row.first ?? to;
  const minutes = Math.max(1, (to - from) / 60_000);
  return { hidden, perMinute: hidden ? Math.round((hidden / minutes) * 10) / 10 : 0 };
}

/** The most common error messages under the same filters (error level only), most frequent first. */
export function errorGroups(f: LogFilter, limit = 10): LogErrorGroup[] {
  const levels = levelsFor(f.level);
  if (levels && !levels.includes("error")) return [];
  const w = where({ ...f, level: undefined });
  const sql = `${w.sql}${w.sql ? " AND" : "WHERE"} level = 'error'`;
  const rows = db()
    .prepare(`SELECT system, message, count(*) AS n, min(at_ms) AS first_ms, max(at_ms) AS last_ms FROM logs ${sql} GROUP BY system, message ORDER BY n DESC, last_ms DESC LIMIT ?`)
    .all(...w.params, limit) as { system: string; message: string; n: number; first_ms: number; last_ms: number }[];
  const first = db().prepare(`SELECT source, src_id FROM logs ${sql} AND system = ? AND message = ? ORDER BY at_ms ASC, seq ASC LIMIT 1`);
  return rows.map((r) => {
    const f1 = first.get(...w.params, r.system, r.message) as { source: string; src_id: string };
    return {
      message: r.message,
      system: r.system as SystemId,
      count: Number(r.n),
      firstSeen: new Date(r.first_ms).toISOString(),
      lastSeen: new Date(r.last_ms).toISOString(),
      firstId: `${f1.source}-${f1.src_id}`,
    };
  });
}

// ─── For the detection rules, telemetry and traces ──────────────────────────

/** Error lines per system in [fromMs, toMs). */
export function errorCounts(fromMs: number, toMs: number): { system: string; n: number }[] {
  return (db().prepare("SELECT system, count(*) AS n FROM logs WHERE level = 'error' AND at_ms >= ? AND at_ms < ? GROUP BY system").all(fromMs, toMs) as { system: string; n: number }[]).map((r) => ({
    system: r.system,
    n: Number(r.n),
  }));
}

/** Error messages seen at least `min` times in [fromMs, toMs), per system, most frequent first. */
export function repeatedErrors(fromMs: number, toMs: number, min: number, limit?: number): { system: string; key: string; message: string; n: number; firstId: string; lastAt: string }[] {
  // Lines built from a template (contract v1.1: fields.tmpl) group on logger + template, so
  // "job 41 failed" and "job 42 failed" are the same error; other lines group on the message.
  const rows = db()
    .prepare(
      `WITH e AS (
         SELECT system, message, at_ms, seq, source, src_id,
                CASE WHEN json_valid(fields) AND json_type(fields, '$.tmpl') = 'text'
                     THEN 'tmpl:' || coalesce(logger, '') || '|' || json_extract(fields, '$.tmpl')
                     ELSE 'msg:' || message END AS gkey,
                CASE WHEN json_valid(fields) AND json_type(fields, '$.tmpl') = 'text' THEN json_extract(fields, '$.tmpl') ELSE message END AS label
           FROM logs WHERE level = 'error' AND at_ms >= ? AND at_ms < ?)
       SELECT system, gkey, min(label) AS label, count(*) AS n, max(at_ms) AS last_ms,
              (SELECT source || '-' || src_id FROM e AS f WHERE f.system = e.system AND f.gkey = e.gkey ORDER BY at_ms, seq LIMIT 1) AS first_id
         FROM e GROUP BY system, gkey HAVING count(*) >= ? ORDER BY n DESC${limit ? " LIMIT ?" : ""}`,
    )
    .all(fromMs, toMs, min, ...(limit ? [limit] : [])) as { system: string; gkey: string; label: string; n: number; last_ms: number; first_id: string }[];
  return rows.map((r) => ({ system: r.system, key: r.gkey, message: r.label, n: Number(r.n), firstId: r.first_id, lastAt: new Date(r.last_ms).toISOString() }));
}

/** Error lines per bucket of bucketMs, from fromMs up to toMs (telemetry). */
export function errorsPerBucket(fromMs: number, toMs: number, bucketMs: number): number[] {
  const n = Math.max(0, Math.ceil((toMs - fromMs) / bucketMs));
  const out = Array<number>(n).fill(0);
  const rows = db()
    .prepare("SELECT (at_ms - ?) / ? AS b, count(*) AS n FROM logs WHERE level = 'error' AND at_ms >= ? AND at_ms < ? GROUP BY b")
    .all(fromMs, bucketMs, fromMs, toMs) as { b: number; n: number }[];
  for (const r of rows) {
    const b = Math.floor(Number(r.b));
    if (b >= 0 && b < n) out[b] = Number(r.n);
  }
  return out;
}

/** One story's log lines (trace evidence), oldest first. */
export function logsForSlug(slug: string, limit = 200): LogEntry[] {
  const rows = db().prepare(`SELECT ${COLUMNS} FROM logs WHERE slug = ? ORDER BY at_ms ASC, seq ASC LIMIT ?`).all(slug, limit) as unknown as DbRow[];
  return rows.map(toEntry);
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
  return queryLive(query);
}

/** The newest `limit` lines of one system, newest first. */
export function recentLogs(system: SystemId, limit = 50): LogEntry[] {
  const noise = NOISE_MESSAGES.map(() => "?").join(", ");
  const rows = db()
    .prepare(`SELECT ${COLUMNS} FROM logs WHERE system = ? AND message NOT IN (${noise}) ORDER BY at_ms DESC, seq DESC LIMIT ?`)
    .all(system, ...NOISE_MESSAGES, limit) as unknown as DbRow[];
  return rows.map(toEntry);
}

export function getLog(id: string): LogEntry {
  const m = /^(samvadia|socia)-(\d{1,19})$/.exec(id);
  const row = m ? (db().prepare(`SELECT ${COLUMNS} FROM logs WHERE source = ? AND src_id = ?`).get(m[1], m[2]) as DbRow | undefined) : undefined;
  if (!row) throw notFound(`No log line with id ${id}.`);
  return toEntry(row);
}
