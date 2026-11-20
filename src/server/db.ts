// Sentry's own database: sentry.local.db (SQLite, gitignored) in the project root: the log lines
// pulled from the backends (logSync.ts), ops snapshots, health history, alerts, incidents and
// notifications. Every table is created with IF NOT EXISTS, so an older file keeps its data. Uses Node's built-in node:sqlite (Node 22.13+), loaded with
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
-- Every /owner/ops/summary pull (ops/pull.ts), kept a few days for replay and telemetry.
CREATE TABLE IF NOT EXISTS ops_snapshots (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  source  TEXT    NOT NULL,            -- samvadia | socia
  at_ms   INTEGER NOT NULL,            -- when Sentry pulled it
  date    TEXT,                        -- the backend's IST day (null when the pull failed)
  ok      INTEGER NOT NULL,            -- 1 = answered, 0 = failed (error says why)
  error   TEXT,
  body    TEXT                         -- the summary as JSON (null when the pull failed)
);
CREATE INDEX IF NOT EXISTS ops_snapshots_src_at ON ops_snapshots (source, at_ms);
-- The latest summary of each day per backend, kept long for the daily reports.
CREATE TABLE IF NOT EXISTS ops_daily (
  source  TEXT    NOT NULL,
  date    TEXT    NOT NULL,
  at_ms   INTEGER NOT NULL,
  body    TEXT    NOT NULL,
  slowest TEXT,                        -- JSON: longest-stuck stories seen that day (slug -> {minutes, stage})
  PRIMARY KEY (source, date)
);
-- Health over time, run-length encoded: one row per unbroken stretch of the same health
-- (probes/health.ts). A gap longer than a few probe intervals (Sentry was off) is not counted.
CREATE TABLE IF NOT EXISTS health_spans (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  target  TEXT    NOT NULL,            -- a system id, or "stack"
  health  TEXT    NOT NULL,            -- ok | warn | down | unknown
  reason  TEXT,
  from_ms INTEGER NOT NULL,
  to_ms   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS health_spans_target ON health_spans (target, to_ms);
CREATE INDEX IF NOT EXISTS health_spans_to ON health_spans (to_ms);
-- Alerts, incidents and notifications (detect/, alerts.ts, incidents.ts, notifications.ts).
-- The full record is JSON in data; the columns are what lookups need.
CREATE TABLE IF NOT EXISTS alerts (
  id         TEXT    PRIMARY KEY,      -- ALR-0001
  seq        INTEGER NOT NULL UNIQUE,
  dedupe_key TEXT    NOT NULL,         -- rule id + target
  state      TEXT    NOT NULL,
  fired_ms   INTEGER NOT NULL,
  data       TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS alerts_key_state ON alerts (dedupe_key, state);
CREATE INDEX IF NOT EXISTS alerts_fired ON alerts (fired_ms DESC);
CREATE TABLE IF NOT EXISTS incidents (
  id         TEXT    PRIMARY KEY,      -- INC-0001
  seq        INTEGER NOT NULL UNIQUE,
  status     TEXT    NOT NULL,
  opened_ms  INTEGER NOT NULL,
  data       TEXT    NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id      TEXT    PRIMARY KEY,         -- ntf-0001
  seq     INTEGER NOT NULL UNIQUE,
  at_ms   INTEGER NOT NULL,
  data    TEXT    NOT NULL             -- the notification plus readBy (usernames)
);
CREATE INDEX IF NOT EXISTS notifications_at ON notifications (at_ms DESC);
-- Addresses each person has signed in from before, so "new_ip" holds across days (logins.ts).
CREATE TABLE IF NOT EXISTS login_ips (
  app      TEXT    NOT NULL,
  user     TEXT    NOT NULL,
  ip       TEXT    NOT NULL,
  first_ms INTEGER NOT NULL,
  PRIMARY KEY (app, user, ip)
);
`;

// Columns added after a file may already exist: added in place when missing.
function upgrade(conn: Database): void {
  const colsOf = (t: string) => (conn.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
  if (!colsOf("log_sources").includes("base")) conn.exec("ALTER TABLE log_sources ADD COLUMN base TEXT");
  // A snapshot row now stands for every pull with the same answer, up to until_ms (ops/pull.ts)
  if (!colsOf("ops_snapshots").includes("until_ms")) {
    conn.exec("ALTER TABLE ops_snapshots ADD COLUMN until_ms INTEGER");
    conn.exec("UPDATE ops_snapshots SET until_ms = at_ms WHERE until_ms IS NULL");
  }
  // "Held" alerts are found by a column, not by scanning their JSON
  if (!colsOf("alerts").includes("hold")) {
    conn.exec("ALTER TABLE alerts ADD COLUMN hold INTEGER NOT NULL DEFAULT 0");
    conn.exec("UPDATE alerts SET hold = 1 WHERE json_extract(data, '$.hold') = 1");
  }
  conn.exec(`
    CREATE INDEX IF NOT EXISTS alerts_state ON alerts (state, hold);
    CREATE INDEX IF NOT EXISTS incidents_status ON incidents (status, opened_ms DESC);
    CREATE INDEX IF NOT EXISTS logs_slug_at ON logs (slug, at_ms) WHERE slug IS NOT NULL;
  `);
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
  // One process upgrades at a time (another Sentry process or a test may open the same file)
  conn.exec("BEGIN IMMEDIATE");
  try {
    upgrade(conn);
    conn.exec("COMMIT");
  } catch (e) {
    conn.exec("ROLLBACK");
    throw e;
  }
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

/** Closes the connection (tests, before deleting their temp folder). */
export function closeDb(): void {
  g.__sentryDb?.db.close();
  g.__sentryDb = undefined;
}
