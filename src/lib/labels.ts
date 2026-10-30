// Plain-word labels for the raw values in the contract. The raw value is still
// shown small in mono where a technical reader wants it.
import type {
  AppName,
  Evidence,
  Health,
  IncidentStatus,
  LogLevel,
  LoginEvent,
  NotificationKind,
  Severity,
  SystemGroup,
  SystemId,
  Trace,
  TraceStepState,
} from "@/types/control";

export const SYSTEM_NAMES: Record<SystemId, string> = {
  "samvadia-api": "Samvadia API",
  "samvadia-worker": "Samvadia worker",
  "socia-api": "Socia API",
  "socia-ingest": "Socia ingest",
  "socia-render": "Socia render",
  "socia-publish": "Socia publish",
  "socia-crons": "Socia crons",
  postgres: "Postgres",
  backups: "Nightly backups",
  ftp: "FTP",
  ollama: "Ollama (Qwen)",
  "assignment-desk": "Assignment desk",
  "reporter-portal": "Reporter portal",
  "digital-desk": "Digital desk",
  whatsapp: "WhatsApp",
  outlook: "Outlook",
  octopus: "Octopus",
  x: "X",
};

export const SYSTEM_IDS = Object.keys(SYSTEM_NAMES) as SystemId[];

export const systemName = (id: string) => SYSTEM_NAMES[id as SystemId] ?? id;

export const GROUP_LABELS: Record<SystemGroup, string> = {
  samvadia: "Samvadia (assignment)",
  socia: "Socia (digital)",
  infra: "Database, files and AI",
  frontend: "Desks and portal",
  external: "Outside services",
};
export const GROUP_ORDER: SystemGroup[] = ["samvadia", "socia", "infra", "frontend", "external"];

export const HEALTH_LABELS: Record<Health, string> = {
  ok: "Working",
  warn: "Needs a look",
  down: "Down",
  unknown: "No signal",
};

export const SEVERITY_LABELS: Record<Severity, string> = { critical: "Critical", warning: "Warning", info: "Info" };

export const LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];
export const LEVEL_LABELS: Record<LogLevel, string> = { debug: "Debug", info: "Info", warn: "Warning", error: "Error" };

export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = { open: "Open", monitoring: "Watching", resolved: "Resolved" };

export const STEP_LABELS: Record<TraceStepState, string> = { done: "Done", waiting: "Waiting", failed: "Failed", skipped: "Skipped" };

export const APP_LABELS: Record<AppName, string> = {
  "assignment-desk": "Assignment desk",
  "reporter-portal": "Reporter portal",
  "digital-desk": "Digital desk",
  sentry: "Sentry",
};

export const LOGIN_RESULT_LABELS: Record<LoginEvent["result"], string> = {
  success: "Signed in",
  bad_password: "Wrong password",
  totp_failed: "Wrong 2FA code",
  locked: "Locked out",
  unknown_user: "Unknown user",
};

export const LOGIN_FLAG_LABELS: Record<LoginEvent["flags"][number], string> = {
  new_ip: "New IP",
  off_hours: "Off hours",
  repeated_failures: "Repeated failures",
};

export const SOURCE_LABELS: Record<NonNullable<Trace["source"]>, string> = { portal: "Reporter portal", outlook: "Outlook", whatsapp: "WhatsApp" };

export function traceBanner(t: Pick<Trace, "state" | "stuckAt">): string {
  switch (t.state) {
    case "done":
      return "Done";
    case "on_track":
      return "On track";
    case "stuck":
      return t.stuckAt ? `Stuck at ${t.stuckAt}` : "Stuck";
    case "failed":
      return t.stuckAt ? `Failed at ${t.stuckAt}` : "Failed";
  }
}

// Where an evidence chip goes. Logs have no single-entry route, so a log id opens
// the log view with that row focused if it is in the loaded page.
// Null for a kind this UI does not know (evidence comes from the server and the model)
export function evidenceHref(e: Evidence): string | null {
  const id = encodeURIComponent(e.id);
  switch (e.kind) {
    case "alert":
      return `/alerts?id=${id}`;
    case "log":
      return `/logs?focus=${id}`;
    case "system":
      return `/systems/${id}`;
    case "trace":
      return `/trace/${id}`;
    case "incident":
      return `/reports/incidents/${id}`;
    case "login":
      return `/reports?tab=logins&focus=${id}`;
    default:
      return null;
  }
}

/** The mission STATUS word for each health: the console's one-word verdict. */
export const STATUS_WORDS: Record<Health, string> = { ok: "NOMINAL", warn: "AMBER", down: "RED", unknown: "NO SIGNAL" };

export const NOTIFICATION_KIND_LABELS: Record<NotificationKind, string> = {
  alert_fired: "Alert",
  alert_resolved: "Resolved",
  incident_opened: "Incident",
  incident_resolved: "Incident closed",
  code_change: "Code change",
  login_unusual: "Sign-in",
  backup: "Backup",
  report_ready: "Report",
  team_change: "Team",
};
