// Redaction of backend log text (src/server/redact.ts).
// Run: node --no-warnings --import ./scripts/test-resolve.mjs src/server/redact.test.ts
import assert from "node:assert/strict";

const { redactText } = (await import(new URL("./redact.ts", import.meta.url).href)) as typeof import("./redact");

const cases: [string, string][] = [
  // The same cases as logs.test.ts
  ["login ok password=hunter2 next", "login ok password=[redacted] next"],
  ['{"api_key": "abc123", "user": "x"}', '{"api_key": "[redacted]", "user": "x"}'],
  ["Authorization: Bearer abc.def.ghi", "Authorization: [redacted]"],
  ["sent Bearer sk_live_123", "sent Bearer [redacted]"],
  ["token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghij in header", "token [redacted] in header"],
  ["GET https://u:p4ss@ftp.example.com/x", "GET https://[redacted]@ftp.example.com/x"],
  ["/cb?code=1&session=xyz&ok=1", "/cb?code=1&session=[redacted]&ok=1"],
  ["mail from pooja.sharma@example.com", "mail from p***@example.com"],
  ["whatsapp +91 98290 12345 joined", "whatsapp +********2345 joined"],
  ["story 271026_JPR_RAIN_AV_POOJA filed at 2026-10-27", "story 271026_JPR_RAIN_AV_POOJA filed at 2026-10-27"],
  // Quoted and non-string values (review finding #1)
  ["{'username': 'a', 'password': 'hunter2'}", "{'username': 'a', 'password': '[redacted]'}"],
  ['password="hunter2"', 'password="[redacted]"'],
  ["password='hunter2'", "password='[redacted]'"],
  ['token: "abc"', 'token: "[redacted]"'],
  ['{"otp": 123456}', '{"otp": [redacted]}'],
  ['body={\\"password\\": \\"hunter2\\"}', 'body={\\"password\\": \\"[redacted]\\"}'],
  ["Authorization: Token abc123def", "Authorization: [redacted]"],
  ["Cookie: a=1; b=2", "Cookie: [redacted]"],
  ["password=[redacted]", "password=[redacted]"],
  // No false positives
  ["password changed for ada", "password changed for ada"],
  ["Token expired: retrying", "Token expired: retrying"],
  ["271026_JPR_RAIN_AV_POOJA", "271026_JPR_RAIN_AV_POOJA"],
  ["at 2026-11-06T10:00:01+05:30 done", "at 2026-11-06T10:00:01+05:30 done"],
];

for (const [input, want] of cases) {
  const once = redactText(input);
  assert.equal(once, want, input);
  assert.equal(redactText(once), once, `idempotent: ${input}`);
}
console.log(`redact.test: ${cases.length} cases passed`);
