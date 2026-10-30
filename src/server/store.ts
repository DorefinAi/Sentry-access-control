// In-memory store for the things the team can change (alerts, incidents, notification read state,
// console sign-ins). Lives on globalThis so dev hot reloads keep it; a restart resets it.
import type { Alert, Evidence, LoginEvent, Notification } from "@/types/control";
import { seedAlerts } from "@/data/alerts";
import { seedIncidents, type IncidentRecord } from "@/data/incidents";
import { seedNotifications } from "@/data/notifications";
import { at, ist, ms, NOW, YESTERDAY } from "@/data/time";
import { cleanEvidence } from "./evidence";

export type ActionKind = "ack" | "resolve" | "reopen" | "note" | "incident_opened" | "incident_resolved" | "incident_note" | "team" | "people" | "settings" | "account";

export interface Action {
  at: string;
  user: string; // who did it
  kind: ActionKind;
  text: string;
  evidence?: Evidence[];
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
  s.actionLog ??= [];
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
  store().actionLog.push(action);
}

export function addNotification(n: Omit<Notification, "id" | "read">): void {
  const s = store();
  s.notificationLog.unshift({ ...n, evidence: cleanEvidence(n.evidence), id: `ntf-${String(s.nextNotification++).padStart(3, "0")}`, seededRead: false, readBy: [] });
}
