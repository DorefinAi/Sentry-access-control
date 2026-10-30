// Team roles. Owners and admins manage the team, operators act, viewers only look. Owners can do
// everything admins can; only an owner can make or change an owner. The rule lives here so
// every button asks the same question. A profile without a roleId (the single-user
// backend before team accounts) is treated as an admin.
import type { Profile } from "@/types/control";

export type RoleId = "owner" | "admin" | "operator" | "viewer";

/** What a button does, in permission terms. */
export type Action =
  | "alert.act" // ack, resolve, reopen
  | "alert.note"
  | "incident.create"
  | "incident.edit" // status, cause, fix, follow-ups, notes
  | "gauge.edit" // drag a gauge's warn and danger marks
  | "team.manage"; // Settings > Team

const ALLOWED: Record<RoleId, Action[]> = {
  owner: ["alert.act", "alert.note", "incident.create", "incident.edit", "gauge.edit", "team.manage"],
  admin: ["alert.act", "alert.note", "incident.create", "incident.edit", "gauge.edit", "team.manage"],
  operator: ["alert.act", "alert.note", "incident.create", "incident.edit", "gauge.edit"],
  viewer: [],
};

export const ROLE_LABELS: Record<RoleId, string> = { owner: "Owner", admin: "Admin", operator: "Operator", viewer: "Viewer" };

export const DENIED_HINT: Record<RoleId, string> = {
  owner: "",
  admin: "",
  operator: "Operators cannot do this. Ask an admin.",
  viewer: "Viewers can only look. Ask an admin for operator access.",
};

export function roleOf(p: Profile | undefined): RoleId | null {
  if (!p) return null;
  return p.roleId ?? "admin";
}

export function can(role: RoleId | null, action: Action): boolean {
  // Until the profile loads, keep buttons enabled; the server still checks (403)
  return role === null || ALLOWED[role].includes(action);
}
