// Removes secrets and personal details from backend log lines before Sentry stores them
// (dev-docs/ops-logs-contract.md section 3). The backends redact first; this is the second pass,
// so a backend that forgets cannot put a password into Sentry's database.

const R = "[redacted]";
const SECRET_KEY = /pass(?:word)?|secret|token|api[_-]?key|authorization|cookie|session|otp|signature/i;

const RULES: [RegExp, string | ((...m: string[]) => string)][] = [
  // Authorization / Cookie headers: everything after the separator, to the end of the line
  [/\b((?:proxy-)?authorization|set-cookie|cookie)(\\?["']?\s*[=:]\s*)(?!\s*\[redacted\])[^\r\n]+/gi, `$1$2${R}`],
  // key=value, key: value, "key": "value", 'key': 'value', \"key\": \"value\", "key": 123 — the quote style is kept
  [
    /(\\?["']?)([\w.-]*(?:pass(?:word)?|secret|token|api[_-]?key|authorization|cookie|session|otp|signature)[\w.-]*)(\\?["']?)(\s*[=:]\s*)(?!\s*\\?["']?\[redacted\])(\\"(?:[^\\]|\\(?!"))*?\\"|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|(?:(?:Bearer|Basic|Token)\s+)?[^\s&,;"'}\]]+)/gi,
    (_m: string, q1: string, key: string, q2: string, sep: string, value: string) => {
      const quoted = value.startsWith('\\"') ? `\\"${R}\\"` : value.startsWith('"') ? `"${R}"` : value.startsWith("'") ? `'${R}'` : R;
      return `${q1}${key}${q2}${sep}${quoted}`;
    },
  ],
  // Bearer / Basic credentials
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g, `$1 ${R}`],
  // JWT-shaped tokens
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, R],
  // user:pass@ in URLs
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, `$1${R}@`],
  // emails: a***@domain
  [/\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, "$1***@$2"],
  // phone numbers, 10+ digits (spaces / dashes allowed), keep the last 4
  [
    /(?<![\w-])(\+?)(\d[\d -]{8,}\d)(?![\w])/g,
    (_m: string, plus: string, num: string) => {
      const digits = num.replace(/\D/g, "");
      if (digits.length < 10 || digits.length > 15) return _m;
      return `${plus}${"*".repeat(digits.length - 4)}${digits.slice(-4)}`;
    },
  ],
];

export function redactText(text: string): string {
  let out = text;
  for (const [re, to] of RULES) out = out.replace(re, to as string);
  return out;
}

export type FieldValue = string | number | boolean | null;

/** Scalars only, at most 20 keys; secret-named keys lose their value, strings are redacted. */
export function redactFields(fields: unknown): Record<string, FieldValue> | null {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return null;
  const out: Record<string, FieldValue> = {};
  let n = 0;
  for (const [k, v] of Object.entries(fields as Record<string, unknown>)) {
    if (n >= 20) break;
    if (typeof k !== "string" || k.length > 64) continue;
    if (v !== null && typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") continue;
    out[k] = SECRET_KEY.test(k) ? R : typeof v === "string" ? redactText(v.slice(0, 500)) : v;
    n++;
  }
  return n ? out : null;
}
