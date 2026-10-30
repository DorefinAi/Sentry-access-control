// The owners' People page, server side and the pure helpers: matching, near matches, history
// merge, the owner-API client against a mocked fetch, and the owner-only routes.
// Run: node --no-warnings --import ./scripts/test-resolve.mjs src/server/people.test.ts
// Uses a temp folder for users/sessions and never calls a real backend.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { HistoryEntry, OwnerUser } from "@/types/people";

const dir = mkdtempSync(path.join(tmpdir(), "sentry-people-test-"));
process.chdir(dir);
process.env.SENTRY_SECRET = "test-only-secret-not-used-anywhere-else-0123456789";

const load = async <T>(rel: string): Promise<T> => (await import(new URL(rel, import.meta.url).href)) as T;
const match = await load<typeof import("./peopleMatch")>("./peopleMatch.ts");
const api = await load<typeof import("./ownerApi")>("./ownerApi.ts");
const people = await load<typeof import("./people")>("./people.ts");
const lib = await load<typeof import("../lib/people")>("../lib/people.ts");
const { hashPassword } = await load<typeof import("./password.mjs")>("./password.mjs");
const session = await load<typeof import("./session")>("./session.ts");
const users = await load<typeof import("./users")>("./users.ts");
const live = await load<typeof import("./liveSessions")>("./liveSessions.ts");
const store = await load<typeof import("./store")>("./store.ts");
const peopleRoute = await load<typeof import("../app/api/people/route")>("../app/api/people/route.ts");
const patchRoute = await load<typeof import("../app/api/people/[system]/[id]/route")>("../app/api/people/[system]/[id]/route.ts");
const overridesRoute = await load<typeof import("../app/api/people/[system]/[id]/overrides/route")>("../app/api/people/[system]/[id]/overrides/route.ts");

const infoLines: string[] = [];
console.info = (...args: unknown[]) => void infoLines.push(args.map(String).join(" "));

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

const u = (over: Partial<OwnerUser> & { id: string }): OwnerUser => ({ username: null, name: over.id, email: null, role: "admin", roleLabel: "Admin", active: true, lastLoginAt: null, overrides: [], ...over });
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// ─── Matching ───────────────────────────────────────────────────────────────

await test("email match, case-insensitive and trimmed", () => {
  const rows = match.matchPeople([u({ id: "d1", username: "ravi", name: "Ravi", email: " Ravi.S@News.in " })], [u({ id: "s1", name: "Ravi S", email: "ravi.s@news.in" })]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].samvadia?.id, "d1");
  assert.equal(rows[0].socia?.id, "s1");
  assert.equal(rows[0].name, "Ravi");
  assert.equal(rows[0].username, "ravi");
});

await test("username matches the Socia email local part", () => {
  const rows = match.matchPeople([u({ id: "d1", username: "Anita", name: "Anita" })], [u({ id: "s1", name: "Anita K", email: "anita@socia.app" })]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].socia?.id, "s1");
  assert.equal(rows[0].email, "anita@socia.app");
});

await test("email matches win over username matches across people", () => {
  // d1's username fits s1's local part, but d2 matches s1 by email: s1 belongs to d2
  const rows = match.matchPeople(
    [u({ id: "d1", username: "kiran", name: "Kiran One" }), u({ id: "d2", username: "kp", name: "Kiran Two", email: "kiran@x.in" })],
    [u({ id: "s1", name: "Kiran", email: "kiran@x.in" })]
  );
  const d1 = rows.find((r) => r.samvadia?.id === "d1")!;
  const d2 = rows.find((r) => r.samvadia?.id === "d2")!;
  assert.equal(d2.socia?.id, "s1");
  assert.equal(d1.socia, null);
  assert.equal(rows.length, 2);
});

await test("an ambiguous local part is not matched", () => {
  const rows = match.matchPeople([u({ id: "d1", username: "amit", name: "Amit" })], [u({ id: "s1", name: "Amit A", email: "amit@a.in" }), u({ id: "s2", name: "Amit B", email: "amit@b.in" })]);
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => !(r.samvadia && r.socia)));
});

await test("each Socia account joins at most one person; the rest stand alone, sorted by name", () => {
  const rows = match.matchPeople(
    [u({ id: "d1", username: "zed", name: "Zed", email: "z@x.in" }), u({ id: "d2", username: "z", name: "Zara", email: "z@x.in" })],
    [u({ id: "s1", name: "Z", email: "z@x.in" }), u({ id: "s2", name: "Bina", email: "bina@x.in" })]
  );
  assert.deepEqual(
    rows.map((r) => [r.name, r.samvadia?.id ?? null, r.socia?.id ?? null]),
    [
      ["Bina", null, "s2"],
      ["Zara", "d2", null],
      ["Zed", "d1", "s1"],
    ]
  );
  assert.equal(new Set(rows.map((r) => r.key)).size, rows.length, "keys are unique");
});

await test("two desk accounts with the same email: the first takes the Socia account, the second stands alone", () => {
  const rows = match.matchPeople(
    [u({ id: "d1", username: "a1", name: "A One", email: "same@x.in" }), u({ id: "d2", username: "a2", name: "A Two", email: "SAME@x.in" })],
    [u({ id: "s1", name: "A", email: "same@x.in" })]
  );
  assert.deepEqual(
    rows.map((r) => [r.samvadia?.id ?? null, r.socia?.id ?? null]),
    [
      ["d1", "s1"],
      ["d2", null],
    ]
  );
});

await test("a username whose Socia local part is already taken by an email match stays unmatched", () => {
  // s1 = kiran@x.in is taken by d2's email; d1 "kiran" must not also claim it
  const rows = match.matchPeople(
    [u({ id: "d1", username: "kiran", name: "Kiran" }), u({ id: "d2", username: "kp", name: "K P", email: "kiran@x.in" })],
    [u({ id: "s1", name: "Kiran", email: "kiran@x.in" })]
  );
  assert.equal(rows.find((r) => r.samvadia?.id === "d1")!.socia, null);
  assert.equal(rows.find((r) => r.samvadia?.id === "d2")!.socia?.id, "s1");
  assert.equal(rows.filter((r) => r.socia?.id === "s1").length, 1, "one row per Socia account");
});

await test("no username and no email never matches", () => {
  const rows = match.matchPeople([u({ id: "d1", name: "X" })], [u({ id: "s1", name: "X" })]);
  assert.equal(rows.length, 2);
});

// ─── Near matches ───────────────────────────────────────────────────────────

await test("near matches: same name in another order, similar name, similar sign-in", () => {
  assert.equal(match.nameSimilarity("Sharma, Ravi", "ravi sharma"), 1);
  assert.ok(match.nameSimilarity("Ravi Sharma", "Ravi Sharmaa") >= 0.8);
  assert.ok(match.nameSimilarity("Ravi Sharma", "Neha Gupta") < 0.5);
  const rows = match.matchPeople(
    [u({ id: "d1", username: "rsharma", name: "Ravi Sharma", email: "ravi@desk.in" }), u({ id: "d2", username: "neha.g", name: "Neha" }), u({ id: "d3", username: "o", name: "Om" })],
    [u({ id: "s1", name: "Sharma Ravi", email: "ravi@socia.in" }), u({ id: "s2", name: "N. Gupta", email: "nehag@socia.in" }), u({ id: "s3", name: "Pooja", email: "p@socia.in" })]
  );
  const hints = match.nearMatches(rows);
  const pairs = hints.map((h) => [rows.find((r) => r.key === h.a)!.samvadia!.id, rows.find((r) => r.key === h.b)!.socia!.id, h.why]);
  assert.deepEqual(pairs, [
    ["d1", "s1", "Same name"],
    ["d2", "s2", "Similar sign-in names"],
  ]);
});

await test("matched rows never appear in near matches", () => {
  const rows = match.matchPeople([u({ id: "d1", username: "a", name: "Same Name", email: "a@x.in" })], [u({ id: "s1", name: "Same Name", email: "a@x.in" })]);
  assert.deepEqual(match.nearMatches(rows), []);
});

// ─── History merge ──────────────────────────────────────────────────────────

const h = (system: "samvadia" | "socia", at: string): HistoryEntry => ({ system, at, actor: "owner:vansh", actorKind: "owner", action: "user.edit", target: { id: "x", name: "X" }, before: null, after: null });

await test("history from both systems merges newest first and is cut to the limit", () => {
  const merged = match.mergeHistory(
    [
      [h("samvadia", "2026-10-30T10:00:00+05:30"), h("samvadia", "2026-10-30T08:00:00Z")],
      [h("socia", "2026-10-30T05:00:00Z"), h("socia", "2026-10-30T09:00:00Z")],
    ],
    3
  );
  assert.deepEqual(
    merged.map((e) => [e.system, e.at]),
    [
      ["socia", "2026-10-30T09:00:00Z"],
      ["samvadia", "2026-10-30T08:00:00Z"],
      ["socia", "2026-10-30T05:00:00Z"], // newer than 10:00 IST = 04:30Z
    ]
  );
});

await test("history order keeps microseconds and mixed offsets", () => {
  const merged = match.mergeHistory(
    [
      [h("samvadia", "2026-10-30T10:00:00.123400+00:00"), h("samvadia", "2026-10-30T15:30:00.123450+05:30")],
      [h("socia", "2026-10-30T10:00:00.1235Z"), h("socia", "not a time")],
    ],
    10
  );
  assert.deepEqual(
    merged.map((e) => e.at),
    ["2026-10-30T10:00:00.1235Z", "2026-10-30T15:30:00.123450+05:30", "2026-10-30T10:00:00.123400+00:00", "not a time"]
  );
  assert.deepEqual(lib.timeKey("2026-10-30T10:00:00.123456Z")[1], 456000);
});

await test("history pages merge without repeats, newest first", () => {
  const a = h("samvadia", "2026-10-30T10:00:00Z");
  const b = h("socia", "2026-10-30T11:00:00Z");
  const c = h("samvadia", "2026-10-29T10:00:00Z");
  assert.deepEqual(lib.mergeEntries([a, b], [b, c], [a]).map((e) => e.at), [b.at, a.at, c.at]);
});

// ─── Owner API client ───────────────────────────────────────────────────────

const KEY_D = "desk-owner-key-0123456789abcdef0123456789";
const KEY_S = "socia-owner-key-0123456789abcdef0123456789";
function configure(which: { samvadia?: boolean; socia?: boolean } = { samvadia: true, socia: true }) {
  if (which.samvadia) {
    process.env.SAMVADIA_API_URL = "https://desk.test:8000/";
    process.env.SAMVADIA_OWNER_KEY = KEY_D;
  } else {
    delete process.env.SAMVADIA_API_URL;
    delete process.env.SAMVADIA_OWNER_KEY;
  }
  if (which.socia) {
    process.env.SOCIA_API_URL = "https://socia.test:8200";
    process.env.SOCIA_OWNER_KEY = KEY_S;
  } else {
    delete process.env.SOCIA_API_URL;
    delete process.env.SOCIA_OWNER_KEY;
  }
}

interface Call {
  url: string;
  method: string;
  headers: Headers;
  body: string | null;
  redirect: RequestRedirect | undefined;
}
type Reply = { status: number; body?: unknown } | Error;

function mockFetch(reply: (url: string, init: RequestInit) => Reply) {
  const calls: Call[] = [];
  const f = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, method: init.method ?? "GET", headers: new Headers(init.headers), body: (init.body as string) ?? null, redirect: init.redirect });
    const r = reply(url, init);
    if (r instanceof Error) throw r;
    return new Response(r.body === undefined ? null : typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { f, calls };
}

const neverHasKey = (text: string) => {
  assert.ok(!text.includes(KEY_D), "Samvadia key leaked");
  assert.ok(!text.includes(KEY_S), "Socia key leaked");
};

async function rejects(p: Promise<unknown>, status: number, code: string): Promise<Error> {
  try {
    await p;
  } catch (e) {
    const err = e as { status: number; code: string; message: string };
    assert.equal(err.status, status, `status for ${code}: ${err.message}`);
    assert.equal(err.code, code);
    neverHasKey(err.message);
    return e as Error;
  }
  throw new Error(`expected ${status} ${code}`);
}

await test("sends Bearer key, X-Owner-Actor and JSON to <url>/owner/<path>; no redirects", async () => {
  configure();
  const { f, calls } = mockFetch(() => ({ status: 200, body: { user: { id: ID(1), role: "admin", active: false } } }));
  await api.ownerFetch("samvadia", `people/${ID(1)}`, "vansh", { method: "PATCH", body: { active: false } }, f);
  assert.equal(calls.length, 1);
  const c = calls[0];
  assert.equal(c.url, `https://desk.test:8000/owner/people/${ID(1)}`);
  assert.equal(c.method, "PATCH");
  assert.equal(c.headers.get("authorization"), `Bearer ${KEY_D}`);
  assert.equal(c.headers.get("x-owner-actor"), "vansh");
  assert.equal(c.headers.get("content-type"), "application/json");
  assert.equal(c.body, '{"active":false}');
  assert.equal(c.redirect, "error");
  await api.ownerFetch("socia", "people", "aditya", {}, f);
  assert.equal(calls[1].url, "https://socia.test:8200/owner/people");
  assert.equal(calls[1].headers.get("authorization"), `Bearer ${KEY_S}`);
  assert.equal(calls[1].headers.get("content-type"), null, "no body, no content type");
});

await test("unconfigured, short key or bad URL: not_configured without calling out", async () => {
  const { f, calls } = mockFetch(() => ({ status: 200, body: {} }));
  configure({ socia: true });
  await rejects(api.ownerFetch("samvadia", "people", "vansh", {}, f), 503, "not_configured");
  process.env.SAMVADIA_API_URL = "https://desk.test";
  process.env.SAMVADIA_OWNER_KEY = "short";
  const e = await rejects(api.ownerFetch("samvadia", "people", "vansh", {}, f), 503, "not_configured");
  assert.match(e.message, /at least 32/);
  process.env.SAMVADIA_OWNER_KEY = KEY_D;
  process.env.SAMVADIA_API_URL = "ftp://desk.test";
  await rejects(api.ownerFetch("samvadia", "people", "vansh", {}, f), 503, "not_configured");
  // http only to this machine: the key would travel in the clear otherwise
  process.env.SAMVADIA_API_URL = "http://10.0.0.5:8000";
  const clear = await rejects(api.ownerFetch("samvadia", "people", "vansh", {}, f), 503, "not_configured");
  assert.match(clear.message, /unencrypted/);
  process.env.SAMVADIA_API_URL = "http://user:pw@127.0.0.1:8000";
  await rejects(api.ownerFetch("samvadia", "people", "vansh", {}, f), 503, "not_configured");
  assert.equal(calls.length, 0);
  for (const ok of ["http://127.0.0.1:8000", "http://localhost:8000", "http://[::1]:8000", "https://desk.example.com"]) {
    process.env.SAMVADIA_API_URL = ok;
    assert.ok(!(api.ownerConfig("samvadia") instanceof api.NotConnected), ok);
  }
  assert.ok(!api.isLoopback("127.0.0.1.evil.com"));
  assert.ok(!api.isLoopback("localhost.evil.com"));
});

await test("an actor the backends would refuse is stopped in Sentry", async () => {
  configure();
  const { f, calls } = mockFetch(() => ({ status: 200, body: {} }));
  await rejects(api.ownerFetch("socia", "people", "Vansh Admin", {}, f), 400, "invalid_actor");
  assert.equal(calls.length, 0);
});

await test("backend answers become plain messages with the right status", async () => {
  configure();
  const cases: [Reply, number, string][] = [
    [{ status: 401, body: { error: "unauthorized", message: "nope" } }, 502, "backend_unavailable"],
    [{ status: 404, body: { detail: "Not Found" } }, 502, "backend_unavailable"], // owner API off
    [{ status: 404, body: { error: "not_found", message: "No such user" } }, 404, "not_found"],
    [{ status: 409, body: { error: "last_admin", message: "x" } }, 409, "last_admin"],
    [{ status: 422, body: { error: "unknown_role", message: "x" } }, 422, "unknown_role"],
    [{ status: 422, body: { error: "unknown_permission", keys: ["x"] } }, 422, "unknown_permission"],
    [{ status: 422, body: { error: "reporter_link_required", message: "x" } }, 422, "reporter_link_required"],
    [{ status: 429, body: { error: "rate_limited", message: "x" } }, 429, "rate_limited"],
    [{ status: 400, body: { error: "invalid", message: "Bad body" } }, 400, "invalid"],
    [{ status: 422, body: { detail: [{ loc: ["body", "role"], msg: "Field required", type: "missing" }] } }, 422, "invalid"],
    [{ status: 422, body: { error: "duplicate_permission", message: "x" } }, 422, "duplicate_permission"],
    [{ status: 400, body: { error: "invalid_actor", message: "x" } }, 400, "invalid_actor"],
    [{ status: 500, body: "<html>" }, 502, "backend_unavailable"],
    [new TypeError("fetch failed"), 503, "backend_unavailable"],
    [Object.assign(new Error("t"), { name: "TimeoutError" }), 503, "backend_unavailable"],
    [{ status: 200, body: "not json at all" }, 502, "backend_unavailable"],
  ];
  for (const [reply, status, code] of cases) {
    const { f } = mockFetch(() => reply);
    const e = await rejects(api.ownerFetch("socia", "people", "vansh", {}, f), status, code);
    if (code === "last_admin") assert.match(e.message, /last active admin in Socia/);
  }
  const { f } = mockFetch(() => ({ status: 409, body: { error: "last_admin" } }));
  const e = await rejects(api.ownerFetch("samvadia", "people", "vansh", {}, f), 409, "last_admin");
  assert.match(e.message, /last active super admin in Assignment desk/);
  // Other conflicts stay 409; an odd code is not passed on
  await rejects(api.ownerFetch("socia", "people", "vansh", {}, mockFetch(() => ({ status: 409, body: { error: "busy", message: "Try again" } })).f), 409, "busy");
  await rejects(api.ownerFetch("socia", "people", "vansh", {}, mockFetch(() => ({ status: 409, body: { error: "x".repeat(500) } })).f), 409, "conflict");
  await rejects(api.ownerFetch("socia", "people", "vansh", {}, mockFetch(() => ({ status: 400, body: { error: "<script>" } })).f), 400, "bad_request");
});

await test("writes: no confirmation means outcome unknown; a refused connection means not sent", async () => {
  configure();
  const write = { method: "PATCH", body: { active: false } };
  const refused = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
  const cases: [Reply, number, string][] = [
    [Object.assign(new Error("t"), { name: "TimeoutError" }), 502, "outcome_unknown"],
    [Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } }), 502, "outcome_unknown"],
    [{ status: 500, body: { error: "internal" } }, 502, "outcome_unknown"],
    [{ status: 200, body: "not json" }, 502, "outcome_unknown"],
    [refused, 503, "backend_unavailable"],
  ];
  for (const [reply, status, code] of cases) {
    const err = await rejects(api.ownerFetch("socia", `people/${ID(2)}`, "vansh", write, mockFetch(() => reply).f), status, code);
    if (code === "outcome_unknown") assert.match(err.message, /may or may not have been saved/);
  }
});

// ─── getPeople / history / writes ───────────────────────────────────────────

const OWNER = { u: "vansh", r: "owner" as const, iat: 0, exp: 0 };
const DESK_PEOPLE = {
  system: "samvadia",
  catalogue: [
    { key: "page.inbox", group: "pages", label: "Inbox", description: "", appliesTo: ["super_admin", "admin"] },
    { key: "desk.review", group: "actions", label: "Review stories", description: "" },
  ],
  roles: [{ key: "super_admin", label: "Super admin" }],
  users: [{ id: ID(1), username: "ravi", name: "Ravi", email: null, role: "super_admin", roleLabel: "Super admin", active: true, lastLoginAt: null, overrides: [{ permission: "desk.review", allowed: false }] }],
};
const SOCIA_PEOPLE = {
  system: "socia",
  catalogue: [{ key: "posts.publish", group: "actions", label: "Publish", description: "" }],
  roles: [{ key: "admin", label: "Admin" }],
  users: [{ id: ID(2), username: null, name: "Ravi K", email: "ravi@socia.app", role: "admin", roleLabel: "Admin", active: true, lastLoginAt: "2026-10-30T09:00:00Z", overrides: [] }],
};
const backends = (url: string): Reply => (url.startsWith("https://desk.test") ? { status: 200, body: DESK_PEOPLE } : { status: 200, body: SOCIA_PEOPLE });

await test("getPeople joins both systems and never returns a key", async () => {
  configure();
  const { f } = mockFetch(backends);
  const out = await people.getPeople(OWNER, f);
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].samvadia?.overrides.length, 1);
  assert.equal(out.rows[0].socia?.email, "ravi@socia.app");
  const desk = out.systems.samvadia.connected ? out.systems.samvadia.catalogue : [];
  const soc = out.systems.socia.connected ? out.systems.socia.catalogue : [];
  assert.deepEqual(desk.map((c) => c.appliesTo), [["super_admin", "admin"], null], "appliesTo kept; absent -> null");
  assert.deepEqual(soc.map((c) => c.appliesTo), [null]);
  assert.ok(out.systems.samvadia.connected && out.systems.socia.connected);
  neverHasKey(JSON.stringify(out));
});

await test("getPeople still works when one system is unconfigured or down", async () => {
  configure({ socia: true });
  const { f, calls } = mockFetch(backends);
  const out = await people.getPeople(OWNER, f);
  assert.equal(calls.length, 1, "only Socia is called");
  assert.equal(out.systems.samvadia.connected, false);
  assert.equal(!out.systems.samvadia.connected && out.systems.samvadia.reason, "not_configured");
  assert.deepEqual(out.rows.map((r) => [r.samvadia, r.socia?.id]), [[null, ID(2)]]);
  assert.deepEqual(out.nearMatches, []);
  configure();
  const down = mockFetch((url) => (url.startsWith("https://socia.test") ? new TypeError("fetch failed") : backends(url)));
  const out2 = await people.getPeople(OWNER, down.f);
  assert.equal(!out2.systems.socia.connected && out2.systems.socia.reason, "unreachable");
  assert.equal(out2.rows.length, 1);
  neverHasKey(JSON.stringify(out2));
});

await test("getHistory merges both systems, reports a missing one, and pages with opaque cursors", async () => {
  configure();
  const desk = (at: string) => ({ at, actor: "ada", action: "user.edit", target: { id: ID(1), name: "Ravi" }, before: { role: "admin" }, after: { role: "super_admin" } });
  const { f, calls } = mockFetch((url) => {
    if (url.startsWith("https://socia.test")) return { status: 500 };
    return url.includes("cursor=")
      ? { status: 200, body: { entries: [desk("2026-10-29T10:00:00Z")], next: null } }
      : { status: 200, body: { entries: [desk("2026-10-30T10:00:00Z"), { ...desk("2026-10-30T11:00:00Z"), actor: "owner:vansh", actorKind: "owner" }], next: "desk-page-2" } };
  });
  const out = await people.getHistory(OWNER, { limit: 2 }, f);
  assert.deepEqual(out.entries.map((e) => [e.at, e.actorKind]), [["2026-10-30T11:00:00Z", "owner"], ["2026-10-30T10:00:00Z", null]]);
  assert.deepEqual(out.missing.map((m) => m.system), ["socia"]);
  assert.ok(calls[0].url.endsWith("/owner/history?limit=2"));
  assert.ok(out.next);
  neverHasKey(out.next!);
  // Next page: Sentry's cursor goes back through historyQuery, each system gets its own cursor
  const q = people.historyQuery(new URL(`http://x/api/people/history?limit=2&cursor=${out.next}`));
  // Socia failed on page 1, so it has no place yet: it is asked again, from its newest entry
  assert.deepEqual(q.cursor, { samvadia: "desk-page-2", socia: true });
  const out2 = await people.getHistory(OWNER, q, f);
  const page2 = calls.slice(2).map((c) => c.url);
  assert.ok(page2.some((u) => u.endsWith("desk.test:8000/owner/history?limit=2&cursor=desk-page-2")));
  assert.ok(page2.some((u) => u.endsWith("socia.test:8200/owner/history?limit=2")), "Socia retried without a cursor");
  assert.equal(out2.entries.length, 1);
  assert.deepEqual(out2.missing.map((m) => m.system), ["socia"]);
  assert.ok(out2.next, "Socia still owes its history");
  const q3 = people.historyQuery(new URL(`http://x/?cursor=${out2.next}`));
  assert.deepEqual(q3.cursor, { samvadia: null, socia: true });
  // Once Socia answers with no more pages, there is nothing left
  const ok = mockFetch(() => ({ status: 200, body: { entries: [], next: null } }));
  const out3 = await people.getHistory(OWNER, q3, ok.f);
  assert.equal(ok.calls.length, 1, "Assignment desk is done and not asked again");
  assert.equal(out3.next, null);
  assert.throws(() => people.historyQuery(new URL("http://x/api/people/history?cursor=not*valid")), /cursor is not valid/);
  assert.throws(() => people.historyQuery(new URL(`http://x/api/people/history?cursor=${Buffer.from('{"other":"x"}').toString("base64url")}`)), /cursor is not valid/);
  assert.throws(() => people.historyQuery(new URL("http://x/api/people/history?limit=500")), /between 1 and 200/);
});

await test("permissions: role defaults filled where the backend leaves them out", async () => {
  configure();
  const { f } = mockFetch(() => ({
    status: 200,
    body: { role: "admin", permissions: [{ key: "a", allowed: true, source: "role" }, { key: "b", allowed: false, source: "override" }, { key: "c", allowed: true, source: "override", roleAllowed: false }] },
  }));
  const out = await people.getPermissions(OWNER, "samvadia", ID(1), f);
  assert.deepEqual(
    out.permissions.map((p) => p.roleAllowed),
    [true, null, false]
  );
});

await test("writes are logged before the call and with the outcome, never with browser text", async () => {
  configure();
  store.store().actionLog.length = 0;
  infoLines.length = 0;
  const { f } = mockFetch(() => ({ status: 200, body: { user: { id: ID(2), name: "Ravi K", role: "admin", roleLabel: "Admin", active: false } } }));
  await people.patchPerson(OWNER, "socia", ID(2), { active: false }, f);
  const put = mockFetch(() => ({ status: 200, body: { role: "admin", permissions: [{ key: "a", allowed: true, source: "override" }] } }));
  await people.putOverrides(OWNER, "socia", ID(2), [{ permission: "a", allowed: true }], put.f);
  assert.deepEqual(put.calls[0].body, '{"overrides":[{"permission":"a","allowed":true}]}');
  // A failure and an unreadable reply are logged too
  await assert.rejects(people.patchPerson(OWNER, "socia", ID(2), { role: "admin" }, mockFetch(() => ({ status: 409, body: { error: "last_admin" } })).f));
  await assert.rejects(people.patchPerson(OWNER, "socia", ID(2), { active: true }, mockFetch(() => ({ status: 200, body: { user: { nope: 1 } } })).f), /may or may not/);
  const S = `Socia ${ID(2)}`;
  const log = store.store().actionLog.map((a) => [a.user, a.kind, a.text]);
  assert.deepEqual(log, [
    ["vansh", "people", `${S}: asked to turn off`],
    ["vansh", "people", `${S}: Ravi K is now off, Admin`],
    ["vansh", "people", `${S}: asked to set 1 exception to the role`],
    ["vansh", "people", `${S}: done, 1 exception to role admin`],
    ["vansh", "people", `${S}: asked to set role admin`],
    ["vansh", "people", `${S}: set role admin failed (last_admin)`],
    ["vansh", "people", `${S}: asked to turn on`],
    ["vansh", "people", `${S}: turn on failed (outcome_unknown)`],
  ]);
  assert.equal(infoLines.length, log.length, "each line also goes to the server log");
  infoLines.forEach(neverHasKey);
});

await test("error bodies from either backend read as one {code, message}", () => {
  assert.deepEqual(api.readBackendError({ error: "last_admin", message: "Last one" }), { code: "last_admin", message: "Last one" });
  assert.deepEqual(api.readBackendError({ detail: [{ loc: ["body", "overrides", 0, "allowed"], msg: "Input should be a valid boolean" }] }), { code: "invalid", message: "overrides.0.allowed: Input should be a valid boolean" });
  assert.deepEqual(api.readBackendError({ detail: "Not Found" }), { code: "", message: "Not Found" });
  assert.deepEqual(api.readBackendError("<html>"), { code: "", message: "" });
});

await test("body and id checks", () => {
  assert.deepEqual(people.parsePeoplePatch({ role: "editor", active: true }), { role: "editor", active: true });
  assert.throws(() => people.parsePeoplePatch({}), /Nothing to change/);
  assert.throws(() => people.parsePeoplePatch({ active: "no" }), /true or false/);
  assert.throws(() => people.parsePeoplePatch({ role: "x", name: "y" }), /Unknown field: name/);
  assert.deepEqual(people.parseOverrides({ overrides: [] }), []);
  assert.throws(() => people.parseOverrides({ overrides: [{ permission: "a", allowed: true }, { permission: "a", allowed: false }] }), /twice/);
  assert.throws(() => people.parseOverrides({ overrides: [{ permission: "a", allowed: 1 }] }), /true or false/);
  assert.throws(() => people.parseOverrides({ overrides: [], extra: 1 }), /Send/);
  assert.throws(() => people.personId("../../etc"), /not valid/);
  assert.equal(people.personId(ID(3).toUpperCase()), ID(3));
  assert.throws(() => people.systemParam("other"), /Unknown system/);
});

// ─── Client helpers ─────────────────────────────────────────────────────────

await test("filterRows: words, system, status and role", () => {
  const rows = match.matchPeople(
    [u({ id: "d1", username: "ravi", name: "Ravi Sharma", role: "admin" }), u({ id: "d2", username: "neha", name: "Neha", role: "reporter", active: false })],
    [u({ id: "s1", name: "Ravi", email: "ravi@socia.app", role: "editor" }), u({ id: "s2", name: "Pooja", email: "pooja@socia.app" })]
  );
  const names = (f: Partial<import("../lib/people").RowFilter>) => lib.filterRows(rows, { ...lib.NO_FILTER, ...f }).map((r) => r.name);
  assert.deepEqual(names({ q: "SOCIA.app" }), ["Pooja", "Ravi Sharma"]);
  assert.deepEqual(names({ q: "ravi sharma" }), ["Ravi Sharma"]);
  assert.deepEqual(names({ system: "both" }), ["Ravi Sharma"]);
  assert.deepEqual(names({ system: "one" }), ["Neha", "Pooja"]);
  assert.deepEqual(names({ system: "socia" }), ["Pooja", "Ravi Sharma"]);
  assert.deepEqual(names({ status: "disabled" }), ["Neha"]);
  assert.deepEqual(names({ status: "active" }), ["Pooja", "Ravi Sharma"]);
  assert.deepEqual(names({ role: "socia:editor" }), ["Ravi Sharma"]);
  assert.deepEqual(names({ role: "socia:editor:x" }), [], "the role key is everything after the first colon");
  assert.deepEqual(names({ role: "nonsense" }), []);
});

await test("draft: back to the role drops the exception; unknown role default keeps it", () => {
  const role = { key: "a", allowed: true, source: "role" as const, roleAllowed: true };
  const known = { key: "b", allowed: false, source: "override" as const, roleAllowed: true };
  const unknown = { key: "c", allowed: false, source: "override" as const, roleAllowed: null };
  let d = lib.draftFrom([role, known, unknown]);
  assert.deepEqual(d, { b: false, c: false });
  d = lib.setKey(d, role, false);
  assert.deepEqual(d, { a: false, b: false, c: false });
  d = lib.setKey(d, role, true);
  d = lib.setKey(d, known, true);
  assert.deepEqual(d, { c: false });
  d = lib.setKey(d, unknown, true);
  assert.deepEqual(d, { c: true }, "kept as an exception with the new value");
  assert.equal(lib.effective(unknown, d), true);
  assert.deepEqual(lib.draftList(lib.dropKey(d, "c")), []);
  assert.ok(lib.sameDraft({ x: true, y: false }, { y: false, x: true }));
  assert.ok(!lib.sameDraft({ x: true }, { x: false }));
});

await test("planSave: role first, exceptions alone, hidden exceptions kept", () => {
  const user = { role: "assignment_desk", active: true };
  const saved = { "users.manage": true, "desk.fetch": false }; // users.manage is hidden for this role (appliesTo)
  // Changing another key keeps the hidden exception in the full list that is sent
  const fetchKey = { key: "desk.fetch", allowed: false, source: "override" as const, roleAllowed: true };
  const draft = lib.setKey(saved, fetchKey, true);
  assert.deepEqual(lib.planSave({ user, nextRole: user.role, nextActive: true, saved, draft }), { patch: null, overrides: [{ permission: "users.manage", allowed: true }] });
  // Nothing changed
  assert.ok(!lib.hasChanges(lib.planSave({ user, nextRole: user.role, nextActive: true, saved, draft: { ...saved } })));
  // Not loaded yet: never sends exceptions
  assert.equal(lib.planSave({ user, nextRole: user.role, nextActive: true, saved: null, draft: {} }).overrides, null);
  // Role change: PATCH only, exceptions wait
  assert.deepEqual(lib.planSave({ user, nextRole: "admin", nextActive: true, saved, draft }), { patch: { role: "admin" }, overrides: null });
  // Turning off and changing exceptions: PATCH then PUT
  assert.deepEqual(lib.planSave({ user, nextRole: user.role, nextActive: false, saved, draft: {} }), { patch: { active: false }, overrides: [] });
});

await test("history in words", () => {
  const label = (k: string) => ({ "desk.review": "Review stories" })[k] ?? k;
  assert.deepEqual(lib.describeChange({ role: "admin", active: true, name: "R" }, { role: "editor", active: false, name: "R" }), ["role: admin → editor", "account: on → off"]);
  assert.deepEqual(lib.describeChange({ overrides: [{ permission: "desk.review", allowed: true }] }, { overrides: [] }, label), ["reset to the role"]);
  assert.deepEqual(
    lib.describeChange({ overrides: [{ permission: "a", allowed: true }] }, { overrides: [{ permission: "desk.review", allowed: false }] }, label),
    ["a: back to the role", "Review stories: blocked"]
  );
  assert.deepEqual(lib.describeChange({ permission: "desk.review", allowed: true }, { permission: "desk.review", allowed: false }, label), ["Review stories: blocked"]);
  assert.equal(lib.actorWords("owner:vansh", "owner"), "vansh");
  assert.equal(lib.actorWords("owner:vansh", "user"), "owner:vansh", "never guessed from the text");
  assert.equal(lib.actorWords("Ada Admin"), "Ada Admin");
  assert.equal(lib.actorWords(null), "Someone");
  assert.equal(lib.actionWords("user.deactivated"), "turned off");
});

// ─── Routes: owners only ────────────────────────────────────────────────────

const PW = "correct horse battery";
const hash = await hashPassword(PW);
writeFileSync(
  users.USERS_FILE,
  JSON.stringify([
    { username: "vansh", name: "Vansh", role: "owner", passwordHash: hash },
    { username: "ada", name: "Ada Admin", role: "admin", passwordHash: hash },
  ])
);
writeFileSync(live.SESSIONS_FILE, "[]");
const BASE = "http://localhost:3005";
function req(pathname: string, init: { method?: string; cookie?: string; body?: unknown } = {}) {
  const headers = new Headers({ host: "localhost:3005", origin: BASE, "content-type": "application/json", "user-agent": "test" });
  if (init.cookie) headers.set("cookie", init.cookie);
  return new Request(BASE + pathname, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}
async function signIn(username: string, ip: string) {
  const res = await session.login(new Request(`${BASE}/api/auth/login`, { method: "POST", headers: { host: "localhost:3005", "x-forwarded-for": ip, "user-agent": "test" } }), { username, password: PW });
  assert.equal(res.status, 200, `sign in as ${username}`);
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}
const ctx = (system: string, id: string) => ({ params: Promise.resolve({ system, id }) });

await test("routes: admins get 403, owners get the list, the key never reaches the browser", async () => {
  configure();
  const real = globalThis.fetch;
  const { f, calls } = mockFetch(backends);
  globalThis.fetch = f;
  try {
    const admin = await signIn("ada", "10.1.0.1");
    const owner = await signIn("vansh", "10.1.0.2");
    const denied = await peopleRoute.GET(req("/api/people", { cookie: admin }));
    assert.equal(denied.status, 403);
    assert.equal(calls.length, 0, "no backend call for a non-owner");
    const patchDenied = await patchRoute.PATCH(req(`/api/people/socia/${ID(2)}`, { method: "PATCH", cookie: admin, body: { active: false } }), ctx("socia", ID(2)));
    assert.equal(patchDenied.status, 403);
    const ok = await peopleRoute.GET(req("/api/people", { cookie: owner }));
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get("cache-control") ?? "", /no-store/);
    const text = await ok.text();
    neverHasKey(text);
    assert.equal(calls[0].headers.get("x-owner-actor"), "vansh");
    const badId = await patchRoute.PATCH(req("/api/people/socia/nope", { method: "PATCH", cookie: owner, body: { active: false } }), ctx("socia", "nope"));
    assert.equal(badId.status, 400);
    const badSys = await overridesRoute.PUT(req(`/api/people/x/${ID(2)}/overrides`, { method: "PUT", cookie: owner, body: { overrides: [] } }), ctx("x", ID(2)));
    assert.equal(badSys.status, 404);
  } finally {
    globalThis.fetch = real;
  }
});

await test("routes: 409 last_admin passes through with its code", async () => {
  configure();
  const real = globalThis.fetch;
  globalThis.fetch = mockFetch(() => ({ status: 409, body: { error: "last_admin", message: "x" } })).f;
  try {
    const owner = await signIn("vansh", "10.1.0.3");
    const res = await patchRoute.PATCH(req(`/api/people/socia/${ID(2)}`, { method: "PATCH", cookie: owner, body: { active: false } }), ctx("socia", ID(2)));
    assert.equal(res.status, 409);
    const body = (await res.json()) as { error: string; message: string };
    assert.equal(body.error, "last_admin");
    neverHasKey(body.message);
  } finally {
    globalThis.fetch = real;
  }
});

process.chdir(tmpdir());
rmSync(dir, { recursive: true, force: true });
console.log(`people.test: ${passed} passed`);
