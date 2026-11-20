// Reads the four ops endpoints of each backend (dev-docs/ops-status-contract.md) through the owner
// API client (same key, actor and error rules as People and logs). Every answer is checked: a
// summary without its required lists is refused (a 502 with a plain reason); single bad items in
// a list are dropped. Free text is redacted again and cut to size.
import type { QueueStat } from "@/types/control";
import { SYSTEM_LABEL } from "@/types/people";
import { HttpError } from "../http";
import { NotConnected, ownerFetch } from "../ownerApi";
import { redactText } from "../redact";
import { isRecord } from "../validate";
import type {
  LoginApp,
  LoginResult,
  OpsCheck,
  OpsFlow,
  OpsHour,
  OpsLoginEvent,
  OpsLogins,
  OpsProcess,
  OpsSource,
  OpsStage,
  OpsStory,
  OpsStoryHit,
  OpsStoryStep,
  OpsStuck,
  OpsSummary,
  StoryState,
} from "./types";

export const OPS_ACTOR = "sentry-sync";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATES: StoryState[] = ["on_track", "stuck", "failed", "done"];
const STEP_STATES: OpsStoryStep["state"][] = ["done", "waiting", "failed", "skipped"];
const APPS: LoginApp[] = ["assignment-desk", "reporter-portal", "digital-desk"];
const RESULTS: LoginResult[] = ["success", "bad_password", "totp_failed", "locked", "unknown_user"];
const SOURCES = ["portal", "outlook", "whatsapp", "share"] as const;

const bad = (source: OpsSource, what: string) => new NotConnected("error", 502, `${SYSTEM_LABEL[source]} sent ${what} in a shape Sentry does not understand.`);

const isTime = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));
const time = (v: unknown): string | null => (isTime(v) ? v : null);
const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
const optNum = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.slice(0, max) : null);
const safe = (v: unknown, max: number): string | null => {
  const s = str(v, max);
  return s === null ? null : redactText(s);
};
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isRecord) : []);

function readProcess(p: Record<string, unknown>): OpsProcess | null {
  if (typeof p.process !== "string" || !isTime(p.beatAt)) return null;
  return {
    process: p.process.slice(0, 120),
    system: str(p.system, 64) ?? "",
    host: str(p.host, 120) ?? "",
    startedAt: time(p.startedAt) ?? p.beatAt,
    beatAt: p.beatAt,
  };
}

function readCheck(c: Record<string, unknown>): OpsCheck | null {
  if (typeof c.id !== "string" || !c.id) return null;
  return {
    id: c.id.slice(0, 40),
    label: str(c.label, 80) ?? c.id,
    ok: typeof c.ok === "boolean" ? c.ok : null,
    lastOkAt: time(c.lastOkAt),
    lastError: safe(c.lastError, 300),
    detail: safe(c.detail, 300),
  };
}

function readStage(s: Record<string, unknown>): OpsStage | null {
  if (typeof s.id !== "string" || !s.id) return null;
  return { id: s.id.slice(0, 40), count: count(s.count), waiting: count(s.waiting), oldestWaitingAt: time(s.oldestWaitingAt), failed: count(s.failed), note: safe(s.note, 200) };
}

function readFlow(f: unknown): OpsFlow {
  const v = isRecord(f) ? f : {};
  const by = isRecord(v.bySource) ? v.bySource : {};
  return {
    storiesIn: count(v.storiesIn),
    bySource: { portal: count(by.portal), outlook: count(by.outlook), whatsapp: count(by.whatsapp), share: count(by.share) },
    approved: count(v.approved),
    rejected: count(v.rejected),
    inFeed: count(v.inFeed),
    collected: count(v.collected),
    medianMinutesToFeed: optNum(v.medianMinutesToFeed),
    posts: count(v.posts),
    recalled: count(v.recalled),
  };
}

function readHourly(v: unknown): OpsHour[] {
  const byHour = new Map<number, OpsHour>();
  for (const h of list(v)) {
    const hour = typeof h.hour === "number" ? Math.floor(h.hour) : -1;
    if (hour >= 0 && hour < 24) byHour.set(hour, { hour, storiesIn: count(h.storiesIn), errors: count(h.errors) });
  }
  return Array.from({ length: 24 }, (_, hour) => byHour.get(hour) ?? { hour, storiesIn: 0, errors: 0 });
}

function readStuck(s: Record<string, unknown>): OpsStuck | null {
  if (typeof s.slug !== "string" || !s.slug || typeof s.stage !== "string" || !isTime(s.since)) return null;
  return { slug: s.slug.slice(0, 120), headline: str(s.headline, 300) ?? "", stage: s.stage.slice(0, 40), since: s.since, minutes: count(s.minutes) };
}

function readQueue(q: Record<string, unknown>): QueueStat | null {
  if (typeof q.name !== "string" || !q.name) return null;
  return { name: q.name.slice(0, 60), pending: count(q.pending), running: count(q.running), failed: count(q.failed), oldestPendingSec: optNum(q.oldestPendingSec) };
}

const keep = <T>(items: Record<string, unknown>[], fn: (x: Record<string, unknown>) => T | null, max: number): T[] =>
  items.map(fn).filter((x): x is T => x !== null).slice(0, max);

/** One summary answer → OpsSummary. Throws a 502 NotConnected when the shape is wrong. */
export function readSummary(source: OpsSource, v: unknown): OpsSummary {
  if (!isRecord(v) || !Array.isArray(v.checks) || !Array.isArray(v.stages) || !Array.isArray(v.processes) || !isRecord(v.flow)) {
    throw bad(source, "an ops summary");
  }
  return {
    generatedAt: time(v.generatedAt) ?? new Date().toISOString(),
    date: typeof v.date === "string" && DATE_RE.test(v.date) ? v.date : "",
    phase: optNum(v.phase),
    processes: keep(list(v.processes), readProcess, 50),
    checks: keep(list(v.checks), readCheck, 30),
    stages: keep(list(v.stages), readStage, 20),
    flow: readFlow(v.flow),
    hourly: readHourly(v.hourly),
    stuck: keep(list(v.stuck), readStuck, 50),
    failures: keep(list(v.failures), (f) => (typeof f.label === "string" && f.label ? { label: f.label.slice(0, 80), count: count(f.count) } : null), 30),
    queues: keep(list(v.queues), readQueue, 20),
  };
}

export async function fetchSummary(source: OpsSource, opts: { date?: string; fetchImpl?: typeof fetch } = {}): Promise<OpsSummary> {
  const q = opts.date ? `?date=${encodeURIComponent(opts.date)}` : "";
  const body = await ownerFetch(source, `ops/summary${q}`, OPS_ACTOR, { what: "GET /owner/ops/summary" }, opts.fetchImpl);
  return readSummary(source, body);
}

const state = (v: unknown): StoryState => (STATES.includes(v as StoryState) ? (v as StoryState) : "on_track");

export async function fetchStories(source: OpsSource, opts: { q?: string; date?: string; limit?: number; fetchImpl?: typeof fetch } = {}): Promise<OpsStoryHit[]> {
  const p = new URLSearchParams();
  if (opts.q) p.set("q", opts.q);
  if (opts.date) p.set("date", opts.date);
  p.set("limit", String(Math.min(50, Math.max(1, opts.limit ?? 20))));
  const body = await ownerFetch(source, `ops/stories?${p}`, OPS_ACTOR, { what: "GET /owner/ops/stories" }, opts.fetchImpl);
  if (!isRecord(body) || !Array.isArray(body.items)) throw bad(source, "a story search");
  return keep(
    list(body.items),
    (i) =>
      typeof i.slug === "string" && i.slug && isTime(i.receivedAt)
        ? { slug: i.slug.slice(0, 120), headline: str(i.headline, 300) ?? "", receivedAt: i.receivedAt, stage: str(i.stage, 40), state: state(i.state) }
        : null,
    50,
  );
}

/** A story's path, or null when this backend does not know the slug (404 not_found). */
export async function fetchStory(source: OpsSource, slug: string, fetchImpl?: typeof fetch): Promise<OpsStory | null> {
  let body: unknown;
  try {
    body = await ownerFetch(source, `ops/story/${encodeURIComponent(slug)}`, OPS_ACTOR, { what: "GET /owner/ops/story" }, fetchImpl);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404 && e.code === "not_found") return null;
    throw e;
  }
  if (!isRecord(body) || typeof body.slug !== "string" || !Array.isArray(body.steps)) throw bad(source, "a story");
  const steps = keep(
    list(body.steps),
    (s): OpsStoryStep | null =>
      typeof s.stage === "string" && s.stage
        ? {
            stage: s.stage.slice(0, 40),
            label: str(s.label, 120) ?? s.stage,
            system: str(s.system, 64) ?? "",
            state: STEP_STATES.includes(s.state as OpsStoryStep["state"]) ? (s.state as OpsStoryStep["state"]) : "waiting",
            at: time(s.at),
            detail: safe(s.detail, 300),
          }
        : null,
    40,
  );
  return {
    slug: body.slug.slice(0, 120),
    headline: str(body.headline, 300) ?? "",
    reporter: str(body.reporter, 120),
    city: str(body.city, 120),
    source: (SOURCES as readonly string[]).includes(body.source as string) ? (body.source as OpsStory["source"]) : null,
    state: state(body.state),
    stuckAt: str(body.stuckAt, 40),
    steps,
  };
}

export async function fetchLogins(source: OpsSource, date: string, fetchImpl?: typeof fetch): Promise<OpsLogins> {
  const body = await ownerFetch(source, `ops/logins?date=${encodeURIComponent(date)}`, OPS_ACTOR, { what: "GET /owner/ops/logins" }, fetchImpl);
  if (!isRecord(body) || !Array.isArray(body.events)) throw bad(source, "the sign-in list");
  const events = keep(
    list(body.events),
    (e): OpsLoginEvent | null => {
      if (!isTime(e.at) || !APPS.includes(e.app as LoginApp) || !RESULTS.includes(e.result as LoginResult)) return null;
      return {
        id: `${source}-${str(e.id, 80) ?? String(Date.parse(e.at))}`,
        at: e.at,
        app: e.app as LoginApp,
        user: str(e.user, 120) ?? "",
        name: str(e.name, 120),
        role: str(e.role, 60),
        ip: str(e.ip, 64) ?? "",
        userAgent: str(e.userAgent, 200) ?? "",
        result: e.result as LoginResult,
      };
    },
    2000,
  );
  const activeSessions = keep(
    list(body.activeSessions),
    (s) =>
      APPS.includes(s.app as LoginApp) && typeof s.user === "string" && isTime(s.since)
        ? { app: s.app as LoginApp, user: s.user.slice(0, 120), since: s.since, lastSeen: time(s.lastSeen), ip: str(s.ip, 64) }
        : null,
    500,
  );
  // v1.1 adds the day's true totals and whether events was cut; an older backend sends neither
  const t = isRecord(body.totals) ? body.totals : null;
  const totals = t && typeof t.success === "number" && typeof t.failed === "number" ? { success: count(t.success), failed: count(t.failed) } : null;
  return { events, activeSessions, totals, truncated: body.truncated === true };
}
