import type { AppName, LoginEvent, LoginReport } from "@/types/control";
import { ACTIVE_SESSIONS, LOGINS } from "@/data/logins";
import { dateOf, ist, ms } from "@/data/time";
import { SESSION_TTL_SEC } from "./auth";
import { notFound } from "./http";
import { store, type ConsoleLogin } from "./store";

export const APPS: AppName[] = ["assignment-desk", "reporter-portal", "digital-desk", "sentry"];

const FAILURE_WINDOW_MS = 10 * 60_000;

// The console's own sign-ins, with the same flags the other apps get.
function consoleEvents(date: string): LoginEvent[] {
  const all = store().loginLog;
  return all
    .filter((l) => dateOf(l.at) === date)
    .map((l): LoginEvent => {
      const t = ms(l.at);
      const hour = Number(l.at.slice(11, 13));
      const earlierIps = new Set(all.filter((o) => o.user === l.user && o.result === "success" && ms(o.at) < t).map((o) => o.ip));
      const recentFails = all.filter((o) => o.ip === l.ip && o.result !== "success" && ms(o.at) <= t && t - ms(o.at) <= FAILURE_WINDOW_MS).length;
      const flags: LoginEvent["flags"] = [];
      if (earlierIps.size && !earlierIps.has(l.ip)) flags.push("new_ip");
      if (hour < 6 || hour >= 23) flags.push("off_hours");
      if (recentFails >= 3) flags.push("repeated_failures");
      return { id: l.id, at: l.at, app: "sentry", user: l.user, name: l.name, role: l.role, ip: l.ip, userAgent: l.userAgent, result: l.result, flags };
    });
}

function consoleSessions(): LoginReport["activeSessions"] {
  const now = Date.now();
  return store()
    .loginLog.filter((l: ConsoleLogin) => l.result === "success" && l.iat && !l.endedAt && (l.iat + SESSION_TTL_SEC) * 1000 > now)
    .map((l) => ({ app: "sentry" as const, user: l.user, since: l.at, lastSeen: ist(now), ip: l.ip }));
}

// What someone typed as a username on a failed sign-in can be a mistyped password; only admins
// and owners see it (revealFailedUsers). Everyone else, and the assistant, get HIDDEN_USER.
export const HIDDEN_USER = "(hidden)";
const hideFailedUser = (e: LoginEvent): LoginEvent => (e.result === "success" ? e : { ...e, user: HIDDEN_USER });

export function loginReport(date: string, app?: AppName, { revealFailedUsers = false } = {}): LoginReport {
  const seeded = LOGINS[date];
  const console = consoleEvents(date);
  if (!seeded && !console.length) throw notFound(`No login data for ${date}. Logins exist for ${Object.keys(LOGINS).join(" and ")}.`);
  const events = [...(seeded ?? []), ...console]
    .filter((e) => !app || e.app === app)
    .map((e) => (revealFailedUsers ? e : hideFailedUser(e)))
    .sort((a, b) => ms(a.at) - ms(b.at));
  const today = dateOf(ist(Date.now())) === date;
  const sessions = [...(ACTIVE_SESSIONS[date] ?? []), ...(today ? consoleSessions() : [])].filter((s) => !app || s.app === app);
  const ok = (e: LoginEvent) => e.result === "success";

  return {
    date,
    totals: {
      success: events.filter(ok).length,
      failed: events.filter((e) => !ok(e)).length,
      uniqueUsers: new Set(events.filter(ok).map((e) => e.user)).size,
      activeSessions: sessions.length,
    },
    byApp: APPS.filter((a) => !app || a === app).map((a) => ({
      app: a,
      success: events.filter((e) => e.app === a && ok(e)).length,
      failed: events.filter((e) => e.app === a && !ok(e)).length,
      activeSessions: sessions.filter((s) => s.app === a).length,
    })),
    unusual: events.filter((e) => e.flags.length).reverse(),
    activeSessions: sessions,
    events: [...events].reverse(),
  };
}
