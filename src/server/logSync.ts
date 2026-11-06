// Pulls log lines and heartbeats from each backend's GET /owner/logs (dev-docs/ops-logs-contract.md)
// into sentry.local.db. Runs every 15 s from instrumentation.ts; a backend that is not configured is
// skipped. Every line is checked and redacted again here; a line that does not fit is dropped.
import type { LogLevel, LogSourceStatus, SystemId } from "@/types/control";
import type { PeopleSystem } from "@/types/people";
import { SYSTEM_LABEL } from "@/types/people";
import { db, transaction } from "./db";
import { NotConnected, ownerConfig, ownerEnvSet, ownerFetch } from "./ownerApi";
import { redactFields, redactText } from "./redact";
import { isRecord } from "./validate";

export const LOG_SOURCES: PeopleSystem[] = ["samvadia", "socia"];
const ACTOR = "sentry-sync";
const INTERVAL_MS = 15_000;
const PAGE = 1000;
const MAX_PAGES_PER_PULL = 10; // a backlog catches up over a few ticks instead of one long one
const KEEP_DAYS = 30;
const LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];

const ALLOWED: Record<PeopleSystem, SystemId[]> = {
  samvadia: ["samvadia-api", "samvadia-worker"],
  socia: ["socia-api", "socia-ingest", "socia-render", "socia-publish", "socia-crons"],
};

/** Logs are live once any backend has its URL and key set; until then the demo data stays. */
export function logsLive(): boolean {
  return LOG_SOURCES.some(ownerEnvSet);
}

interface Row {
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

const optText = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.slice(0, max) : null);

/** One backend line → a row, or null when it does not fit the contract. */
export function readEntry(source: PeopleSystem, v: unknown): Row | null {
  if (!isRecord(v)) return null;
  const id = typeof v.id === "number" ? String(v.id) : v.id;
  if (typeof id !== "string" || !/^\d{1,19}$/.test(id)) return null;
  const atMs = typeof v.at === "string" ? Date.parse(v.at) : NaN;
  if (Number.isNaN(atMs)) return null;
  if (typeof v.system !== "string" || !(ALLOWED[source] as string[]).includes(v.system)) return null;
  if (typeof v.level !== "string" || !(LEVELS as string[]).includes(v.level)) return null;
  if (typeof v.message !== "string") return null;
  const fields = redactFields(v.fields);
  return {
    src_id: id,
    at_ms: atMs,
    at: new Date(atMs).toISOString(),
    system: v.system,
    level: v.level,
    logger: optText(v.logger, 80),
    message: redactText(v.message.slice(0, 2000)),
    slug: optText(v.slug, 120),
    item_id: optText(v.itemId, 120),
    fields: fields ? JSON.stringify(fields) : null,
  };
}

function readHeartbeats(source: PeopleSystem, v: unknown): LogSourceStatus["processes"] {
  if (!Array.isArray(v)) return [];
  return v
    .filter(isRecord)
    .filter((h) => typeof h.process === "string" && typeof h.beatAt === "string" && !Number.isNaN(Date.parse(h.beatAt)))
    .slice(0, 50)
    .map((h) => ({
      process: String(h.process).slice(0, 64),
      system: typeof h.system === "string" && (ALLOWED[source] as string[]).includes(h.system) ? h.system : "",
      host: optText(h.host, 120) ?? "",
      startedAt: typeof h.startedAt === "string" && !Number.isNaN(Date.parse(h.startedAt)) ? h.startedAt : h.beatAt as string,
      beatAt: h.beatAt as string,
    }));
}

function sourceRow(source: PeopleSystem) {
  db().prepare("INSERT OR IGNORE INTO log_sources (source) VALUES (?)").run(source);
  return db().prepare("SELECT cursor, last_ok_ms, last_error, dropped, heartbeats, base FROM log_sources WHERE source = ?").get(source) as {
    cursor: string;
    base: string | null;
    last_ok_ms: number | null;
    last_error: string | null;
    dropped: number;
    heartbeats: string | null;
  };
}

/** Forget everything stored from a source: its lines, cursor, drop count and heartbeats. */
function restartSource(source: PeopleSystem, base: string, why: string): void {
  transaction((d) => {
    d.prepare("DELETE FROM logs WHERE source = ?").run(source);
    d.prepare("UPDATE log_sources SET cursor = '0', dropped = 0, heartbeats = NULL, base = ? WHERE source = ?").run(base, source);
  });
  console.error(`[logs] ${SYSTEM_LABEL[source]} ${why}; starting again from its newest lines`);
}

// The cursor is only meaningful for one backend database. Two ways it can stop matching:
// - the URL changed (local → Render): seen by comparing with the stored base;
// - the backend's database was reset at the same URL, so its ids start again below our cursor.
//   The contract has no "max id", so after every PROBE_EVERY-th empty answer we ask for the newest
//   line (after=0&limit=1); if its id is below our cursor, the backend was reset.
const PROBE_EVERY = 10;
const emptyPulls = new Map<PeopleSystem, number>();

async function newestId(source: PeopleSystem, fetchImpl?: typeof fetch): Promise<bigint | null> {
  const body = await ownerFetch(source, "logs?after=0&limit=1", ACTOR, {}, fetchImpl);
  if (!isRecord(body) || !Array.isArray(body.entries)) return null;
  const last = body.entries[body.entries.length - 1];
  const id = isRecord(last) ? (typeof last.id === "number" ? String(last.id) : last.id) : null;
  return typeof id === "string" && /^\d{1,19}$/.test(id) ? BigInt(id) : null;
}

/** Pulls everything new from one backend (up to MAX_PAGES_PER_PULL pages). Returns the lines stored. */
export async function pullSource(source: PeopleSystem, fetchImpl?: typeof fetch): Promise<number> {
  const config = ownerConfig(source);
  if (!(config instanceof NotConnected)) {
    const known = sourceRow(source).base;
    if (known === null) db().prepare("UPDATE log_sources SET base = ? WHERE source = ?").run(config.base, source);
    else if (known !== config.base) {
      restartSource(source, config.base, "URL changed");
      emptyPulls.delete(source);
    }
  }
  let cursor = sourceRow(source).cursor;
  let stored = 0;
  const now = Date.now();
  db().prepare("UPDATE log_sources SET last_try_ms = ? WHERE source = ?").run(now, source);
  try {
    for (let page = 0; page < MAX_PAGES_PER_PULL; page++) {
      const body = await ownerFetch(source, `logs?after=${encodeURIComponent(cursor)}&limit=${PAGE}`, ACTOR, {}, fetchImpl);
      if (!isRecord(body) || !Array.isArray(body.entries)) throw new Error(`${SYSTEM_LABEL[source]} sent logs in a shape Sentry does not understand.`);
      const rows = body.entries.map((e) => readEntry(source, e)).filter((r): r is Row => r !== null);
      const next = typeof body.next === "string" && /^\d{1,19}$/.test(body.next) ? body.next : null;
      transaction((d) => {
        const insert = d.prepare(
          "INSERT OR IGNORE INTO logs (source, src_id, at_ms, at, system, level, logger, message, slug, item_id, fields) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        );
        for (const r of rows) stored += Number(insert.run(source, r.src_id, r.at_ms, r.at, r.system, r.level, r.logger, r.message, r.slug, r.item_id, r.fields).changes);
        d.prepare("UPDATE log_sources SET cursor = ?, last_ok_ms = ?, last_error = NULL, dropped = ?, heartbeats = ? WHERE source = ?").run(
          next ?? cursor,
          Date.now(),
          typeof body.dropped === "number" && body.dropped >= 0 ? Math.floor(body.dropped) : 0,
          JSON.stringify(readHeartbeats(source, body.heartbeats)),
          source
        );
      });
      if (next) cursor = next;
      if (body.entries.length === 0 && !next && cursor !== "0" && !(config instanceof NotConnected)) {
        const n = (emptyPulls.get(source) ?? 0) + 1;
        emptyPulls.set(source, n);
        if (n % PROBE_EVERY === 0) {
          const newest = await newestId(source, fetchImpl);
          if (newest !== null && newest < BigInt(cursor)) {
            restartSource(source, config.base, "database was reset (its newest id is below Sentry's cursor)");
            emptyPulls.delete(source);
          }
        }
      } else if (body.entries.length) emptyPulls.delete(source);
      if (body.entries.length < PAGE || !next) break;
    }
  } catch (e) {
    const message = e instanceof Error ? e.message.slice(0, 300) : "Pull failed.";
    db().prepare("UPDATE log_sources SET last_error = ? WHERE source = ?").run(message, source);
    throw e;
  }
  return stored;
}

/** Drops stored lines older than KEEP_DAYS. */
export function pruneLogs(now = Date.now()): number {
  return Number(db().prepare("DELETE FROM logs WHERE at_ms < ?").run(now - KEEP_DAYS * 86_400_000).changes);
}

const g = globalThis as typeof globalThis & { __sentryLogSync?: { timer: ReturnType<typeof setInterval>; running: Promise<void> | null; lastPrune: number } };

/** One pull of every configured backend; overlapping calls share the run in progress. */
export function syncAll(): Promise<void> {
  const state = (g.__sentryLogSync ??= { timer: undefined as unknown as ReturnType<typeof setInterval>, running: null, lastPrune: 0 });
  if (state.running) return state.running;
  state.running = (async () => {
    for (const source of LOG_SOURCES) {
      if (!ownerEnvSet(source)) continue;
      try {
        await pullSource(source);
      } catch (e) {
        console.error(`[logs] pulling from ${SYSTEM_LABEL[source]} failed: ${e instanceof Error ? e.message : e}`);
      }
    }
    if (Date.now() - state.lastPrune > 3_600_000) {
      state.lastPrune = Date.now();
      pruneLogs();
    }
  })().finally(() => {
    state.running = null;
  });
  return state.running;
}

/** Starts the 15 s pull loop once per process (instrumentation.ts). */
export function startLogSync(): void {
  if (g.__sentryLogSync?.timer) return;
  const state = (g.__sentryLogSync ??= { timer: undefined as unknown as ReturnType<typeof setInterval>, running: null, lastPrune: 0 });
  state.timer = setInterval(() => void syncAll().catch(() => undefined), INTERVAL_MS);
  state.timer.unref?.();
  void syncAll().catch(() => undefined);
}

/** Status of each configured backend, for the Logs page. */
export function sourceStatus(): LogSourceStatus[] {
  return LOG_SOURCES.filter(ownerEnvSet).map((source) => {
    const row = sourceRow(source);
    let processes: LogSourceStatus["processes"] = [];
    try {
      processes = row.heartbeats ? (JSON.parse(row.heartbeats) as LogSourceStatus["processes"]) : [];
    } catch {
      processes = [];
    }
    return {
      source,
      label: SYSTEM_LABEL[source],
      lastOkAt: row.last_ok_ms ? new Date(row.last_ok_ms).toISOString() : null,
      lastError: row.last_error,
      dropped: row.dropped,
      processes,
    };
  });
}
