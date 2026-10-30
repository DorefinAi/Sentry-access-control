// Team accounts for the console, kept in users.local.json (gitignored) in the project root.
// Node runtime (the proxy runs on Node too in Next 16). Writes are atomic (temp file + rename) and serialised.
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Preferences } from "@/types/control";
import type { RoleId } from "./auth";
import { HttpError } from "./http";
import { DUMMY_HASH, verifyPassword } from "./password.mjs";

export interface StoredUser {
  username: string;
  name: string;
  role: RoleId;
  passwordHash: string;
  disabled?: boolean;
  createdAt?: string;
  updatedAt?: string;
  // Sessions issued before this (unix seconds) no longer count: set on disable or a password reset.
  sessionsValidAfter?: number;
  prefs?: Preferences; // settings from /api/me/preferences
}

export const ROLE_LABEL: Record<RoleId, string> = { owner: "Owner", admin: "Admin", operator: "Operator", viewer: "Viewer" };
export const ROLES = Object.keys(ROLE_LABEL) as RoleId[];
export const USERNAME_RE = /^[a-z0-9._-]{2,40}$/;

export const USERS_FILE = path.join(process.cwd(), "users.local.json");

function isUser(u: unknown): u is StoredUser {
  if (!u || typeof u !== "object") return false;
  const x = u as Record<string, unknown>;
  return (
    typeof x.username === "string" && USERNAME_RE.test(x.username) &&
    typeof x.name === "string" && !!x.name &&
    typeof x.role === "string" && (ROLES as string[]).includes(x.role) &&
    typeof x.passwordHash === "string" && x.passwordHash.startsWith("scrypt$")
  );
}

type Read = { users: StoredUser[]; problem: string | null };

// problem is set when the file could not be read whole: unreadable, not JSON, not a list, or an
// entry that is not a valid account. Readers still get the valid accounts; writers refuse (below).
async function readUsersFile(): Promise<Read> {
  let raw: string;
  try {
    raw = await readFile(USERS_FILE, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { users: [], problem: null };
    return { users: [], problem: `users.local.json could not be read (${(err as NodeJS.ErrnoException).code ?? "error"})` };
  }
  let list: unknown;
  try {
    list = JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch {
    return { users: [], problem: "users.local.json is not valid JSON" };
  }
  if (!Array.isArray(list)) return { users: [], problem: "users.local.json is not a JSON list" };
  const users = list.filter(isUser);
  const bad = list.length - users.length;
  return { users, problem: bad ? `users.local.json has ${bad} ${bad === 1 ? "entry" : "entries"} that ${bad === 1 ? "is" : "are"} not a valid account` : null };
}

// Read fresh on every call so `node scripts/add-user.mjs` and admin edits take effect at once.
// Null when no account could be read (see readUsersFile); a missing file is an empty team.
export async function loadUsers(): Promise<StoredUser[] | null> {
  const { users, problem } = await readUsersFile();
  if (problem) {
    console.error(`[auth] ${problem}`);
    if (!users.length) return null;
  }
  return users;
}

// One queue per process (on globalThis, so every route bundle shares it).
const g = globalThis as typeof globalThis & { __sentryUsersWrite?: Promise<unknown> };

// Read, change and write the file as one step, one change at a time. If the read was not
// clean, nothing is written: saving what we could parse would drop the accounts we could not.
export function updateUsers<T>(change: (users: StoredUser[]) => T | Promise<T>): Promise<T> {
  const run = (g.__sentryUsersWrite ?? Promise.resolve()).then(async () => {
    const { users, problem } = await readUsersFile();
    if (problem) {
      console.error(`[auth] not saving users: ${problem}`);
      throw new HttpError(500, "users_file_unreadable", `Not saved: ${problem}. Fix the file (or restore it) and try again; nothing was changed.`);
    }
    const result = await change(users);
    const tmp = `${USERS_FILE}.tmp`;
    await writeFile(tmp, JSON.stringify([...users].sort((a, b) => a.username.localeCompare(b.username)), null, 2) + "\n", { mode: 0o600 });
    await rename(tmp, USERS_FILE);
    return result;
  });
  g.__sentryUsersWrite = run.catch(() => undefined);
  return run;
}

// A disabled account fails exactly like a wrong password, after the same scrypt work.
export async function checkLogin(username: string, password: string): Promise<{ user: StoredUser | null; known: boolean; disabled: boolean }> {
  const users = (await loadUsers()) ?? [];
  const user = users.find((u) => u.username === username.toLowerCase()) ?? null;
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  const disabled = !!user?.disabled;
  return { user: ok && !disabled ? user : null, known: !!user, disabled };
}

export async function findUser(username: string): Promise<StoredUser | null> {
  return ((await loadUsers()) ?? []).find((u) => u.username === username) ?? null;
}
