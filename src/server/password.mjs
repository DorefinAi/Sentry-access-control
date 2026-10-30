// scrypt password hashes, shared by the server (users.ts) and scripts/add-user.mjs.
// Format: scrypt$N$r$p$saltHex$hashHex. Plain JS so the CLI can import it without a build step.
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;

export const MIN_PASSWORD = 10;
export const MAX_PASSWORD = 200;

/**
 * @param {string} password
 * @param {Buffer} salt
 * @param {number} keylen
 * @param {{ N: number, r: number, p: number }} opts
 * @returns {Promise<Buffer>}
 */
function derive(password, salt, keylen, opts) {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, keylen, { ...opts, maxmem: 256 * opts.N * opts.r + 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/**
 * @param {string} password
 * @returns {Promise<string>}
 */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await derive(password, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("hex")}$${key.toString("hex")}`;
}

// Used when the username is unknown, so a miss costs the same time as a wrong password.
export const DUMMY_HASH = `scrypt$${N}$${R}$${P}$${"0".repeat(32)}$${"0".repeat(64)}`;

/**
 * @param {string} password
 * @param {string} stored
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, stored) {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [n, r, p] = parts.slice(1, 4).map(Number);
  if (![n, r, p].every((x) => Number.isInteger(x) && x > 0) || n > 1 << 20) return false;
  const salt = Buffer.from(parts[4], "hex");
  const expected = Buffer.from(parts[5], "hex");
  if (!salt.length || expected.length < 16) return false;
  const actual = await derive(password, salt, expected.length, { N: n, r, p });
  return timingSafeEqual(actual, expected);
}
