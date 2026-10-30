// Team management for admins and owners. Accounts live in users.local.json; every change is
// recorded in the actor's activity and announced as a notification. Only an owner may make someone
// an owner or change an owner's account; nobody resets their own password here (Settings > Account
// asks for the current one).
import type { TeamRole, TeamUser, TeamUserCreate, TeamUserPatch } from "@/types/control";
import { ms } from "@/data/time";
import { ROLE_RANK, type Session } from "./auth";
import { badRequest, conflict, HttpError, notFound } from "./http";
import { listSessions, type StoredSession } from "./liveSessions";
import { MAX_PASSWORD, MIN_PASSWORD, hashPassword } from "./password.mjs";
import { endOtherSessions } from "./session";
import { addNotification, liveNow, recordAction, store } from "./store";
import { loadUsers, ROLE_LABEL, ROLES, updateUsers, USERNAME_RE, type StoredUser } from "./users";
import { isRecord, oneOf, singleLine } from "./validate";

// sessions: the live ones from sessions.local.json (listSessions()).
function toTeamUser(u: StoredUser, sessions: StoredSession[]): TeamUser {
  const logins = store().loginLog.filter((l) => l.user === u.username && l.result === "success");
  const last = [...logins].sort((a, b) => ms(b.at) - ms(a.at))[0];
  const active = u.disabled ? 0 : sessions.filter((s) => s.user === u.username && s.iat >= (u.sessionsValidAfter ?? 0)).length;
  return { username: u.username, name: u.name, role: u.role, disabled: !!u.disabled, createdAt: u.createdAt ?? null, lastLoginAt: last?.at ?? null, activeSessions: active };
}

export async function listTeam(): Promise<TeamUser[]> {
  const [users, sessions] = await Promise.all([loadUsers(), listSessions()]);
  return (users ?? []).map((u) => toTeamUser(u, sessions));
}

const ownersOnly = (text: string) => new HttpError(403, "forbidden", text);

function password(value: unknown): string {
  if (typeof value !== "string") throw badRequest("password must be text.");
  if (value.length < MIN_PASSWORD) throw badRequest(`password needs at least ${MIN_PASSWORD} characters.`);
  if (value.length > MAX_PASSWORD) throw badRequest(`password is too long (max ${MAX_PASSWORD} characters).`);
  return value;
}

export function parseTeamUserCreate(body: unknown): TeamUserCreate {
  if (!isRecord(body)) throw badRequest('Send {"username", "name", "role", "password"}.');
  if (typeof body.username !== "string" || !USERNAME_RE.test(body.username)) {
    throw badRequest("username must be 2-40 characters: lowercase letters, digits, . _ -");
  }
  return {
    username: body.username,
    name: singleLine(body.name, "name", 80, { required: true })!,
    role: oneOf(body.role, ROLES, "role"),
    password: password(body.password),
  };
}

export function parseTeamUserPatch(body: unknown): TeamUserPatch {
  if (!isRecord(body)) throw badRequest('Send any of {"name", "role", "disabled", "password"}.');
  const patch: TeamUserPatch = {};
  if (body.name !== undefined) patch.name = singleLine(body.name, "name", 80, { required: true });
  if (body.role !== undefined) patch.role = oneOf(body.role, ROLES, "role");
  if (body.disabled !== undefined) {
    if (typeof body.disabled !== "boolean") throw badRequest("disabled must be true or false.");
    patch.disabled = body.disabled;
  }
  if (body.password !== undefined) patch.password = password(body.password);
  if (!Object.keys(patch).length) throw badRequest("Nothing to change. Send name, role, disabled or password.");
  return patch;
}

function announce(actor: string, text: string, username: string) {
  const at = liveNow();
  recordAction({ at, user: actor, kind: "team", text });
  addNotification({ at, kind: "team_change", severity: "info", title: text, body: `Team account ${username}`, evidence: [] });
}

export async function createTeamUser(input: TeamUserCreate, by: Session): Promise<TeamUser> {
  if (input.role === "owner" && by.r !== "owner") throw ownersOnly("Only an owner can make someone an owner.");
  const actor = by.u;
  const passwordHash = await hashPassword(input.password);
  const created = await updateUsers((users) => {
    if (users.some((u) => u.username === input.username)) throw conflict(`There is already an account called ${input.username}.`);
    const now = liveNow();
    const user: StoredUser = { username: input.username, name: input.name, role: input.role, passwordHash, createdAt: now, updatedAt: now };
    users.push(user);
    return user;
  });
  announce(actor, `${actor} added ${created.username} as ${ROLE_LABEL[created.role].toLowerCase()}`, created.username);
  return toTeamUser(created, []);
}

// Admins and owners can manage the team; at least one of them must stay enabled.
const manages = (u: StoredUser) => ROLE_RANK[u.role] >= ROLE_RANK.admin && !u.disabled;

export async function patchTeamUser(username: string, patch: TeamUserPatch, by: Session): Promise<TeamUser> {
  const actor = by.u;
  if (patch.password !== undefined && username === actor) {
    throw new HttpError(403, "forbidden", "Change your own password in Settings > Account; it asks for your current one.");
  }
  if (patch.role === "owner" && by.r !== "owner") throw ownersOnly("Only an owner can make someone an owner.");
  const passwordHash = patch.password ? await hashPassword(patch.password) : null;
  const changes: string[] = [];
  const updated = await updateUsers((users) => {
    const user = users.find((u) => u.username === username);
    if (!user) throw notFound(`There is no account called ${username}.`);
    if (user.role === "owner" && by.r !== "owner") throw ownersOnly("Only an owner can change an owner's account.");
    const steppingDown = (!!patch.role && ROLE_RANK[patch.role] < ROLE_RANK[user.role]) || (patch.disabled === true && !user.disabled);
    if (steppingDown && username === actor) throw conflict(`You can't demote or disable yourself. Ask another ${user.role}.`);
    const losesManage = manages(user) && ((!!patch.role && ROLE_RANK[patch.role] < ROLE_RANK.admin) || patch.disabled === true);
    if (losesManage && users.filter(manages).length <= 1) throw conflict(`${username} is the last admin; make someone else admin first.`);

    const nowSec = Math.floor(Date.now() / 1000);
    if (patch.name !== undefined && patch.name !== user.name) {
      changes.push(`renamed ${username} to "${patch.name}"`);
      user.name = patch.name;
    }
    if (patch.role && patch.role !== user.role) {
      changes.push(`changed ${username}'s role to ${patch.role}`);
      user.role = patch.role as TeamRole;
    }
    if (patch.disabled !== undefined && patch.disabled !== !!user.disabled) {
      changes.push(`${patch.disabled ? "disabled" : "enabled"} ${username}`);
      user.disabled = patch.disabled;
      if (patch.disabled) user.sessionsValidAfter = nowSec;
    }
    if (passwordHash) {
      changes.push(`reset ${username}'s password`);
      user.passwordHash = passwordHash;
      user.sessionsValidAfter = nowSec; // their sessions stop working
    }
    user.updatedAt = liveNow();
    return { ...user };
  });
  if (updated.disabled || passwordHash) await endOtherSessions(username);
  for (const change of changes) announce(actor, `${actor} ${change}`, username);
  return toTeamUser(updated, await listSessions(username));
}
