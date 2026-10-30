// The owners' People page, server side: reads both backends' owner APIs, joins the people, and
// passes owner changes through. Sentry never writes either database. Each change is recorded in
// Sentry's own action log (kind "people") and the server log under the owner who made it, once
// before the call and once with the outcome; the backends also record it in their history with
// actor "owner:<username>". Every answer is sent with Cache-Control: no-store (peopleJson).
import type { HistoryEntry, PeopleHistory, PeopleOverview, PeoplePatch, PeopleSystem, SystemStatus, UserPermissions } from "@/types/people";
import { PEOPLE_SYSTEMS, SYSTEM_LABEL } from "@/types/people";
import type { Session } from "./auth";
import { badRequest, HttpError } from "./http";
import { NotConnected, outcomeUnknown, ownerFetch, readPeople, readPermissions, readUser, type PeopleList } from "./ownerApi";
import { matchPeople, mergeHistory, nearMatches } from "./peopleMatch";
import { liveNow, recordAction } from "./store";
import { intParam, isRecord } from "./validate";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_RE = /^[a-z][a-z0-9_.:-]{0,63}$/i;
const MAX_OVERRIDES = 200;

export function systemParam(v: string): PeopleSystem {
  if ((PEOPLE_SYSTEMS as string[]).includes(v)) return v as PeopleSystem;
  throw new HttpError(404, "not_found", "Unknown system. Use samvadia or socia.");
}

export function personId(v: string): string {
  if (!UUID_RE.test(v)) throw badRequest("That person id is not valid.");
  return v.toLowerCase();
}

export function parsePeoplePatch(body: unknown): PeoplePatch {
  if (!isRecord(body)) throw badRequest('Send {"role"} and/or {"active"}.');
  const extra = Object.keys(body).filter((k) => k !== "role" && k !== "active");
  if (extra.length) throw badRequest(`Unknown field: ${extra.join(", ")}. Send role and/or active.`);
  const patch: PeoplePatch = {};
  if (body.role !== undefined) {
    if (typeof body.role !== "string" || !KEY_RE.test(body.role)) throw badRequest("role must be a role key.");
    patch.role = body.role;
  }
  if (body.active !== undefined) {
    if (typeof body.active !== "boolean") throw badRequest("active must be true or false.");
    patch.active = body.active;
  }
  if (!Object.keys(patch).length) throw badRequest("Nothing to change. Send role and/or active.");
  return patch;
}

export function parseOverrides(body: unknown): { permission: string; allowed: boolean }[] {
  if (!isRecord(body) || !Array.isArray(body.overrides) || Object.keys(body).length !== 1) throw badRequest('Send {"overrides": [{"permission", "allowed"}]}; an empty list resets to the role.');
  if (body.overrides.length > MAX_OVERRIDES) throw badRequest(`Too many exceptions (max ${MAX_OVERRIDES}).`);
  const seen = new Set<string>();
  return body.overrides.map((o) => {
    if (!isRecord(o) || Object.keys(o).some((k) => k !== "permission" && k !== "allowed")) throw badRequest("Each exception is {permission, allowed}.");
    if (typeof o.permission !== "string" || !KEY_RE.test(o.permission)) throw badRequest("permission must be a page or action key.");
    if (typeof o.allowed !== "boolean") throw badRequest("allowed must be true or false.");
    if (seen.has(o.permission)) throw badRequest(`${o.permission} is listed twice.`);
    seen.add(o.permission);
    return { permission: o.permission, allowed: o.allowed };
  });
}

/** JSON that no browser or proxy keeps: these answers name people and their access. */
export const peopleJson = (body: unknown) => Response.json(body, { headers: { "Cache-Control": "no-store, private" } });

// One line in Sentry's action log and the server log. Text is built only from values Sentry
// checked (system, uuid, role key, booleans) or that the backend sent back, never from the browser.
function note(owner: Session, text: string) {
  recordAction({ at: liveNow(), user: owner.u, kind: "people", text });
  console.info(`[people] ${owner.u}: ${text}`);
}

/**
 * Logs the attempt, runs the call, logs the outcome (including failures and unreadable replies,
 * which become "outcome unknown"), and returns or rethrows. `what` says what was asked.
 */
async function logged<T>(owner: Session, system: PeopleSystem, id: string, what: string, call: () => Promise<T>, done: (r: T) => string): Promise<T> {
  const head = `${SYSTEM_LABEL[system]} ${id}`;
  note(owner, `${head}: asked to ${what}`);
  let result: T;
  try {
    result = await call();
  } catch (e) {
    const err = e instanceof NotConnected && e.reason === "error" ? outcomeUnknown(system) : e;
    note(owner, `${head}: ${what} failed (${err instanceof HttpError ? err.code : "internal"})`);
    throw err;
  }
  note(owner, `${head}: ${done(result)}`);
  return result;
}

function statusOf(result: PromiseSettledResult<PeopleList>): SystemStatus {
  if (result.status === "fulfilled") return { connected: true, catalogue: result.value.catalogue, roles: result.value.roles };
  const e = result.reason;
  if (e instanceof NotConnected) return { connected: false, reason: e.reason, message: e.message };
  return { connected: false, reason: "error", message: e instanceof HttpError ? e.message : "Something went wrong reading this system." };
}

export async function getPeople(owner: Session, fetchImpl?: typeof fetch): Promise<PeopleOverview> {
  const [samvadia, socia] = await Promise.allSettled(PEOPLE_SYSTEMS.map(async (s) => readPeople(s, await ownerFetch(s, "people", owner.u, {}, fetchImpl))));
  const rows = matchPeople(samvadia.status === "fulfilled" ? samvadia.value.users : [], socia.status === "fulfilled" ? socia.value.users : []);
  // Hints only make sense when both lists are there
  const hints = samvadia.status === "fulfilled" && socia.status === "fulfilled" ? nearMatches(rows) : [];
  return { systems: { samvadia: statusOf(samvadia), socia: statusOf(socia) }, rows, nearMatches: hints };
}

export async function getPermissions(owner: Session, system: PeopleSystem, id: string, fetchImpl?: typeof fetch): Promise<UserPermissions> {
  return readPermissions(system, await ownerFetch(system, `people/${id}/permissions`, owner.u, {}, fetchImpl));
}

export async function patchPerson(owner: Session, system: PeopleSystem, id: string, patch: PeoplePatch, fetchImpl?: typeof fetch) {
  const asked = [patch.role !== undefined ? `set role ${patch.role}` : "", patch.active !== undefined ? (patch.active ? "turn on" : "turn off") : ""].filter(Boolean).join(" and ");
  return logged(
    owner,
    system,
    id,
    asked,
    async () => {
      const body = await ownerFetch(system, `people/${id}`, owner.u, { method: "PATCH", body: patch }, fetchImpl);
      return { user: readUser(system, isRecord(body) ? body.user : undefined) };
    },
    // The name comes from the backend's answer, not from the browser
    ({ user }) => `${user.name} is now ${user.active ? "on" : "off"}, ${user.roleLabel}`
  );
}

export async function putOverrides(owner: Session, system: PeopleSystem, id: string, overrides: { permission: string; allowed: boolean }[], fetchImpl?: typeof fetch) {
  const asked = overrides.length ? `set ${overrides.length} ${overrides.length === 1 ? "exception" : "exceptions"} to the role` : "reset to the role";
  return logged(
    owner,
    system,
    id,
    asked,
    async () => readPermissions(system, await ownerFetch(system, `people/${id}/overrides`, owner.u, { method: "PUT", body: { overrides } }, fetchImpl)),
    (r) => {
      const n = r.permissions.filter((x) => x.source === "override").length;
      return `done, ${n} ${n === 1 ? "exception" : "exceptions"} to role ${r.role}`;
    }
  );
}

function readEntries(system: PeopleSystem, body: unknown): { entries: HistoryEntry[]; next: string | null } {
  if (!isRecord(body) || !Array.isArray(body.entries)) throw new NotConnected("error", 502, `${SYSTEM_LABEL[system]} sent its history in a shape Sentry does not understand.`);
  const entries = body.entries
    .filter((e) => isRecord(e) && typeof e.at === "string" && typeof e.action === "string")
    .map((raw): HistoryEntry => {
      const e = raw as Record<string, unknown>;
      const t = isRecord(e.target) ? e.target : {};
      return {
        system,
        at: e.at as string,
        actor: typeof e.actor === "string" ? e.actor : null,
        actorKind: e.actorKind === "owner" || e.actorKind === "user" ? e.actorKind : null,
        action: e.action as string,
        target: { id: typeof t.id === "string" ? t.id : "", name: typeof t.name === "string" ? t.name : null },
        before: e.before ?? null,
        after: e.after ?? null,
      };
    });
  return { entries, next: typeof body.next === "string" && body.next ? body.next : null };
}

// Sentry's history cursor holds each system's own place (base64url JSON), per system:
//   "<their cursor>"  ask for the page after it;
//   true              ask from the newest entry (it failed before giving any page: try it again);
//   null / missing    it has no more pages; not asked again.
// Checked on the way back in.
export type Cursor = string | true | null;
export type Cursors = Partial<Record<PeopleSystem, Cursor>>;
const MAX_CURSOR = 2048;

const stillToAsk = (c: Cursor | undefined) => c === true || (typeof c === "string" && !!c);

export function encodeCursor(c: Cursors): string | null {
  return PEOPLE_SYSTEMS.some((s) => stillToAsk(c[s])) ? Buffer.from(JSON.stringify(c)).toString("base64url") : null;
}

export function decodeCursor(v: string): Cursors {
  const fail = () => badRequest("cursor is not valid. Reload the history.");
  if (v.length > MAX_CURSOR || !/^[A-Za-z0-9_-]+$/.test(v)) throw fail();
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(v, "base64url").toString("utf8"));
  } catch {
    throw fail();
  }
  if (!isRecord(parsed)) throw fail();
  const out: Cursors = {};
  for (const [k, val] of Object.entries(parsed)) {
    const ok = val === null || val === true || (typeof val === "string" && !!val && val.length <= 512);
    if (!(PEOPLE_SYSTEMS as string[]).includes(k) || !ok) throw fail();
    out[k as PeopleSystem] = val as Cursor;
  }
  return out;
}

export function historyQuery(url: URL): { limit: number; cursor?: Cursors } {
  const limit = intParam(url.searchParams.get("limit"), "limit", 1, 200, 50);
  const raw = url.searchParams.get("cursor");
  return { limit, cursor: raw ? decodeCursor(raw) : undefined };
}

/**
 * Both systems' change history merged, newest first. Each page asks every system that still has
 * entries for `limit` more and shows all of them (up to 2 x limit), so nothing fetched is skipped.
 * A system that cannot be read is listed in `missing` and asked again on the next page: from the
 * same place if it had one, or from its newest entry (cursor `true`) if it failed on the first page.
 */
export async function getHistory(owner: Session, q: { limit: number; cursor?: Cursors }, fetchImpl?: typeof fetch): Promise<PeopleHistory> {
  const ask = PEOPLE_SYSTEMS.filter((s) => !q.cursor || stillToAsk(q.cursor[s]));
  const results = await Promise.allSettled(
    ask.map(async (s) => {
      const qs = new URLSearchParams({ limit: String(q.limit) });
      const c = q.cursor?.[s];
      if (typeof c === "string") qs.set("cursor", c);
      return readEntries(s, await ownerFetch(s, `history?${qs}`, owner.u, {}, fetchImpl));
    })
  );
  const lists: HistoryEntry[][] = [];
  const missing: PeopleHistory["missing"] = [];
  const next: Cursors = {};
  results.forEach((r, i) => {
    const s = ask[i];
    if (r.status === "fulfilled") {
      lists.push(r.value.entries);
      next[s] = r.value.next;
    } else {
      missing.push({ system: s, message: r.reason instanceof HttpError ? r.reason.message : "Could not read the history." });
      next[s] = q.cursor?.[s] ?? true; // keep its place, or start over if it never gave a page
    }
  });
  const entries = mergeHistory(lists, lists.reduce((n, l) => n + l.length, 0));
  return { entries, missing, next: encodeCursor(next) };
}
