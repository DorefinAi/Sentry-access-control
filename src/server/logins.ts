// Sign-ins across the apps: each backend's GET /owner/ops/logins (assignment-desk and
// reporter-portal from Samvadia, digital-desk from Socia) plus this console's own sign-ins.
// Each backend's answer is reported in `sources` (ok / stale / not reachable / not connected), so a
// backend Sentry cannot read never shows as zero sign-ins. Its true day totals (contract v1.1) are
// used when it sends them, and a cut event list is flagged. Flags are worked out here: new_ip (an
// address this person never signed in from before, remembered in login_ips across days),
// off_hours (before 06:00 or from 23:00 IST), repeated_failures (3+ failed tries from one address
// within 10 min). Answers are cached for 30 s per backend and day.
import type { AppName, LoginEvent, LoginReport, LoginSource } from "@/types/control";
import { SYSTEM_LABEL } from "@/types/people";
import { SESSION_TTL_SEC } from "./auth";
import { db, transaction } from "./db";
import { fetchLogins } from "./ops/client";
import { opsState } from "./ops/pull";
import { OPS_SOURCES, type OpsLogins, type OpsSource } from "./ops/types";
import { store, type ConsoleLogin } from "./store";
import { ist, istDate, istHour, ms, nowMs, todayIst } from "./time";

export const APPS: AppName[] = ["assignment-desk", "reporter-portal", "digital-desk", "sentry"];
const SOURCE_APPS: Record<OpsSource, AppName[]> = { samvadia: ["assignment-desk", "reporter-portal"], socia: ["digital-desk"] };

const FAILURE_WINDOW_MS = 10 * 60_000;
const CACHE_MS = 30_000;
const CACHE_MAX = 50; // backend + day pairs kept

type Raw = Omit<LoginEvent, "flags">;

const g = globalThis as typeof globalThis & { __sentryLogins?: Map<string, { at: number; data: OpsLogins }> };
const cache = () => (g.__sentryLogins ??= new Map());

/** For tests: forget cached answers. */
export function resetLoginCache(): void {
  g.__sentryLogins = new Map();
}

async function backendLogins(source: OpsSource, date: string, fetchImpl?: typeof fetch): Promise<{ data: OpsLogins | null; status: LoginSource }> {
  const base = { source, label: SYSTEM_LABEL[source], apps: SOURCE_APPS[source], truncated: false, totals: null };
  const st = opsState(source);
  if (!st.configured) return { data: null, status: { ...base, state: "not_connected", asOf: null, message: st.error } };
  const key = `${source}:${date}`;
  const hit = cache().get(key);
  const ok = (data: OpsLogins, at: number, state: "ok" | "stale", message: string | null) => ({
    data,
    status: { ...base, state, asOf: ist(at), message, truncated: data.truncated, totals: data.totals },
  });
  if (hit && nowMs() - hit.at < CACHE_MS) return ok(hit.data, hit.at, "ok", null);
  try {
    const data = await fetchLogins(source, date, fetchImpl);
    const at = nowMs();
    cache().set(key, { at, data });
    pruneCache(at);
    return ok(data, at, "ok", null);
  } catch (e) {
    const message = (e as Error).message;
    console.error(`[logins] ${SYSTEM_LABEL[source]}: ${message}`);
    // The last answer Sentry had, clearly marked with its time
    if (hit) return ok(hit.data, hit.at, "stale", message);
    return { data: null, status: { ...base, state: "unreachable", asOf: null, message } };
  }
}

/** Drops answers too old to be used even as "stale" (10 min), then the oldest beyond CACHE_MAX. */
function pruneCache(now: number): void {
  const c = cache();
  for (const [k, v] of c) if (now - v.at > 10 * 60_000) c.delete(k);
  while (c.size > CACHE_MAX) c.delete([...c.entries()].sort((a, b) => a[1].at - b[1].at)[0][0]);
}

// The console's own sign-ins (kept in the audit file).
function consoleEvents(date: string): Raw[] {
  return store()
    .loginLog.filter((l) => istDate(l.at) === date)
    .map((l) => ({ id: l.id, at: l.at, app: "sentry" as const, user: l.user, name: l.name, role: l.role, ip: l.ip, userAgent: l.userAgent, result: l.result }));
}

function consoleSessions(): LoginReport["activeSessions"] {
  const now = nowMs();
  return store()
    .loginLog.filter((l: ConsoleLogin) => l.result === "success" && l.iat && !l.endedAt && (l.iat + SESSION_TTL_SEC) * 1000 > now)
    .map((l) => ({ app: "sentry" as const, user: l.user, since: l.at, lastSeen: l.lastSeen ?? null, ip: l.ip || null }));
}

/** Adds the flags to a day's events and remembers every successful address. One pass per address. */
export function flagEvents(events: Raw[]): LoginEvent[] {
  const sorted = [...events].sort((a, b) => ms(a.at) - ms(b.at));
  const flags = new Map<Raw, LoginEvent["flags"]>(sorted.map((e) => [e, []]));

  // repeated_failures: a sliding 10-minute window over each address's tries, oldest first
  const byIp = new Map<string, Raw[]>();
  // Without an address there is nothing to group on (tries from unknown addresses are not one source)
  for (const e of sorted) if (e.ip && e.ip !== HIDDEN_USER) byIp.set(e.ip, [...(byIp.get(e.ip) ?? []), e]);
  for (const list of byIp.values()) {
    const fails: number[] = []; // times of failures in the window
    let head = 0;
    for (const e of list) {
      const t = ms(e.at);
      if (e.result !== "success") fails.push(t);
      while (head < fails.length && t - fails[head] > FAILURE_WINDOW_MS) head++;
      if (fails.length - head >= 3) flags.get(e)!.push("repeated_failures");
    }
  }

  const known = db().prepare("SELECT 1 FROM login_ips WHERE app = ? AND user = ? AND ip = ? AND first_ms < ?");
  const anyBefore = db().prepare("SELECT 1 FROM login_ips WHERE app = ? AND user = ? AND first_ms < ? LIMIT 1");
  for (const e of sorted) {
    const t = ms(e.at);
    const f = flags.get(e)!;
    // Only "new" against an address history: a first-ever sign-in has nothing to compare with
    if (e.result === "success" && e.user && e.ip && anyBefore.get(e.app, e.user, t) && !known.get(e.app, e.user, e.ip, t)) f.unshift("new_ip");
    const hour = istHour(t);
    if (hour < 6 || hour >= 23) f.splice(f[0] === "new_ip" ? 1 : 0, 0, "off_hours");
  }
  transaction((d) => {
    const insert = d.prepare("INSERT INTO login_ips (app, user, ip, first_ms) VALUES (?, ?, ?, ?) ON CONFLICT (app, user, ip) DO UPDATE SET first_ms = min(first_ms, excluded.first_ms)");
    for (const e of sorted) if (e.result === "success" && e.user && e.ip) insert.run(e.app, e.user, e.ip, ms(e.at));
  });
  return sorted.map((e) => ({ ...e, flags: flags.get(e)! }));
}

// Below admin: what was typed on a failed try can be a mistyped password, and who it may have been
// (name, role) gives that away too; addresses and browsers are not shown to anyone below admin.
export const HIDDEN_USER = "(hidden)";
export function hideForViewer(e: LoginEvent): LoginEvent {
  const failed = e.result !== "success";
  return { ...e, user: failed ? HIDDEN_USER : e.user, name: failed ? null : e.name, role: failed ? null : e.role, ip: HIDDEN_USER, userAgent: HIDDEN_USER };
}

export async function loginReport(date: string, app?: AppName, { revealFailedUsers = false, fetchImpl }: { revealFailedUsers?: boolean; fetchImpl?: typeof fetch } = {}): Promise<LoginReport> {
  const answers = await Promise.all(OPS_SOURCES.map((s) => backendLogins(s, date, fetchImpl)));
  const raw: Raw[] = [...answers.flatMap((a) => a.data?.events ?? []), ...consoleEvents(date)];
  const all = flagEvents(raw).filter((e) => !app || e.app === app);
  const today = date === todayIst();
  const sessions = [...(today ? answers.flatMap((a) => a.data?.activeSessions ?? []) : []), ...(today ? consoleSessions() : [])]
    .filter((s) => !app || s.app === app)
    .map((s) => (revealFailedUsers ? s : { ...s, user: HIDDEN_USER, ip: null }));
  const ok = (e: LoginEvent) => e.result === "success";

  // Day totals: a backend's own count when it sends one (exact, whatever its cap), else its events.
  // With an app filter the backend's totals cover all its apps, so the (maybe cut) events are counted.
  let success = 0;
  let failed = 0;
  answers.forEach(({ data }, i) => {
    const apps = SOURCE_APPS[OPS_SOURCES[i]].filter((a) => !app || a === app);
    if (!data || !apps.length) return;
    if (data.totals && !app) {
      success += data.totals.success;
      failed += data.totals.failed;
    } else {
      const mine = all.filter((e) => apps.includes(e.app));
      success += mine.filter(ok).length;
      failed += mine.filter((e) => !ok(e)).length;
    }
  });
  const own = all.filter((e) => e.app === "sentry");
  success += own.filter(ok).length;
  failed += own.filter((e) => !ok(e)).length;

  const events = all.map((e) => (revealFailedUsers ? e : hideForViewer(e)));
  return {
    date,
    totals: { success, failed, uniqueUsers: new Set(all.filter(ok).map((e) => e.user)).size, activeSessions: sessions.length },
    byApp: APPS.filter((a) => !app || a === app).map((a) => ({
      app: a,
      success: all.filter((e) => e.app === a && ok(e)).length,
      failed: all.filter((e) => e.app === a && !ok(e)).length,
      activeSessions: sessions.filter((s) => s.app === a).length,
    })),
    sources: answers.map((a) => a.status),
    unusual: events.filter((e) => e.flags.length).reverse(),
    activeSessions: sessions,
    events: [...events].reverse(),
  };
}
