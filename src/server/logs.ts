import type { LogEntry, LogLevel, LogPage, LogQuery, SystemId } from "@/types/control";
import { LOGS } from "@/data/logs";
import { badRequest, notFound } from "./http";
import { intParam, isoParam, LOG_LEVELS, systemList } from "./validate";

export interface LogFilter {
  system?: SystemId[];
  level?: LogLevel[];
  q?: string;
  fromMs?: number;
  toMs?: number;
  slug?: string;
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
  const fromMs = isoParam(params.get("from"), "from");
  const toMs = isoParam(params.get("to"), "to", "end");
  if (fromMs !== undefined && toMs !== undefined && fromMs > toMs) throw badRequest("from must be before to.");
  const q = params.get("q")?.trim() || undefined;
  if (q && q.length > 200) throw badRequest("q is too long (max 200 characters).");
  const slug = params.get("slug")?.trim() || undefined;
  const cursor = params.get("cursor") || undefined;
  if (cursor && !/^\d+$/.test(cursor)) throw badRequest("cursor is not valid. Use the nextCursor from the last page.");
  const limit = intParam(params.get("limit"), "limit", 1, 500, 100);
  return {
    system,
    level,
    q,
    from: params.get("from") || undefined,
    to: params.get("to") || undefined,
    fromMs,
    toMs,
    slug,
    cursor,
    limit,
  };
}

// One level means "this level and above"; several mean exactly those.
function levelsFor(level?: LogLevel[]): Set<LogLevel> | null {
  if (!level?.length) return null;
  if (level.length === 1) return new Set(LOG_LEVELS.slice(LOG_LEVELS.indexOf(level[0])));
  return new Set(level);
}

export function filterLogs(f: LogFilter): LogEntry[] {
  const levels = levelsFor(f.level);
  const q = f.q?.toLowerCase();
  return LOGS.filter((l) => {
    if (f.system && !f.system.includes(l.system)) return false;
    if (levels && !levels.has(l.level)) return false;
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

export function queryLogs(query: ReturnType<typeof parseLogQuery>): LogPage {
  const matching = filterLogs(query).reverse(); // newest first
  const offset = query.cursor ? Number(query.cursor) : 0;
  const limit = query.limit ?? 100;
  const entries = matching.slice(offset, offset + limit);
  const next = offset + limit;
  return { entries, nextCursor: next < matching.length ? String(next) : null, total: matching.length };
}

export function getLog(id: string): LogEntry {
  const entry = LOGS.find((l) => l.id === id);
  if (!entry) throw notFound(`No log line with id ${id}.`);
  return entry;
}
