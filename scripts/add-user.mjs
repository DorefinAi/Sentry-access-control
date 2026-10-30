#!/usr/bin/env node
// Add or update a console account in users.local.json without editing JSON by hand.
//
//   node scripts/add-user.mjs <username> "<Name>" <owner|admin|operator|viewer> [--keep-password]
//
// It asks for the password (not echoed). For scripts, set SENTRY_NEW_PASSWORD instead.
// --keep-password changes only the name and role of an existing account (for example to make
// someone an owner); their password and sessions stay as they are.
// Roles: owner = everything an admin can, and only owners can make or change owners;
// admin = everything else, including the team; operator = ack/resolve/notes, incidents; viewer = read only.
//
// Run it while nobody is changing the team in the console (Settings > Team): the server's write
// lock lives inside the server process and does not cover this script. As a safety net the script
// refuses to save if the file changed while it was running, and it never saves over a file it could
// not read whole (bad JSON, not a list, or an entry that is not a valid account).
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stdin, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import { hashPassword, MIN_PASSWORD } from "../src/server/password.mjs";

const ROLES = ["owner", "admin", "operator", "viewer"];
const USERNAME_RE = /^[a-z0-9._-]{2,40}$/;

// The same test as isUser in src/server/users.ts
const isUser = (u) =>
  !!u &&
  typeof u === "object" &&
  typeof u.username === "string" &&
  USERNAME_RE.test(u.username) &&
  typeof u.name === "string" &&
  !!u.name &&
  typeof u.role === "string" &&
  ROLES.includes(u.role) &&
  typeof u.passwordHash === "string" &&
  u.passwordHash.startsWith("scrypt$");
const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "users.local.json");

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const args = process.argv.slice(2);
const keepPassword = args.includes("--keep-password");
const [username, name, role] = args.filter((a) => a !== "--keep-password");
if (!username || !name || !role) fail('Usage: node scripts/add-user.mjs <username> "<Name>" <owner|admin|operator|viewer> [--keep-password]');
if (!USERNAME_RE.test(username)) fail("username: 2-40 characters, lowercase letters, digits, . _ -");
if (!ROLES.includes(role)) fail(`role must be one of: ${ROLES.join(", ")}`);

function askHidden(question) {
  return new Promise((resolve) => {
    if (!stdin.isTTY) fail("No terminal to ask for a password; set SENTRY_NEW_PASSWORD instead.");
    stdout.write(question);
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (ch) => {
      if (ch === "\r" || ch === "\n" || ch === "\u0004") {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off("data", onData);
        stdout.write("\n");
        resolve(value);
      } else if (ch === "\u0003") {
        process.exit(130);
      } else if (ch === "\u007f" || ch === "\b") {
        value = value.slice(0, -1);
      } else {
        value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

let users = [];
let readAt = null; // the file's mtime when read, to spot a change made meanwhile
if (existsSync(FILE)) {
  let parsed;
  try {
    readAt = statSync(FILE).mtimeMs;
    parsed = JSON.parse(readFileSync(FILE, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    fail(`${FILE} is not valid JSON; fix or restore it first. Nothing was changed.`);
  }
  if (!Array.isArray(parsed)) fail(`${FILE} is not a JSON list; fix or restore it first. Nothing was changed.`);
  const bad = parsed.filter((u) => !isUser(u)).length;
  if (bad) fail(`${FILE} has ${bad} ${bad === 1 ? "entry that is" : "entries that are"} not a valid account; fix or restore it first. Nothing was changed.`);
  users = parsed;
}
const existing = users.find((u) => u.username === username);
if (keepPassword && !existing) fail(`${username} does not exist yet, so there is no password to keep.`);

let passwordHash = existing?.passwordHash;
if (!keepPassword) {
  let password = process.env.SENTRY_NEW_PASSWORD;
  if (!password) {
    password = await askHidden(`Password for ${username}: `);
    const again = await askHidden("Again: ");
    if (password !== again) fail("Passwords do not match.");
  }
  if (password.length < MIN_PASSWORD) fail(`Use at least ${MIN_PASSWORD} characters.`);
  passwordHash = await hashPassword(password);
}

const now = new Date().toISOString();
// Keep whatever else the account has (preferences, createdAt); a new password ends its sessions.
const record = !existing
  ? { username, name, role, passwordHash, createdAt: now, updatedAt: now }
  : keepPassword
    ? { ...existing, name, role, updatedAt: now }
    : { ...existing, name, role, passwordHash, updatedAt: now, sessionsValidAfter: Math.floor(Date.now() / 1000) };
users = [...users.filter((u) => u.username !== username), record].sort((a, b) => a.username.localeCompare(b.username));
const existed = !!existing;

// Someone saved the team (or ran this script) while we waited for the password: start again
// rather than overwrite their change.
const nowAt = existsSync(FILE) ? statSync(FILE).mtimeMs : null;
if (nowAt !== readAt) fail(`${path.basename(FILE)} changed while this script was running. Nothing was saved; run it again.`);

// Write to a temp file of our own (the server uses users.local.json.tmp) and rename, so a crash
// never leaves half a file.
const tmp = `${FILE}.${process.pid}.tmp`;
writeFileSync(tmp, JSON.stringify(users, null, 2) + "\n", { mode: 0o600 });
renameSync(tmp, FILE);
console.log(`${existed ? "Updated" : "Added"} ${username} (${role}) in ${path.basename(FILE)}.`);
