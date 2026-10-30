// The owners' People page: one row per person across the Assignment desk (Samvadia) and Socia.
// Shapes follow handoff/owner-console-contract.md section 2; Sentry's server routes normalise
// both backends to these before anything reaches the browser.

export type PeopleSystem = "samvadia" | "socia";
export const PEOPLE_SYSTEMS: PeopleSystem[] = ["samvadia", "socia"];
export const SYSTEM_LABEL: Record<PeopleSystem, string> = { samvadia: "Assignment desk", socia: "Socia" };

export interface CatalogueEntry {
  key: string;
  group: "pages" | "actions";
  label: string;
  description: string;
  /** Roles this key means anything for (Samvadia); null when the backend does not say (Socia): applies to all. */
  appliesTo: string[] | null;
}

export interface RoleOption {
  key: string;
  label: string;
}

export interface OwnerOverride {
  permission: string;
  allowed: boolean;
}

export interface OwnerUser {
  id: string;
  username: string | null; // Socia has none
  name: string;
  email: string | null;
  role: string;
  roleLabel: string;
  active: boolean;
  lastLoginAt: string | null;
  overrides: OwnerOverride[];
}

export interface PermissionState {
  key: string;
  allowed: boolean;
  source: "role" | "override";
  /** What the role alone gives; null when the backend does not say (Samvadia, for exceptions). */
  roleAllowed: boolean | null;
}

export interface UserPermissions {
  role: string;
  permissions: PermissionState[];
}

/** Why a backend is missing from the page. */
export type NotConnectedReason = "not_configured" | "unreachable" | "refused" | "error";

export type SystemStatus =
  | { connected: true; catalogue: CatalogueEntry[]; roles: RoleOption[] }
  | { connected: false; reason: NotConnectedReason; message: string };

export interface PersonRow {
  key: string;
  name: string;
  username: string | null;
  email: string | null;
  samvadia: OwnerUser | null;
  socia: OwnerUser | null;
}

/** Two unmatched rows whose names look alike: maybe one person with different sign-ins. */
export interface NearMatch {
  a: string; // row key with only an Assignment desk account
  b: string; // row key with only a Socia account
  why: string;
}

export interface PeopleOverview {
  systems: Record<PeopleSystem, SystemStatus>;
  rows: PersonRow[];
  nearMatches: NearMatch[];
}

export interface PeoplePatch {
  role?: string;
  active?: boolean;
}

export interface HistoryEntry {
  system: PeopleSystem;
  at: string;
  actor: string | null;
  /** "owner" for owner-console changes, "user" for the system's own admins; null when the backend does not say. */
  actorKind: "owner" | "user" | null;
  action: string;
  target: { id: string; name: string | null };
  before: unknown;
  after: unknown;
}

export interface PeopleHistory {
  entries: HistoryEntry[];
  /** Systems whose history could not be read this time, with the reason. */
  missing: { system: PeopleSystem; message: string }[];
  /** Opaque: pass as `cursor` for the next page; null when both systems ran out. */
  next: string | null;
}
