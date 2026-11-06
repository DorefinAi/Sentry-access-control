// Sentry's own database: sentry.local.db (SQLite, gitignored) in the project root, for the log lines
// pulled from the backends (logSync.ts). Uses Node's built-in node:sqlite (Node 22.13+), loaded with
// process.getBuiltinModule so the bundler leaves it alone and no package is needed.
import path from "node:path";

export interface Statement {
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface Database {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
}

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 3000;
PRAGMA synchronous = NORMAL;
CREATE TABLE IF NOT EXISTS logs (
  seq      INTEGER PRIMARY KEY AUTOINCREMENT,
  source   TEXT    NOT NULL,           -- samvadia | socia
  src_id   TEXT    NOT NULL,           -- the backend's ops_log.id
  at_ms    INTEGER NOT NULL,
  at       TEXT    NOT NULL,
  system   TEXT    NOT NULL,
  level    TEXT    NOT NULL,
  logger   TEXT,
  message  TEXT    NOT NULL,
  slug     TEXT,
  item_id  TEXT,
  fields   TEXT,                       -- JSON object or NULL
  UNIQUE (source, src_id)
);
CREATE INDEX IF NOT EXISTS logs_at ON logs (at_ms DESC, seq DESC);
CREATE INDEX IF NOT EXISTS logs_system_at ON logs (system, at_ms DESC);
CREATE TABLE IF NOT EXISTS log_sources (
  source      TEXT PRIMARY KEY,
  cursor      TEXT NOT NULL DEFAULT '0',
  last_try_ms INTEGER,
  last_ok_ms  INTEGER,
  last_error  TEXT,
  dropped     INTEGER NOT NULL DEFAULT 0,
  heartbeats  TEXT,                     -- JSON list from the last answer
  base        TEXT                      -- the backend URL the cursor belongs to (logSync.ts)
);
`;

// Columns added after a file may already exist: added in place when missing.
function upgrade(conn: Database): void {
  const cols = (conn.prepare("PRAGMA table_info(log_sources)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("base")) conn.exec("ALTER TABLE log_sources ADD COLUMN base TEXT");
}

const g = globalThis as typeof globalThis & { __sentryDb?: { file: string; db: Database } };

export const dbFile = () => path.join(process.cwd(), "sentry.local.db");

/** One connection per process and file (tests change the working folder, so the file is part of the key). */
export function db(): Database {
  const file = dbFile();
  if (g.__sentryDb?.file === file) return g.__sentryDb.db;
  g.__sentryDb?.db.close();
  const sqlite = process.getBuiltinModule?.("node:sqlite") as { DatabaseSync: new (file: string) => Database } | undefined;
  if (!sqlite) throw new Error("node:sqlite is not available: run the console on Node 22.13 or newer.");
  const conn = new sqlite.DatabaseSync(file);
  conn.exec(SCHEMA);
  upgrade(conn);
  g.__sentryDb = { file, db: conn };
  return conn;
}

/** Runs fn inside one transaction; rolls back if it throws. */
export function transaction<T>(fn: (d: Database) => T): T {
  const d = db();
  d.exec("BEGIN IMMEDIATE");
  try {
    const out = fn(d);
    d.exec("COMMIT");
    return out;
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}
