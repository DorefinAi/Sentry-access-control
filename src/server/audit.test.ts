// The audit file (audit.local.json): what is saved, when, and what is never saved over.
// Run: node --no-warnings --import ./scripts/test-resolve.mjs src/server/audit.test.ts
// Works in a temp folder; never touches the real audit, users or sessions files.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sentry-audit-test-"));
process.chdir(dir); // store.ts, users.ts and liveSessions.ts put their files in process.cwd()
process.env.SENTRY_SECRET = "test-only-secret-not-used-anywhere-else-0123456789";

const load = async <T>(rel: string): Promise<T> => (await import(new URL(rel, import.meta.url).href)) as T;
const { hashPassword } = await load<typeof import("./password.mjs")>("./password.mjs");
const st = await load<typeof import("./store")>("./store.ts");
const session = await load<typeof import("./session")>("./session.ts");
const users = await load<typeof import("./users")>("./users.ts");
const live = await load<typeof import("./liveSessions")>("./liveSessions.ts");
const { TODAY } = await load<typeof import("../data/time")>("../data/time.ts");

const PW = "correct horse battery";
const g = globalThis as { __sentryStore?: unknown; __sentryAudit?: { broken: boolean; dirty: boolean } };
// What a restart does: memory is gone, the files stay
const restart = () => {
  g.__sentryStore = undefined;
  if (g.__sentryAudit) {
    g.__sentryAudit.broken = false;
    g.__sentryAudit.dirty = false;
  }
};
const readAudit = () => JSON.parse(readFileSync(st.AUDIT_FILE(), "utf8")) as { actionLog: { user: string; text: string }[]; loginLog: { id: string; user: string; result: string; endedAt?: string }[] };

writeFileSync(users.USERS_FILE, JSON.stringify([{ username: "ada", name: "Ada Admin", role: "admin", passwordHash: await hashPassword(PW) }]));
writeFileSync(live.SESSIONS_FILE, "[]");

const BASE = "http://localhost:3005";
function req(pathname: string, cookie?: string) {
  const headers = new Headers({ host: "localhost:3005", "user-agent": "test", origin: BASE, "content-type": "application/json", "x-forwarded-for": "10.0.0.9" });
  if (cookie) headers.set("cookie", cookie);
  return new Request(BASE + pathname, { method: "POST", headers });
}

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  restart();
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
}

await test("actions saved by an earlier run do not count as today's", async () => {
  const earlier = new Date(Date.now() - 3600e3).toISOString();
  writeFileSync(
    st.AUDIT_FILE(),
    JSON.stringify({ version: 1, actionLog: [{ at: `${TODAY}T16:31:00+05:30`, user: "ada", kind: "ack", text: "Acked ALR-1 last run", realAt: earlier }], loginLog: [] }),
  );
  restart();
  st.store();
  st.recordAction({ at: st.liveNow(), user: "ada", kind: "ack", text: "Acked ALR-2 this run" });
  const now = Math.floor(Date.now() / 1000);
  const profile = await session.buildProfile({ u: "ada", r: "admin", iat: now, exp: now + 3600 } as Parameters<typeof session.buildProfile>[0], null);
  assert.equal(profile.actionsToday.acked, 1, "only this run's ack");
  assert.deepEqual(profile.recent.map((r) => r.text), ["Acked ALR-2 this run"]);
  assert.equal(st.store().actionLog.length, 2, "the earlier action is still kept");
});

await test("failed sign-in usernames are hidden on disk, kept in memory", async () => {
  writeFileSync(st.AUDIT_FILE(), JSON.stringify({ version: 1, actionLog: [], loginLog: [] }));
  restart();
  const res = await session.login(req("/api/auth/login"), { username: "my-password-typed-here", password: "x" });
  assert.equal(res.status, 401);
  await st.saveAudit();
  const onDisk = readAudit().loginLog.filter((l) => l.result !== "success");
  assert.ok(onDisk.length > 0);
  assert.ok(onDisk.every((l) => l.user === "(hidden)"));
  assert.ok(!readFileSync(st.AUDIT_FILE(), "utf8").includes("my-password-typed-here"));
  assert.ok(st.store().loginLog.some((l) => l.user === "my-password-typed-here"), "admins still see it until a restart");
});

await test("a sign-out is saved straight away, not on the 10 s timer", async () => {
  const res = await session.login(req("/api/auth/login"), { username: "ada", password: PW });
  assert.equal(res.status, 200);
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
  await st.saveAudit();
  await session.logout(req("/api/auth/logout", cookie));
  await st.saveAudit(); // the save markAuditDirty() queued; no interval involved
  const mine = readAudit().loginLog.filter((l) => l.user === "ada" && l.result === "success");
  assert.ok(mine.at(-1)?.endedAt, "endedAt is on disk");
});

await test("nothing is written when nothing changed", async () => {
  st.store();
  await st.saveAudit();
  writeFileSync(st.AUDIT_FILE(), "sentinel");
  await st.saveAudit();
  assert.equal(readFileSync(st.AUDIT_FILE(), "utf8"), "sentinel");
  writeFileSync(st.AUDIT_FILE(), JSON.stringify({ version: 1, actionLog: [], loginLog: [] }));
});

await test("an invalid audit file is never saved over", async () => {
  writeFileSync(st.AUDIT_FILE(), "{ not json");
  restart();
  st.store();
  st.recordAction({ at: st.liveNow(), user: "ada", kind: "note", text: "after a bad file" });
  await st.saveAudit();
  assert.equal(readFileSync(st.AUDIT_FILE(), "utf8"), "{ not json", "left as it was");
});

restart();
process.chdir(tmpdir());
rmSync(dir, { recursive: true, force: true });
console.log(`audit.test: ${passed} passed`);
