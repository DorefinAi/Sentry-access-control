// The guard against invented numbers. Phase 1 text comes from templates, so it should always
// return []; in Phase 2 Qwen writes the text and this is what catches a made-up count.
//
// The caller passes curated facts, not raw records:
// - values: the numbers the text may state (numeric leaves anywhere in the object are collected;
//   strings are ignored, so ids and timestamps cannot whitelist "45" or "2026").
// - quotable: formatted strings the text may repeat verbatim (HH:MM times, slugs, ids, titles,
//   names). Digits inside a verbatim quote are not checked.

export interface Facts {
  values?: unknown;
  quotable?: (string | null | undefined)[];
}

const DEVANAGARI_ZERO = 0x0966;

export function normaliseDigits(text: string): string {
  return text.replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - DEVANAGARI_ZERO));
}

// A number not glued to a letter or digit in front ("Qwen3", "mp4" are names, not numbers).
// Thousands separators: western 1,234,567 and Indian 1,23,456. A unit glued after it ("99min",
// "3.5x", "12मिनट") still counts as the number.
const LEAD = "(?<![\\p{L}\\p{M}\\d.,_-])";
const GROUPED = "\\d{1,2}(?:,\\d{2})+,\\d{3}|\\d{1,3}(?:,\\d{3})+";
const TIME_RE = new RegExp(`${LEAD}\\d{1,2}:\\d{2}(?::\\d{2})?(?!\\d)`, "gu");
const NUMBER_RE = new RegExp(`${LEAD}(?:${GROUPED}|\\d+)(?:\\.\\d+)?`, "gu");

function canonical(n: string): string {
  const v = Number(n.replace(/,/g, ""));
  return Number.isFinite(v) ? String(v) : n;
}

function collectNumbers(value: unknown, out: Set<string>, depth = 0): void {
  if (depth > 8) return;
  if (typeof value === "number" && Number.isFinite(value)) out.add(String(value));
  else if (Array.isArray(value)) value.forEach((v) => collectNumbers(v, out, depth + 1));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => collectNumbers(v, out, depth + 1));
}

// A quote must be more than a bare number, or quoting "45" would whitelist "45 errors".
function usableQuotes(quotable: Facts["quotable"]): string[] {
  return [...new Set((quotable ?? []).filter((q): q is string => typeof q === "string" && q.length >= 3 && /\D/.test(q)))]
    .map(normaliseDigits)
    .sort((a, b) => b.length - a.length);
}

export function verifyNumbers(text: string, facts: Facts): string[] {
  let rest = normaliseDigits(text);
  for (const q of usableQuotes(facts.quotable)) rest = rest.split(q).join(" ");

  const unverified: string[] = [];
  const flag = (n: string) => {
    if (!unverified.includes(n)) unverified.push(n);
  };

  // A time left after quotes were blanked was not one of the facts' times.
  rest = rest.replace(TIME_RE, (t) => {
    flag(t);
    return " ";
  });

  const known = new Set<string>();
  collectNumbers(facts.values, known);
  for (const n of rest.match(NUMBER_RE) ?? []) {
    if (!known.has(canonical(n))) flag(n);
  }
  return unverified;
}
