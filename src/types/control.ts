// The control centre's contract: every API route returns one of these shapes, and every screen reads them.
// Phase 1 serves typed static data from src/data/. Later phases swap the source inside the route handlers;
// these types stay put. Times are ISO 8601 strings with offset (IST, +05:30).

export type Health = "ok" | "warn" | "down" | "unknown";
export type Severity = "critical" | "warning" | "info";
export type LogLevel = "debug" | "info" | "warn" | "error";

// ─── Systems ────────────────────────────────────────────────────────────────

export type SystemGroup = "samvadia" | "socia" | "infra" | "frontend" | "external";

export type SystemId =
  | "samvadia-api"
  | "samvadia-worker"
  | "socia-api"
  | "socia-ingest"
  | "socia-render"
  | "socia-publish"
  | "socia-crons"
  | "postgres"
  | "backups"
  | "ftp"
  | "ollama"
  | "assignment-desk"
  | "reporter-portal"
  | "digital-desk"
  | "whatsapp"
  | "outlook"
  | "octopus"
  | "x";

export interface Metric {
  label: string; // "Queue depth", "Last poll"
  value: string; // already formatted: "12", "41 s ago", "78%"
  health?: Health; // colours the value when set
}

export interface QueueStat {
  name: string; // "default", "media", "publish"
  pending: number;
  running: number;
  failed: number; // failed for good (attempts used up), last 24 h
  oldestPendingSec: number | null;
}

export interface System {
  id: SystemId;
  name: string; // "Samvadia API"
  group: SystemGroup;
  health: Health;
  summary: string; // one plain line: "Serving; 2 failed jobs in the media queue"
  where: string; // "localhost:8000", "Windows service postgresql-x64-18"
  lastHeartbeat: string | null;
  uptimePct24h: number | null; // 0–100
  version?: string;
  metrics: Metric[];
  queues?: QueueStat[];
  lastError?: { at: string; message: string } | null;
}

export interface SystemDetail extends System {
  recentLogs: LogEntry[]; // newest first, at most 50
  openAlerts: Alert[];
}

// ─── Pipelines ──────────────────────────────────────────────────────────────

export type PipelineId = "assignment" | "digital";

export interface PipelineStage {
  id: string; // "intake", "ftp", "desk", "feed", "octopus" | "ingest", "convert", "compose", "render", "operator", "publish"
  label: string;
  health: Health;
  count: number; // the one number shown on the stage
  countLabel: string; // "waiting", "in feed today", "failed"
  systems: SystemId[]; // which systems back this stage
  note?: string; // shown on hover / tap: "3 items waiting > 15 min"
}

export interface Pipeline {
  id: PipelineId;
  name: string; // "Assignment: intake to Octopus"
  health: Health;
  stages: PipelineStage[];
}

// ─── Status (home) ──────────────────────────────────────────────────────────

export interface Overview {
  generatedAt: string;
  health: Health; // the worst of everything
  headline: string; // "All good" | "2 things need you"
  aiSummary: AiSummary; // "Today in one paragraph"
  pipelines: Pipeline[];
  counts: {
    storiesIn: number;
    approved: number;
    inFeed: number;
    collectedByOctopus: number;
    xPosts: number;
    openAlerts: number;
    openIncidents: number;
  };
  fixes: Fix[]; // top of the ranked list, at most 5
  systems: System[];
  // Mission-control summary (phase 1 redesign)
  asOf: string; // the moment this board describes: generatedAt, or the replay time when ?at= is given
  replay: boolean; // true when ?at= asked for a past moment
  uptime: StackUptime;
  streaks: UptimeStreak[]; // one per system, longest current streak first
  telemetry: TelemetryPoint[]; // today in 10-minute buckets, up to asOf
  gauges: Gauge[]; // the radial readouts on the summary, in display order
  lastChange: CodeChange | null; // the newest code change across all systems
}

// ─── Mission summary ────────────────────────────────────────────────────────

export interface Gauge {
  id: string; // "x-cap", "queue", "uptime", "to-feed", "octopus-lag"
  label: string; // "X cap"
  value: number; // raw value
  max: number; // full scale of the dial
  unit: string; // "%", "min", "jobs", ""
  display: string; // formatted: "82%", "7 min"
  health: Health; // colours the arc
  warnAt?: number; // tick marks on the dial
  dangerAt?: number;
  hint: string; // one plain line under the dial
  direction?: "up" | "down"; // up = higher is worse (default), down = lower is worse (uptime)
  live?: { since: string; ratePerSec: number; cap?: number }; // keep it moving between polls: value at time t = (t - since) * ratePerSec, up to cap; t on the board clock (asOf + elapsed)
}

export interface TelemetryPoint {
  at: string; // bucket start
  storiesIn: number;
  errors: number;
  feedPolls: number; // Octopus polls answered; 0 for a bucket shows the blind spot
}

export interface Outage {
  from: string;
  to: string | null; // null while still down
  reason: string;
  incidentId?: string | null;
}

export interface UptimeStreak {
  system: SystemId;
  name: string;
  health: Health;
  upSince: string; // start of the current streak
  streakSec: number; // up to asOf
  longestStreakSec: number; // best streak in the last 30 days
  uptimePct7d: number;
  lastOutage: Outage | null;
}

export interface StackUptime {
  upSince: string; // the whole stack: since the last time any critical stage was down
  streakSec: number;
  longestStreakSec: number;
  uptimePct24h: number;
  uptimePct7d: number;
  lastOutage: Outage | null;
}

export interface CodeChange {
  id: string;
  system: SystemId | "sentry";
  repo: string; // "backend-Samvadia", "backend-socia", "sentry"
  at: string;
  author: string;
  summary: string; // "Retry FTP uploads on 421"
  ref: string | null; // commit sha when the repo is in git; null for file-time based changes
  files: string[]; // at most 10, repo-relative
  source: "git" | "file-mtime" | "static";
}

// ─── Notifications ──────────────────────────────────────────────────────────

export type NotificationKind =
  | "alert_fired"
  | "alert_resolved"
  | "incident_opened"
  | "incident_resolved"
  | "code_change"
  | "login_unusual"
  | "backup"
  | "report_ready"
  | "team_change"; // a team account or a shared setting (gauge threshold) was changed

export interface Notification {
  id: string;
  at: string;
  kind: NotificationKind;
  severity: Severity;
  title: string;
  body?: string;
  read: boolean;
  evidence: Evidence[];
}

export interface NotificationList {
  unread: number;
  items: Notification[]; // newest first
}

export interface NotificationPatch {
  ids?: string[]; // mark these read
  all?: boolean; // mark everything read
}

// ─── Profile, sign-in and launcher ──────────────────────────────────────────

export interface Profile {
  username: string;
  name: string;
  role: string; // "Owner", "Admin", "Operator", "Viewer"
  roleId?: "owner" | "admin" | "operator" | "viewer"; // what the signed-in user may do; viewer is read only
  initials: string;
  onShiftSince: string; // when this session signed in
  lastLogin: { at: string; ip: string } | null; // the one before this session
  actionsToday: { acked: number; resolved: number; incidentsOpened: number; notes: number };
  recent: { at: string; text: string; evidence?: Evidence[] }[]; // newest first, at most 10
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  profile: Profile;
}

// ─── Team and account settings ──────────────────────────────────────────────

// owner: everything an admin can; only an owner can give or change it (or scripts/add-user.mjs).
export type TeamRole = "owner" | "admin" | "operator" | "viewer";

export interface TeamUser {
  username: string;
  name: string;
  role: TeamRole;
  disabled: boolean;
  createdAt?: string | null;
  lastLoginAt?: string | null;
  activeSessions: number;
}

export interface TeamUserCreate {
  username: string; // 2-40 chars: a-z 0-9 . _ -
  name: string;
  role: TeamRole;
  password: string; // at least 10 characters
}

export interface TeamUserPatch {
  name?: string;
  role?: TeamRole;
  disabled?: boolean;
  password?: string; // resets someone else's (not your own; use /api/me/password); their sessions stop working
}

export type LandingPage = "/" | "/pipelines" | "/alerts" | "/logs";

export interface Preferences {
  theme: "dark" | "light" | "system";
  density: "comfortable" | "compact";
  notify: { kinds: NotificationKind[]; critical: boolean }; // kinds shown in the bell; critical = popup toasts
  defaultLanding: LandingPage;
}

export interface PreferencesPatch {
  theme?: Preferences["theme"];
  density?: Preferences["density"];
  notify?: { kinds?: NotificationKind[]; critical?: boolean };
  defaultLanding?: LandingPage;
}

export interface SessionInfo {
  id: string;
  startedAt: string;
  lastSeen: string;
  ip: string;
  userAgent: string;
  current: boolean;
}

export interface PasswordChange {
  current: string;
  next: string; // at least 10 characters, not the same as current
}

export type LauncherAppId = "sentry" | "assignment-desk" | "reporter-portal" | "digital-desk";

export interface LauncherApp {
  id: LauncherAppId;
  name: string; // "Assignment Desk"
  product: "Samvadia" | "Socia" | "Sentry";
  description: string;
  url: string; // where the tile opens
  health: Health;
  detail: string; // "9 items waiting for the desk"
  signIn: string; // how sign-in works there today: "Desk login (username + password)"
}

// ─── Alerts ─────────────────────────────────────────────────────────────────

export type AlertState = "open" | "acked" | "resolved";

export interface Runbook {
  meaning: string; // what this alert means, in plain words
  checkFirst: string[]; // ordered steps
  fix: string[]; // ordered steps
}

export interface Alert {
  id: string;
  ruleId: string; // "octopus-silent", "job-dead", ...
  title: string; // "Octopus has not polled the feed for 12 min"
  severity: Severity;
  state: AlertState;
  systems: SystemId[];
  firedAt: string;
  lastSeenAt: string;
  ackedAt?: string | null;
  resolvedAt?: string | null;
  note?: string | null; // the latest note
  noteHistory?: { at: string; text: string; by?: string }[]; // every note added through the API, oldest first; by = username
  evidence: Evidence[];
  runbook: Runbook;
  incidentId?: string | null;
}

export interface AlertPatch {
  action: "ack" | "resolve" | "reopen" | "note";
  note?: string;
}

// ─── Logs ───────────────────────────────────────────────────────────────────

export interface LogEntry {
  id: string;
  at: string;
  system: SystemId;
  level: LogLevel;
  logger?: string; // "tasks", "jobs", "ingest"
  message: string;
  slug?: string | null;
  itemId?: string | null;
  fields?: Record<string, string | number | boolean | null>;
}

export interface LogQuery {
  system?: SystemId[];
  level?: LogLevel[]; // this level and above when one is given
  q?: string;
  from?: string;
  to?: string;
  slug?: string;
  cursor?: string;
  limit?: number; // default 100, max 500
  // A preset counted from the server's clock (real time for live logs, the frozen demo time otherwise).
  // Used when from/to are not given.
  range?: LogRange;
}

export type LogRange = "15m" | "1h" | "6h" | "24h" | "today" | "all";

/** One backend Sentry pulls logs from (dev-docs/ops-logs-contract.md). */
export interface LogSourceStatus {
  source: "samvadia" | "socia";
  label: string;
  lastOkAt: string | null; // last successful pull
  lastError: string | null; // set while the last pull failed
  dropped: number; // lines the backend dropped before storing them
  processes: { process: string; system: string; host: string; startedAt: string; beatAt: string }[];
}

export interface LogPage {
  // true: real lines pulled from the backends; false: the Phase 1 demo data (no backend configured)
  live: boolean;
  sources: LogSourceStatus[];
  entries: LogEntry[]; // newest first
  nextCursor: string | null;
  total: number; // matching entries in the window
}

// ─── Trace ──────────────────────────────────────────────────────────────────

export type TraceStepState = "done" | "waiting" | "failed" | "skipped";

export interface TraceStep {
  at: string | null; // null while waiting
  system: SystemId;
  stage: string; // "Received on WhatsApp", "Uploaded to FTP", "Collected by Octopus", "Posted on X"
  state: TraceStepState;
  detail?: string; // "3 files, 48 MB", "GUID vartmaan-..-v1", "post id 18…"
  evidence?: Evidence[];
}

export interface Trace {
  slug: string;
  headline: string;
  reporter: string | null;
  city: string | null;
  source: "portal" | "outlook" | "whatsapp" | null;
  state: "on_track" | "stuck" | "failed" | "done";
  stuckAt?: string | null; // the stage label where it stopped
  steps: TraceStep[]; // oldest first
}

export interface TraceSearchHit {
  slug: string;
  headline: string;
  receivedAt: string;
}

// ─── What to fix ────────────────────────────────────────────────────────────

export interface Fix {
  id: string;
  rank: number; // 1 = do first
  title: string; // "Re-run 2 FTP uploads from Ajmer"
  severity: Severity;
  impact: string; // "2 stories cannot enter the feed"
  why: string; // the AI's plain explanation (static in phase 1)
  steps: string[];
  evidence: Evidence[];
  alertId?: string | null;
}

// ─── Incidents and reports ──────────────────────────────────────────────────

export type IncidentStatus = "open" | "monitoring" | "resolved";

export interface IncidentEvent {
  at: string;
  kind: "alert" | "log" | "note" | "status";
  text: string;
  evidence?: Evidence[];
}

export interface Incident {
  id: string; // "INC-0007"
  title: string;
  severity: Severity;
  status: IncidentStatus;
  openedAt: string;
  resolvedAt?: string | null;
  openedBy: "auto" | "manual";
  systems: SystemId[];
  impact: { storiesDelayed: number; postsMissed: number; minutesBlind: number; summary: string };
  affectedSlugs: string[];
  timeline: IncidentEvent[]; // oldest first
  aiDraft: AiSummary; // first draft of cause and impact
  rootCause: string;
  fix: string;
  followUps: { text: string; done: boolean }[];
  alertIds: string[];
}

export type IncidentSummary = Pick<
  Incident,
  "id" | "title" | "severity" | "status" | "openedAt" | "resolvedAt" | "systems" | "affectedSlugs"
> & { impactSummary: string };

export interface IncidentCreate {
  title: string;
  severity: Severity;
  systems: SystemId[];
  alertIds?: string[];
}

export interface IncidentPatch {
  status?: IncidentStatus;
  rootCause?: string;
  fix?: string;
  followUps?: { text: string; done: boolean }[];
  note?: string; // appended to the timeline
}

export interface DailyReport {
  date: string; // YYYY-MM-DD
  generatedAt: string;
  narrative: AiSummary;
  uptime: { system: SystemId; name: string; pct: number }[];
  flow: {
    storiesIn: number;
    bySource: { portal: number; outlook: number; whatsapp: number };
    approved: number;
    rejected: number;
    inFeed: number;
    collected: number;
    medianMinutesToFeed: number | null;
    xPosts: number;
    xRecalled: number;
  };
  failures: { label: string; count: number }[]; // "FTP upload", "Dead job", "Render failed"
  incidents: IncidentSummary[];
  slowest: { slug: string; minutes: number; stuckAt: string }[];
  hourly: { hour: number; storiesIn: number; errors: number }[]; // 0–23
}

export type AppName = "assignment-desk" | "reporter-portal" | "digital-desk" | "sentry"; // "sentry" = this console's own sign-ins

export interface LoginEvent {
  id: string;
  at: string;
  app: AppName;
  user: string; // username or email
  name: string | null;
  role: string | null;
  ip: string;
  userAgent: string;
  result: "success" | "bad_password" | "totp_failed" | "locked" | "unknown_user";
  flags: ("new_ip" | "off_hours" | "repeated_failures")[];
}

export interface LoginReport {
  date: string;
  totals: { success: number; failed: number; uniqueUsers: number; activeSessions: number };
  byApp: { app: AppName; success: number; failed: number; activeSessions: number }[];
  unusual: LoginEvent[]; // anything with a flag
  activeSessions: { app: AppName; user: string; since: string; lastSeen: string; ip: string }[];
  events: LoginEvent[]; // newest first
}

export interface BuildLogEntry {
  at: string;
  phase: 1 | 2 | 3 | 4 | 5;
  title: string; // "Phase 1: static UI and API"
  connected: string[]; // what is now watched for real
  missing: string[]; // what the control centre still cannot see
}

// ─── AI ─────────────────────────────────────────────────────────────────────

export interface Evidence {
  kind: "alert" | "log" | "system" | "trace" | "incident" | "login";
  id: string; // alert id, log id, system id, slug, incident id, login id
  label: string; // what the link says
}

export interface AiSummary {
  text: string; // every number in it must come from the data it was given
  evidence: Evidence[];
  model: string; // "static" in phase 1, later "qwen3:30b-a3b-instruct-2507-q4_K_M"
  generatedAt: string;
  unverifiedNumbers?: string[]; // numbers in text that are not in the data; shown as a warning
}

export type SummaryScope = "day" | "logs" | "incident";

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

export interface ChatRequest {
  messages: ChatMessage[]; // the whole conversation so far, last one from the user
  context?: { screen?: string; slug?: string; incidentId?: string; alertId?: string };
}

export interface ChatResponse {
  message: ChatMessage;
  evidence: Evidence[];
  suggestions: string[]; // next one-tap questions
  model: string;
  unverifiedNumbers?: string[]; // numbers in the answer that are not in the data it used; shown as a warning
}

export const SUGGESTED_QUESTIONS = [
  "What broke today?",
  "Daily report",
  "Who logged in?",
  "What should I fix first?",
  "Where is slug 271026_JPR_RAIN_AV_POOJA?",
] as const;

// ─── Errors ─────────────────────────────────────────────────────────────────

export interface ApiError {
  error: string; // machine code: "not_found", "bad_request"
  message: string; // plain words
}
