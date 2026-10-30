// Pure helpers for the People page: filtering rows, the page/action draft, and history in words.
// No React here, so people.test.ts can check them directly.
import type { HistoryEntry, OwnerOverride, OwnerUser, PeoplePatch, PeopleSystem, PermissionState, PersonRow } from "@/types/people";
import { PEOPLE_SYSTEMS } from "@/types/people";

// ─── Filters ────────────────────────────────────────────────────────────────

export type SystemFilter = "all" | "both" | "samvadia" | "socia" | "one";
export type StatusFilter = "all" | "active" | "disabled";

export interface RowFilter {
  q: string;
  system: SystemFilter;
  status: StatusFilter;
  role: string; // "" or "<system>:<role key>"
}

export const NO_FILTER: RowFilter = { q: "", system: "all", status: "all", role: "" };

const accounts = (r: PersonRow) => PEOPLE_SYSTEMS.map((s) => r[s]).filter((u): u is OwnerUser => !!u);

export function filterRows(rows: PersonRow[], f: RowFilter): PersonRow[] {
  const words = f.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((r) => {
    if (f.system === "both" && !(r.samvadia && r.socia)) return false;
    if (f.system === "one" && !!r.samvadia === !!r.socia) return false;
    if ((f.system === "samvadia" || f.system === "socia") && !r[f.system]) return false;
    const accs = accounts(r);
    // Active: every account they have is on. Disabled: at least one is off.
    if (f.status === "active" && !accs.every((u) => u.active)) return false;
    if (f.status === "disabled" && !accs.some((u) => !u.active)) return false;
    if (f.role) {
      // "<system>:<role key>"; a role key may itself contain ":"
      const at = f.role.indexOf(":");
      const sys = f.role.slice(0, at) as PeopleSystem;
      if (at < 0 || r[sys]?.role !== f.role.slice(at + 1)) return false;
    }
    if (!words.length) return true;
    const hay = [r.name, r.username, r.email, ...accs.flatMap((u) => [u.name, u.username, u.email])].filter(Boolean).join(" ").toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

// ─── Pages and actions draft ────────────────────────────────────────────────
// The draft is the full list of exceptions the owner wants (key -> allowed). Turning a key back
// to what the role gives drops its exception; when the role default is unknown (Samvadia does
// not send it for an exception) the exception is kept with the new value instead, so a click
// always changes what the person can do.

export type Draft = Record<string, boolean>;

export const draftFrom = (perms: PermissionState[]): Draft => Object.fromEntries(perms.filter((p) => p.source === "override").map((p) => [p.key, p.allowed]));

export function effective(p: PermissionState, draft: Draft): boolean {
  if (p.key in draft) return draft[p.key];
  // Was an exception, now dropped: back to the role (unknown -> the opposite of the old exception)
  if (p.source === "override") return p.roleAllowed ?? !p.allowed;
  return p.allowed;
}

export function setKey(draft: Draft, p: PermissionState, allowed: boolean): Draft {
  const next = { ...draft };
  if (p.roleAllowed !== null && allowed === p.roleAllowed) delete next[p.key];
  else next[p.key] = allowed;
  return next;
}

export function dropKey(draft: Draft, key: string): Draft {
  const next = { ...draft };
  delete next[key];
  return next;
}

export const draftList = (draft: Draft): OwnerOverride[] =>
  Object.entries(draft)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([permission, allowed]) => ({ permission, allowed }));

export function sameDraft(a: Draft, b: Draft): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => k in b && a[k] === b[k]);
}

// ─── History order ──────────────────────────────────────────────────────────

const FRACTION_RE = /T\d{2}:\d{2}:\d{2}\.(\d+)/;

/**
 * A sortable time for an ISO string: [milliseconds since 1970, the digits below a millisecond].
 * Date.parse stops at milliseconds and both backends write microseconds, so two changes in the
 * same millisecond still sort right. Unreadable times sort last.
 */
export function timeKey(iso: string): [number, number] {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return [Number.MIN_SAFE_INTEGER, 0];
  const frac = FRACTION_RE.exec(iso)?.[1] ?? "";
  return [ms, Number(frac.slice(3, 9).padEnd(6, "0"))];
}

/** Newest first; same time -> by system, so the order never flickers. */
export function byNewest(x: HistoryEntry, y: HistoryEntry): number {
  const a = timeKey(x.at);
  const b = timeKey(y.at);
  return b[0] - a[0] || b[1] - a[1] || x.system.localeCompare(y.system);
}

const entryKey = (e: HistoryEntry) => `${e.system}|${e.at}|${e.target.id}|${e.action}|${e.actor ?? ""}`;

/** Several loads of the history as one list: each change once, newest first. */
export function mergeEntries(...lists: HistoryEntry[][]): HistoryEntry[] {
  const seen = new Map<string, HistoryEntry>();
  for (const l of lists) for (const e of l) if (!seen.has(entryKey(e))) seen.set(entryKey(e), e);
  return [...seen.values()].sort(byNewest);
}

// ─── History in words ───────────────────────────────────────────────────────

const ACTIONS: Record<string, string> = {
  "user.role_changed": "changed the role of",
  "user.deactivated": "turned off",
  "user.activated": "turned on",
  "user.override_set": "set an exception for",
  "user.override_cleared": "cleared an exception for",
  "user.edit": "changed",
  "user.permissions": "changed pages and actions for",
  "user.add": "added",
  "user.created": "added",
  "user.deleted": "removed",
};

export const actionWords = (action: string) => ACTIONS[action] ?? action.replace(/^user\./, "").replace(/[._]/g, " ");

/**
 * Who made a change. Owners are told apart by the backend's actorKind, never guessed from the
 * text; their actor may read "owner:vansh", and the "owner:" goes because the page tags them.
 * null (a deleted user) -> "Someone".
 */
export function actorWords(actor: string | null, kind: "owner" | "user" | null = null): string {
  if (!actor) return "Someone";
  return kind === "owner" && actor.startsWith("owner:") ? actor.slice(6) : actor;
}

function short(v: unknown): string {
  if (v === null || v === undefined) return "none";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "string") return v.length > 40 ? `${v.slice(0, 39)}…` : v;
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return `${v.length} ${v.length === 1 ? "item" : "items"}`;
  return "changed";
}

function overridesOf(v: unknown): Map<string, boolean> | null {
  if (!Array.isArray(v)) return null;
  const m = new Map<string, boolean>();
  for (const o of v) {
    if (o && typeof o === "object" && typeof (o as OwnerOverride).permission === "string") m.set((o as OwnerOverride).permission, !!(o as OwnerOverride).allowed);
  }
  return m;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const SKIP = new Set(["id", "updated_at", "updatedAt", "lastLoginAt"]);

/** What changed between a history entry's before and after, one short line per field. */
export function describeChange(before: unknown, after: unknown, label: (key: string) => string = (k) => k): string[] {
  if (!isObj(before) && !isObj(after)) return before === after || after === undefined ? [] : [`${short(before)} → ${short(after)}`];
  const b = isObj(before) ? before : {};
  const a = isObj(after) ? after : {};
  const lines: string[] = [];
  for (const k of [...new Set([...Object.keys(b), ...Object.keys(a)])]) {
    if (SKIP.has(k) || JSON.stringify(b[k]) === JSON.stringify(a[k])) continue;
    const ob = overridesOf(b[k]);
    const oa = overridesOf(a[k]);
    if (k === "overrides" && (ob || oa)) {
      const x = ob ?? new Map();
      const y = oa ?? new Map();
      if (!y.size && x.size) lines.push("reset to the role");
      for (const key of [...new Set([...x.keys(), ...y.keys()])]) {
        if (x.get(key) === y.get(key)) continue;
        lines.push(y.has(key) ? `${label(key)}: ${y.get(key) ? "allowed" : "blocked"}` : y.size ? `${label(key)}: back to the role` : "");
      }
      continue;
    }
    // Socia writes one exception per entry: {permission, allowed}
    if (k === "allowed" && typeof (a.permission ?? b.permission) === "string") {
      lines.push(`${label(String(a.permission ?? b.permission))}: ${a.allowed === undefined ? "back to the role" : a.allowed ? "allowed" : "blocked"}`);
      continue;
    }
    if (k === "permission") continue;
    const name = k === "active" ? "account" : k === "role" ? "role" : k.replace(/_/g, " ");
    const show = (v: unknown) => (k === "active" && typeof v === "boolean" ? (v ? "on" : "off") : short(v));
    lines.push(`${name}: ${show(b[k])} → ${show(a[k])}`);
  }
  return lines.filter(Boolean);
}

// ─── Saving ─────────────────────────────────────────────────────────────────

export interface SaveState {
  user: { role: string; active: boolean };
  nextRole: string;
  nextActive: boolean;
  /** Exceptions as saved (null until the permissions have loaded). */
  saved: Draft | null;
  draft: Draft;
}

export interface SavePlan {
  /** PATCH first, when the account or role changed. */
  patch: PeoplePatch | null;
  /** Then PUT the full list of exceptions, when they changed. */
  overrides: OwnerOverride[] | null;
}

/**
 * What one "Save" sends, in order. A role change and exception edits are never saved together:
 * exceptions are judged against the role's defaults, so the role is saved first and the editor
 * blocks the switches until then. Every exception in the draft is sent, including ones on keys
 * hidden because they do not apply to the role, so saving never drops an exception silently.
 */
export function planSave(st: SaveState): SavePlan {
  const roleChanged = st.nextRole !== st.user.role;
  const activeChanged = st.nextActive !== st.user.active;
  const patch: PeoplePatch | null = roleChanged || activeChanged ? { ...(roleChanged ? { role: st.nextRole } : {}), ...(activeChanged ? { active: st.nextActive } : {}) } : null;
  const permsChanged = st.saved !== null && !sameDraft(st.draft, st.saved);
  return { patch, overrides: permsChanged && !roleChanged ? draftList(st.draft) : null };
}

/** True when "Save" has something to send. */
export const hasChanges = (plan: SavePlan) => plan.patch !== null || plan.overrides !== null;
