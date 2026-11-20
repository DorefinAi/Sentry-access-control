// The ops status contract (dev-docs/ops-status-contract.md), as Sentry reads it after checking.
import type { QueueStat } from "@/types/control";
import type { PeopleSystem } from "@/types/people";

export type OpsSource = PeopleSystem; // "samvadia" | "socia"
export const OPS_SOURCES: OpsSource[] = ["samvadia", "socia"];

export interface OpsProcess {
  process: string;
  system: string; // the backend's system id ("samvadia-worker"); "" when unknown
  host: string;
  startedAt: string;
  beatAt: string;
}

export interface OpsCheck {
  id: string; // samvadia: db, ftp, outlook, whatsapp, octopus; socia: db, share, worker, data-files
  label: string;
  ok: boolean | null; // null = never checked
  lastOkAt: string | null;
  lastError: string | null;
  detail: string | null;
}

export interface OpsStage {
  id: string;
  count: number;
  waiting: number;
  oldestWaitingAt: string | null;
  failed: number;
  note: string | null;
}

export interface OpsFlow {
  storiesIn: number;
  bySource: { portal: number; outlook: number; whatsapp: number; share: number };
  approved: number;
  rejected: number;
  inFeed: number;
  collected: number;
  medianMinutesToFeed: number | null;
  posts: number;
  recalled: number;
}

export interface OpsHour {
  hour: number;
  storiesIn: number;
  errors: number;
}

export interface OpsStuck {
  slug: string;
  headline: string;
  stage: string;
  since: string;
  minutes: number;
}

export interface OpsSummary {
  generatedAt: string;
  date: string;
  phase: number | null;
  processes: OpsProcess[];
  checks: OpsCheck[];
  stages: OpsStage[];
  flow: OpsFlow;
  hourly: OpsHour[]; // always 24
  stuck: OpsStuck[];
  failures: { label: string; count: number }[];
  queues: QueueStat[];
}

export type StoryState = "on_track" | "stuck" | "failed" | "done";

export interface OpsStoryHit {
  slug: string;
  headline: string;
  receivedAt: string;
  stage: string | null;
  state: StoryState;
}

export interface OpsStoryStep {
  stage: string;
  label: string;
  system: string;
  state: "done" | "waiting" | "failed" | "skipped";
  at: string | null;
  detail: string | null;
}

export interface OpsStory {
  slug: string;
  headline: string;
  reporter: string | null;
  city: string | null;
  source: "portal" | "outlook" | "whatsapp" | "share" | null;
  state: StoryState;
  stuckAt: string | null;
  steps: OpsStoryStep[];
}

export type LoginApp = "assignment-desk" | "reporter-portal" | "digital-desk";
export type LoginResult = "success" | "bad_password" | "totp_failed" | "locked" | "unknown_user";

export interface OpsLoginEvent {
  id: string;
  at: string;
  app: LoginApp;
  user: string;
  name: string | null;
  role: string | null;
  ip: string;
  userAgent: string;
  result: LoginResult;
}

export interface OpsLogins {
  events: OpsLoginEvent[];
  activeSessions: { app: LoginApp; user: string; since: string; lastSeen: string | null; ip: string | null }[];
  totals: { success: number; failed: number } | null; // v1.1; null from an older backend
  truncated: boolean; // v1.1; false from an older backend
}
