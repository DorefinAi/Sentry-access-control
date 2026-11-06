// A small client for the owner API of each backend (handoff/owner-console-contract.md section 2).
// The URL and key come from server env only (SAMVADIA_API_URL / SAMVADIA_OWNER_KEY,
// SOCIA_API_URL / SOCIA_OWNER_KEY) and are read on every call, so a change to .env.local needs no
// code change. The key is sent as a Bearer token and never logged, echoed or put in an error.
// Every failure becomes an HttpError with a plain message the People page can show as it is.
import type { CatalogueEntry, NotConnectedReason, OwnerUser, PeopleSystem, PermissionState, RoleOption, UserPermissions } from "@/types/people";
import { SYSTEM_LABEL } from "@/types/people";
import { HttpError } from "./http";
import { isRecord } from "./validate";

const READ_TIMEOUT_MS = 8_000;
const WRITE_TIMEOUT_MS = 15_000;
const MIN_KEY = 32; // the backends switch the owner API off below this
const ACTOR_RE = /^[a-z0-9._-]{1,64}$/;
const CODE_RE = /^[a-z][a-z0-9_]{0,63}$/;

const ENV: Record<PeopleSystem, { url: string; key: string }> = {
  samvadia: { url: "SAMVADIA_API_URL", key: "SAMVADIA_OWNER_KEY" },
  socia: { url: "SOCIA_API_URL", key: "SOCIA_OWNER_KEY" },
};

/** A backend that is missing or unusable; the page shows it as "not connected". */
export class NotConnected extends HttpError {
  readonly reason: NotConnectedReason;
  constructor(reason: NotConnectedReason, status: number, message: string) {
    super(status, reason === "not_configured" ? "not_configured" : "backend_unavailable", message);
    this.reason = reason;
  }
}

/** Both env values are filled in (whether they are usable is ownerConfig's question). */
export function ownerEnvSet(system: PeopleSystem): boolean {
  return !!process.env[ENV[system].url]?.trim() && !!process.env[ENV[system].key]?.trim();
}

interface Config {
  base: string;
  key: string;
}

export function ownerConfig(system: PeopleSystem): Config | NotConnected {
  const label = SYSTEM_LABEL[system];
  const rawUrl = process.env[ENV[system].url]?.trim() ?? "";
  const key = process.env[ENV[system].key]?.trim() ?? "";
  if (!rawUrl || !key) return new NotConnected("not_configured", 503, `${label} is not connected: set ${ENV[system].url} and ${ENV[system].key} in Sentry's .env.local.`);
  if (key.length < MIN_KEY) return new NotConnected("not_configured", 503, `${label} is not connected: ${ENV[system].key} must be at least ${MIN_KEY} characters.`);
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return new NotConnected("not_configured", 503, `${label} is not connected: ${ENV[system].url} is not a valid URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return new NotConnected("not_configured", 503, `${label} is not connected: ${ENV[system].url} must start with http:// or https://.`);
  // Plain http would send the key in the clear; allow it only to this machine
  if (url.protocol === "http:" && !isLoopback(url.hostname)) {
    return new NotConnected("not_configured", 503, `${label} is not connected: ${ENV[system].url} uses http:// to another machine, which would send the owner key unencrypted. Use https://, or http://127.0.0.1 / localhost.`);
  }
  if (url.username || url.password) return new NotConnected("not_configured", 503, `${label} is not connected: ${ENV[system].url} must not contain a user name or password.`);
  return { base: url.href.replace(/\/+$/, ""), key };
}

/** localhost, 127.0.0.0/8 or ::1 (URL.hostname keeps IPv6 brackets). */
export function isLoopback(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h.endsWith(".localhost") || h === "::1" || /^127(?:\.\d{1,3}){3}$/.test(h);
}

/**
 * One {code, message} from either backend's error body. Both send {error, message}; FastAPI's own
 * validation answer {detail: [{msg, loc}]} or {detail: "text"} (Samvadia, before its handlers run)
 * becomes code "invalid" with the first message.
 */
export function readBackendError(body: unknown): { code: string; message: string } {
  if (!isRecord(body)) return { code: "", message: "" };
  // A code is a short machine word; anything else is not passed on as one
  if (typeof body.error === "string") return { code: CODE_RE.test(body.error) ? body.error : "", message: typeof body.message === "string" ? body.message.slice(0, 300) : "" };
  const d = body.detail;
  if (Array.isArray(d)) {
    const first = d.find(isRecord);
    const where = first && Array.isArray(first.loc) ? first.loc.filter((x) => x !== "body").join(".") : "";
    const msg = first && typeof first.msg === "string" ? first.msg : "";
    return { code: "invalid", message: [where, msg].filter(Boolean).join(": ").slice(0, 300) };
  }
  if (typeof d === "string") return { code: "", message: d.slice(0, 300) };
  return { code: "", message: "" };
}

// Plain-words messages for the codes both backends send: unauthorized, rate_limited, invalid_actor,
// last_admin, unknown_role, unknown_permission, duplicate_permission, not_found, invalid.
function backendError(system: PeopleSystem, status: number, body: unknown): HttpError {
  const label = SYSTEM_LABEL[system];
  const { code, message: theirs } = readBackendError(body);
  if (status === 401) return new NotConnected("refused", 502, `${label} refused Sentry's owner key. Check ${ENV[system].key} matches OWNER_API_KEY there.`);
  if (status === 429) return new HttpError(429, "rate_limited", `${label} is refusing owner calls for a while after too many failed key checks. Try again in about 10 minutes.`);
  if (status === 404 && code !== "not_found") {
    // The route itself is missing: the owner API is off (OWNER_API_KEY unset or short there)
    return new NotConnected("refused", 502, `${label} has its owner API switched off. Set OWNER_API_KEY (32+ characters) on that backend.`);
  }
  if (status === 404) return new HttpError(404, "not_found", `That person no longer exists in ${label}. Reload the list.`);
  if (status === 409 && code === "last_admin") {
    const who = system === "socia" ? "admin" : "super admin";
    return new HttpError(409, "last_admin", `Not saved: this is the last active ${who} in ${label}. Make someone else a ${who} first, then try again.`);
  }
  if (status === 422 && code === "unknown_role") return new HttpError(422, "unknown_role", `${label} does not know that role. Reload the page to get its current roles.`);
  if (status === 422 && code === "unknown_permission") return new HttpError(422, "unknown_permission", `${label} does not know one of those pages or actions. Reload the page to get its current list.`);
  if (status === 422 && code === "reporter_link_required") return new HttpError(422, "reporter_link_required", `Only a login linked to a reporter can have the reporter role in ${label}.`);
  if (status === 422 && code === "duplicate_permission") return new HttpError(422, "duplicate_permission", "The same page or action was sent twice. Reload and try again.");
  if (code === "invalid") return new HttpError(status === 422 ? 422 : 400, "invalid", `${label} refused the request${theirs ? `: ${theirs}` : "."}`);
  if (status === 400 && code === "invalid_actor") return new HttpError(400, "invalid_actor", `${label} did not accept your Sentry username as the person making the change.`);
  // Other refusals keep their status (409 stays a conflict), as long as it is one the page understands
  if (status >= 400 && status < 500) return new HttpError([400, 409, 422].includes(status) ? status : 400, code || (status === 409 ? "conflict" : "bad_request"), theirs || `${label} refused the change (${status}).`);
  return new NotConnected("error", 502, `${label} answered with an error (${status}). Check its server log.`);
}

/**
 * A write whose result is not known: it timed out, the connection broke after sending, the backend
 * failed (5xx) or answered in a way Sentry could not read. The page reloads to check.
 */
export const outcomeUnknown = (system: PeopleSystem) =>
  new HttpError(502, "outcome_unknown", `${SYSTEM_LABEL[system]} did not confirm the change, so it may or may not have been saved. The page has reloaded to check.`);

// Connection errors that mean the request never reached the backend, so nothing was saved
const NEVER_SENT = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "UND_ERR_CONNECT_TIMEOUT"]);

/**
 * Calls `/owner/<path>` on one backend as `actor` (the owner's Sentry username).
 * `fetchImpl` is for tests; normally the global fetch.
 */
export async function ownerFetch(system: PeopleSystem, path: string, actor: string, init: { method?: string; body?: unknown } = {}, fetchImpl: typeof fetch = globalThis.fetch): Promise<unknown> {
  const config = ownerConfig(system);
  if (config instanceof NotConnected) throw config;
  if (!ACTOR_RE.test(actor)) throw new HttpError(400, "invalid_actor", "Your Sentry username cannot be sent as the person making the change.");
  const method = init.method ?? "GET";
  const write = method !== "GET";
  const label = SYSTEM_LABEL[system];
  let res: Response;
  try {
    res = await fetchImpl(`${config.base}/owner/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.key}`,
        "X-Owner-Actor": actor,
        Accept: "application/json",
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
      redirect: "error", // a redirect would resend the key somewhere else
      signal: AbortSignal.timeout(method === "GET" ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS),
    });
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    const cause = e instanceof Error ? (e.cause as { code?: string } | undefined)?.code : undefined;
    const neverSent = !timedOut && !!cause && NEVER_SENT.has(cause);
    if (write && !neverSent) throw outcomeUnknown(system);
    throw new NotConnected("unreachable", 503, timedOut ? `${label} did not answer in time.` : `Could not reach ${label}. Is it running?`);
  }
  let body: unknown = undefined;
  const text = await res.text().catch(() => "");
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
  }
  if (!res.ok) {
    if (write && res.status >= 500) throw outcomeUnknown(system);
    throw backendError(system, res.status, body);
  }
  if (body === undefined) throw write ? outcomeUnknown(system) : new NotConnected("error", 502, `${label} sent an answer Sentry could not read.`);
  return body;
}

// ─── Reading the answers ────────────────────────────────────────────────────
// The backends are trusted but checked: a wrong shape becomes a 502, not a broken page.

const bad = (system: PeopleSystem, what: string) => new NotConnected("error", 502, `${SYSTEM_LABEL[system]} sent ${what} in a shape Sentry does not understand.`);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

export function readUser(system: PeopleSystem, v: unknown): OwnerUser {
  if (!isRecord(v) || typeof v.id !== "string" || typeof v.role !== "string" || typeof v.active !== "boolean") throw bad(system, "a person");
  const overrides = Array.isArray(v.overrides)
    ? v.overrides.filter((o): o is { permission: string; allowed: boolean } => isRecord(o) && typeof o.permission === "string" && typeof o.allowed === "boolean").map((o) => ({ permission: o.permission, allowed: o.allowed }))
    : [];
  const username = str(v.username);
  const email = str(v.email);
  return {
    id: v.id,
    username,
    name: str(v.name)?.trim() || username || email || v.id,
    email,
    role: v.role,
    roleLabel: str(v.roleLabel) ?? v.role,
    active: v.active,
    lastLoginAt: str(v.lastLoginAt),
    overrides,
  };
}

export interface PeopleList {
  catalogue: CatalogueEntry[];
  roles: RoleOption[];
  users: OwnerUser[];
}

export function readPeople(system: PeopleSystem, v: unknown): PeopleList {
  if (!isRecord(v) || !Array.isArray(v.users) || !Array.isArray(v.catalogue) || !Array.isArray(v.roles)) throw bad(system, "the people list");
  const catalogue = v.catalogue
    .filter((c) => isRecord(c) && typeof c.key === "string" && (c.group === "pages" || c.group === "actions"))
    .map((c) => {
      const r = c as Record<string, unknown>;
      const appliesTo = Array.isArray(r.appliesTo) ? r.appliesTo.filter((x): x is string => typeof x === "string") : null;
      return { key: r.key as string, group: r.group as "pages" | "actions", label: str(r.label) ?? (r.key as string), description: str(r.description) ?? "", appliesTo };
    });
  const roles = v.roles.filter((r) => isRecord(r) && typeof r.key === "string").map((r) => ({ key: (r as Record<string, unknown>).key as string, label: str((r as Record<string, unknown>).label) ?? ((r as Record<string, unknown>).key as string) }));
  return { catalogue, roles, users: v.users.map((u) => readUser(system, u)) };
}

export function readPermissions(system: PeopleSystem, v: unknown): UserPermissions {
  if (!isRecord(v) || typeof v.role !== "string" || !Array.isArray(v.permissions)) throw bad(system, "permissions");
  const permissions: PermissionState[] = v.permissions.map((p) => {
    if (!isRecord(p) || typeof p.key !== "string" || typeof p.allowed !== "boolean") throw bad(system, "permissions");
    const source = p.source === "override" ? "override" : "role";
    // Both backends send roleAllowed; if it is missing, a role-sourced key's role value is its current value
    const roleAllowed = typeof p.roleAllowed === "boolean" ? p.roleAllowed : source === "role" ? p.allowed : null;
    return { key: p.key, allowed: p.allowed, source, roleAllowed };
  });
  return { role: v.role, permissions };
}
