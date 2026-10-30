// Run: node --no-warnings src/server/ai/verifyNumbers.test.ts   (Node 22.6+ strips the types itself)
// Imported by URL so tsc does not need allowImportingTsExtensions.
import assert from "node:assert/strict";

const mod = (await import(new URL("./verifyNumbers.ts", import.meta.url).href)) as typeof import("./verifyNumbers");
const { verifyNumbers } = mod;

let passed = 0;
function check(name: string, text: string, facts: Parameters<typeof verifyNumbers>[1], expected: string[]) {
  assert.deepEqual(verifyNumbers(text, facts), expected, name);
  passed++;
}

// Ids and timestamps no longer whitelist numbers: only numeric facts and verbatim quotes count.
check("timestamp does not whitelist minutes", "45 errors today", { values: { errors: 16 }, quotable: ["2026-10-27T16:45:12+05:30"] }, ["45"]);
check("id does not whitelist its digits", "7 alerts", { values: { alerts: 6 }, quotable: ["INC-0007"] }, ["7"]);
check("known count passes", "16 errors and 3 warnings", { values: { errors: 16, warn: 3 } }, []);
check("nested numeric leaves", "22 posts, 82% used", { values: { s: { xPosts: 22 }, cap: [{ pct: 82 }] } }, []);
check("decimals compare by value", "uptime 99.2%", { values: { up: 99.2 } }, []);

// Units glued to the number still count.
check("99min", "waited 99min", { values: { m: 38 } }, ["99"]);
check("99th", "the 99th story", { values: {} }, ["99"]);
check("3.5x", "3.5x slower", { values: {} }, ["3.5"]);
check("unit ok when known", "waited 38min", { values: { m: 38 } }, []);

// Devanagari digits, alone and glued to Devanagari words.
check("Devanagari digits", "१२ मिनट तक", { values: { m: 13 } }, ["12"]);
check("Devanagari digits known", "१२ मिनट तक", { values: { m: 12 } }, []);
check("digits glued to Devanagari", "12मिनट बंद रहा", { values: {} }, ["12"]);

// Thousands separators, western and Indian.
check("western grouping", "1,234 requests", { values: { r: 1234 } }, []);
check("Indian grouping", "1,23,456 views", { values: { v: 123456 } }, []);
check("Indian grouping unknown", "12,34,567 views", { values: { v: 123456 } }, ["12,34,567"]);
check("list commas are separate numbers", "rooms 3, 4", { values: { a: 3, b: 4 } }, []);

// Names with digits are not numbers.
check("model name", "Qwen3 wrote this on mp4 files", { values: {} }, []);

// HH:MM times must be quoted from the facts as whole tokens.
check("quoted time passes", "blind 11:40 to 11:52", { values: {}, quotable: ["11:40", "11:52"] }, []);
check("unquoted time is flagged whole", "back at 11:58", { values: { a: 11, b: 58 }, quotable: ["11:40"] }, ["11:58"]);
check("time not split into parts", "since 09:14", { values: {}, quotable: [] }, ["09:14"]);

// Slugs and ids quoted verbatim are skipped; a bare number quote is not allowed.
check("slug skipped", "271026_JPR_RAIN_AV_POOJA failed 3 times", { values: { n: 3 }, quotable: ["271026_JPR_RAIN_AV_POOJA"] }, []);
check("unquoted slug digits flagged", "271026_JPR_RAIN_AV_POOJA failed", { values: {} }, ["271026"]);
check("bare-number quote ignored", "45 errors", { values: {}, quotable: ["45"] }, ["45"]);
check("quoted title with numbers", "Open: 2 FTP uploads from Ajmer failed (files over 500 MB).", { values: {}, quotable: ["2 FTP uploads from Ajmer failed (files over 500 MB)"] }, []);

console.log(`verifyNumbers: ${passed} checks passed`);
