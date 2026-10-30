// Run: node --no-warnings src/lib/safeNext.test.ts   (Node 22.6+ strips the types itself)
// Imported by URL so tsc does not need allowImportingTsExtensions.
import assert from "node:assert/strict";

const mod = (await import(new URL("./safeNext.ts", import.meta.url).href)) as typeof import("./safeNext");
const { safeNext } = mod;

const ORIGIN = "http://localhost:3005";
// What useSearchParams().get("next") returns for a raw query string: decoded once.
const fromQuery = (qs: string) => new URLSearchParams(qs).get("next");

let passed = 0;
function check(name: string, raw: string | null, expected: string | null) {
  assert.equal(safeNext(raw, ORIGIN), expected, name);
  passed++;
}

// Allowed: plain paths on this origin, with query and hash kept.
check("plain path", "/alerts", "/alerts");
check("query and hash", "/logs?level=error#top", "/logs?level=error#top");
check("encoded slashes stay a local path", "/%2F%2Fevil.com", "/%2F%2Fevil.com");

// The finding: a tab between the slashes used to leave the site.
check("tab trick from the review", fromQuery("next=%2F%09%2Fevil.com"), null);
check("newline trick", fromQuery("next=%2F%0A%2Fevil.com"), null);
check("carriage return", "/\r/evil.com", null);
check("C1 control", "/\u0085/evil.com", null);
check("DEL", "/\u007f/evil.com", null);

// Other ways off the site.
check("protocol-relative", "//evil.com", null);
check("backslash", "/\\evil.com", null);
check("encoded backslash decoded by the query", fromQuery("next=%2F%5Cevil.com"), null);
check("absolute other origin", "https://evil.com/x", null);
check("absolute same origin is still not a path", `${ORIGIN}/alerts`, null);
check("other port on this host", "http://localhost:3000/", null);
check("javascript scheme", "javascript:alert(1)", null);
check("data scheme", "data:text/html,hi", null);
check("relative without slash", "evil.com", null);
check("dot segments resolve on this origin", "/../../alerts", "/alerts");

// Never back to the login page, and nothing for nothing.
check("login", "/login", null);
check("login with next", "/login?next=/x", null);
check("login subpath", "/login/again", null);
check("empty", "", null);
check("null", null, null);

console.log(`safeNext: ${passed} checks passed`);
