// In-memory store for the things the team can change (alerts, incidents, notification read state,
// console sign-ins). Lives on globalThis so dev hot reloads keep it; a restart resets it.
import type { Alert, Evidence, LoginEvent, Notification } from "@/types/control";
import { seedAlerts } from "@/data/alerts";
import { seedIncidents, type IncidentRecord } from "@/data/incidents";
import { seedNotifications } from "@/data/notifications";
import { at, ist, ms, NOW, YESTERDAY } from "@/data/time";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { cleanEvidence } from "./evidence";

export type ActionKind = "ack" | "resolve" | "reopen" | "note" | "incident_opened" | "incident_resolved" | "incident_note" | "team" | "people" | "settings" | "account";

export interface Action {
  at: string;
  user: string; // who did it
  kind: ActionKind;
  text: string;
  evidence?: Evidence[];
  realAt?: string; // the real time (at follows the demo clock until Phase 2)
}

// Read state is per user: seeded items before noon count as read for everyone.
export type StoredNotification = Omit<Notification, "read"> & { seededRead: boolean; readBy: string[] };

// A console sign-in attempt, kept for the logins report ("sentry" app) and for "last login".
export interface ConsoleLogin {
  id: string; // on a success, the session id (randomUUID)
  user: string;
  name: string | null;
  role: string | null;
  at: string;
  ip: string;
  userAgent: string;
  result: LoginEvent["result"];
  iat?: number; // session issued (success only); bumped when the cookie is re-issued
  endedAt?: string; // signed out or revoked
  lastSeen?: string;
}

interface Store {
  alerts: Alert[];
  incidents: IncidentRecord[];
  nextIncident: number;
  bootedAt: number;
  notificationLog: StoredNotification[];
  nextNotification: number;
  actionLog: Action[];
  loginLog: ConsoleLogin[];
  loginFailures: Map<string, { count: number; since: number; lockedUntil: number }>; // see takeAttempt in session.ts
}

const g = globalThis as typeof globalThis & { __sentryStore?: Partial<Store> };

// Fields are filled one by one so a store created by an older build (kept across a hot reload)
// picks up new ones instead of breaking.
export function store(): Store {
  const s = (g.__sentryStore ??= {});
  if (!s.alerts) s.alerts = seedAlerts().map((a) => ({ ...a, evidence: cleanEvidence(a.evidence) }));
  if (!s.incidents) s.incidents = seedIncidents();
  s.nextIncident ??= Math.max(...s.incidents.map((i) => Number(i.id.slice(4)))) + 1;
  s.bootedAt ??= Date.now();
  if (!s.notificationLog) {
    s.notificationLog = seedNotifications().map(({ read, ...n }) => ({ ...n, seededRead: read, readBy: [] }));
    s.nextNotification = s.notificationLog.length + 1;
  }
  s.nextNotification ??= s.notificationLog.length + 1;
  if (!s.actionLog || !s.loginLog) {
    const saved = loadAudit();
    s.actionLog ??= saved?.actionLog ?? [];
    if (saved?.loginLog) s.loginLog ??= saved.loginLog;
    startAuditSaver();
  }
  // The sign-in before this server started, so "last login" has something to show.
  s.loginLog ??= [
    { id: "login-sentry-0001", user: "vansh", name: "Vansh", role: "Admin", at: at("18:40", YESTERDAY), ip: "10.0.0.12", userAgent: "Chrome 141 on Windows 10", result: "success", endedAt: at("23:05", YESTERDAY) },
  ];
  s.loginFailures ??= new Map();
  return s as Store;
}

// The world is frozen at 16:30; changes made through the UI are stamped a little after it,
// moving forward with the real clock so the order of actions stays right.
export function liveNow(): string {
  return ist(ms(NOW) + (Date.now() - store().bootedAt));
}

export function recordAction(action: Action): void {
  const log = store().actionLog;
  log.push({ ...action, realAt: new Date().toISOString() });
  if (log.length > MAX_ACTIONS) log.splice(0, log.length - MAX_ACTIONS);
  markAuditDirty();
}

// ─── Audit file ─────────────────────────────────────────────────────────────
// The action log (who changed what: team, People, alerts, incidents, settings) and the sign-in log
// are saved to audit.local.json (gitignored) so a restart keeps them. Every change calls
// markAuditDirty(): saved a second later, checked again every 10 s, and written synchronously when
// the process exits. Written atomically (temp file + rename), one write at a time. Failed sign-in
// usernames (often a password typed into the wrong box) are hidden on disk; memory keeps them.

const HIDDEN_USER = "(hidden)"; // same as logins.HIDDEN_USER (logins.ts imports this file)

const MAX_ACTIONS = 20_000;
export const AUDIT_FILE = () => path.join(process.cwd(), "audit.local.json");

interface AuditFile {
  version: 1;
  actionLog: Action[];
  loginLog: ConsoleLogin[];
}

function loadAudit(): AuditFile | null {
  let raw: string;
  try {
    raw = readFileSync(AUDIT_FILE(), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") console.error(`[audit] audit.local.json could not be read (${(e as NodeJS.ErrnoException).code}); starting empty and not saving over it.`);
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") auditState().broken = true;
    return null;
  }
  try {
    const v = JSON.parse(raw) as Partial<AuditFile>;
    if (!Array.isArray(v.actionLog) || !Array.isArray(v.loginLog)) throw new Error("not an audit file");
    return { version: 1, actionLog: v.actionLog, loginLog: v.loginLog };
  } catch {
    // Keep the bad file for a person to look at; never overwrite it with an empty log
    console.error("[audit] audit.local.json is not valid; starting empty and not saving over it. Move the file away to start a new one.");
    auditState().broken = true;
    return null;
  }
}

interface AuditState {
  dirty: boolean;
  writing: Promise<void>;
  soon: ReturnType<typeof setTimeout> | null;
  timer: ReturnType<typeof setInterval> | null;
  broken: boolean;
  exitHook: boolean;
}

function auditState(): AuditState {
  const a = globalThis as typeof globalThis & { __sentryAudit?: AuditState };
  return (a.__sentryAudit ??= { dirty: false, writing: Promise.resolve(), soon: null, timer: null, broken: false, exitHook: false });
}

/** The file's text, or null when there is nothing to save (or it must not be saved over). */
function auditText(): string | null {
  const s = g.__sentryStore;
  if (auditState().broken || !s?.actionLog || !s.loginLog) return null;
  const loginLog = s.loginLog.map((l) => (l.result === "success" ? l : { ...l, user: HIDDEN_USER }));
  const body: AuditFile = { version: 1, actionLog: s.actionLog, loginLog };
  return JSON.stringify(body);
}

/** Writes the audit file if anything changed since the last write. */
export function saveAudit(): Promise<void> {
  const st = auditState();
  st.writing = st.writing.then(async () => {
    if (!st.dirty) return;
    st.dirty = false; // a change during the write marks it again
    const text = auditText();
    if (text === null) return;
    const file = AUDIT_FILE();
    try {
      await writeFile(`${file}.tmp`, text, { mode: 0o600 });
      await rename(`${file}.tmp`, file);
    } catch (e) {
      st.dirty = true;
      console.error(`[audit] saving audit.local.json failed: ${(e as Error).message}`);
    }
  });
  return st.writing;
}

// Last chance on process.exit (Next calls it on Ctrl+C / SIGTERM): a synchronous write.
function saveAuditNow(): void {
  const st = auditState();
  if (!st.dirty) return;
  const text = auditText();
  if (text === null) return;
  const file = AUDIT_FILE();
  try {
    writeFileSync(`${file}.tmp`, text, { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
    st.dirty = false;
  } catch (e) {
    console.error(`[audit] saving audit.local.json on exit failed: ${(e as Error).message}`);
  }
}

/** Call after any change to the action log or the sign-in log (including edits in place). */
export function markAuditDirty(): void {
  auditState().dirty = true;
  saveAuditSoon();
}

function saveAuditSoon(): void {
  const st = auditState();
  if (st.soon) return;
  st.soon = setTimeout(() => {
    st.soon = null;
    void saveAudit();
  }, 1000);
  st.soon.unref?.();
}

function startAuditSaver(): void {
  const st = auditState();
  if (!st.exitHook) {
    st.exitHook = true;
    process.on("exit", saveAuditNow);
  }
  if (st.timer) return;
  st.timer = setInterval(() => void saveAudit(), 10_000);
  st.timer.unref?.();
}

export function addNotification(n: Omit<Notification, "id" | "read">): void {
  const s = store();
  s.notificationLog.unshift({ ...n, evidence: cleanEvidence(n.evidence), id: `ntf-${String(s.nextNotification++).padStart(3, "0")}`, seededRead: false, readBy: [] });
}
