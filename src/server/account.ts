// Self-service settings for the signed-in user (any role, viewers included): display name,
// password, preferences and sessions. Stored with the account in users.local.json.
import type { LandingPage, NotificationKind, PasswordChange, Preferences, PreferencesPatch, Profile, SessionInfo } from "@/types/control";
import { badRequest } from "./http";
import { MAX_PASSWORD, MIN_PASSWORD, hashPassword, verifyPassword } from "./password.mjs";
import { buildProfile, clearFailures, endOtherSessions, failDelay, reissueCookie, sessionsOf, takeAttempt, type Current } from "./session";
import { liveNow, recordAction } from "./store";
import { updateUsers } from "./users";
import { isRecord, oneOf, singleLine } from "./validate";

export const NOTIFICATION_KINDS: NotificationKind[] = [
  "alert_fired",
  "alert_resolved",
  "incident_opened",
  "incident_resolved",
  "code_change",
  "login_unusual",
  "backup",
  "report_ready",
  "team_change",
];
const THEMES: Preferences["theme"][] = ["dark", "light", "system"];
const DENSITIES: Preferences["density"][] = ["comfortable", "compact"];
const LANDINGS: LandingPage[] = ["/", "/pipelines", "/alerts", "/logs"];

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "system",
  density: "comfortable",
  notify: { kinds: NOTIFICATION_KINDS, critical: true },
  defaultLanding: "/",
};

// Saved preferences on top of the defaults. Someone who never chose notify.kinds sees every kind,
// including ones added later; a saved list is kept as chosen.
export function preferencesOf(saved: Partial<Preferences> | undefined): Preferences {
  return {
    ...DEFAULT_PREFERENCES,
    ...saved,
    notify: { ...DEFAULT_PREFERENCES.notify, ...saved?.notify },
  };
}

// ─── Display name ───────────────────────────────────────────────────────────

export async function updateMyName(current: Current, body: unknown): Promise<Profile> {
  if (!isRecord(body)) throw badRequest('Send {"name": "Your name"}.');
  if (body.name === undefined) throw badRequest("Nothing to change. Send name.");
  const name = singleLine(body.name, "name", 80, { required: true })!;
  await updateUsers((users) => {
    const u = users.find((x) => x.username === current.session.u);
    if (u) {
      u.name = name;
      u.updatedAt = liveNow();
    }
  });
  recordAction({ at: liveNow(), user: current.session.u, kind: "account", text: `Changed display name to "${name}"` });
  return buildProfile(current.session);
}

// ─── Password ───────────────────────────────────────────────────────────────

export function parsePasswordChange(body: unknown): PasswordChange {
  if (!isRecord(body) || typeof body.current !== "string" || typeof body.next !== "string") {
    throw badRequest('Send {"current": "...", "next": "..."}.');
  }
  if (!body.current) throw badRequest("current is required.");
  if (body.next.length < MIN_PASSWORD) throw badRequest(`The new password needs at least ${MIN_PASSWORD} characters.`);
  if (body.next.length > MAX_PASSWORD || body.current.length > MAX_PASSWORD) throw badRequest(`Passwords are at most ${MAX_PASSWORD} characters.`);
  if (body.next === body.current) throw badRequest("The new password must be different from the current one.");
  return { current: body.current, next: body.next };
}

// 204 on success. Every other session of this user stops working; this one gets a fresh cookie.
export async function changeMyPassword(req: Request, current: Current, input: PasswordChange): Promise<Response> {
  const key = `password:${current.session.u}`;
  const blocked = takeAttempt([key]);
  if (blocked) return blocked;
  if (!(await verifyPassword(input.current, current.user.passwordHash))) {
    await failDelay();
    return Response.json({ error: "unauthorized", message: "The current password is wrong." }, { status: 401 });
  }
  clearFailures(key);
  const hash = await hashPassword(input.next);
  const issuedAt = Math.floor(Date.now() / 1000);
  await updateUsers((users) => {
    const u = users.find((x) => x.username === current.session.u);
    if (u) {
      u.passwordHash = hash;
      u.sessionsValidAfter = issuedAt;
      u.updatedAt = liveNow();
    }
  });
  await endOtherSessions(current.session.u, current.session.sid);
  const cookie = await reissueCookie(req, current, issuedAt);
  recordAction({ at: liveNow(), user: current.session.u, kind: "account", text: "Changed password; other sessions signed out" });
  return new Response(null, { status: 204, headers: { "Set-Cookie": cookie, "Cache-Control": "no-store" } });
}

// ─── Preferences ────────────────────────────────────────────────────────────

export function parsePreferencesPatch(body: unknown): PreferencesPatch {
  if (!isRecord(body)) throw badRequest("Send an object with any of theme, density, notify, defaultLanding.");
  const patch: PreferencesPatch = {};
  if (body.theme !== undefined) patch.theme = oneOf(body.theme, THEMES, "theme");
  if (body.density !== undefined) patch.density = oneOf(body.density, DENSITIES, "density");
  if (body.defaultLanding !== undefined) patch.defaultLanding = oneOf(body.defaultLanding, LANDINGS, "defaultLanding");
  if (body.notify !== undefined) {
    if (!isRecord(body.notify)) throw badRequest("notify must be an object with kinds and/or critical.");
    patch.notify = {};
    if (body.notify.kinds !== undefined) {
      const kinds = body.notify.kinds;
      if (!Array.isArray(kinds) || kinds.some((k) => !(NOTIFICATION_KINDS as unknown[]).includes(k))) {
        throw badRequest(`notify.kinds must be a list of: ${NOTIFICATION_KINDS.join(", ")}.`);
      }
      patch.notify.kinds = [...new Set(kinds as NotificationKind[])];
    }
    if (body.notify.critical !== undefined) {
      if (typeof body.notify.critical !== "boolean") throw badRequest("notify.critical must be true or false.");
      patch.notify.critical = body.notify.critical;
    }
  }
  if (!Object.keys(patch).length) throw badRequest("Nothing to change.");
  return patch;
}

export async function updateMyPreferences(current: Current, patch: PreferencesPatch): Promise<Preferences> {
  return updateUsers((users) => {
    const u = users.find((x) => x.username === current.session.u);
    const prefs = preferencesOf(u?.prefs);
    const next: Preferences = {
      ...prefs,
      ...(patch.theme ? { theme: patch.theme } : {}),
      ...(patch.density ? { density: patch.density } : {}),
      ...(patch.defaultLanding ? { defaultLanding: patch.defaultLanding } : {}),
      notify: { ...prefs.notify, ...patch.notify },
    };
    if (u) u.prefs = next;
    return next;
  });
}

// ─── Sessions ───────────────────────────────────────────────────────────────

export function mySessions(current: Current): Promise<SessionInfo[]> {
  return sessionsOf(current.session.u, current.user.sessionsValidAfter ?? 0, current.session.sid);
}

export async function revokeOtherSessions(req: Request, current: Current): Promise<Response> {
  const issuedAt = Math.floor(Date.now() / 1000);
  await updateUsers((users) => {
    const u = users.find((x) => x.username === current.session.u);
    if (u) u.sessionsValidAfter = issuedAt;
  });
  await endOtherSessions(current.session.u, current.session.sid);
  const cookie = await reissueCookie(req, current, issuedAt);
  recordAction({ at: liveNow(), user: current.session.u, kind: "account", text: "Signed out all other sessions" });
  return new Response(null, { status: 204, headers: { "Set-Cookie": cookie, "Cache-Control": "no-store" } });
}
