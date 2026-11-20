// The real clock, in IST. Every server module reads "now" from here so tests can move it
// (setClockForTests) and nothing anywhere runs on a frozen demo time.
const IST_OFFSET_MS = 5.5 * 3600_000;

const g = globalThis as typeof globalThis & { __sentryClock?: (() => number) | null };

/** Epoch ms now (tests may replace the clock). */
export const nowMs = (): number => (g.__sentryClock ? g.__sentryClock() : Date.now());

/** For tests only: pin or move the clock; null puts the real clock back. */
export function setClockForTests(fn: (() => number) | null): void {
  g.__sentryClock = fn;
}

/** An epoch ms as ISO 8601 in IST: "2026-11-20T14:02:11+05:30". */
export function ist(epochMs: number): string {
  return new Date(epochMs + IST_OFFSET_MS).toISOString().slice(0, 19) + "+05:30";
}

export const nowIso = (): string => ist(nowMs());

export const ms = (iso: string): number => Date.parse(iso);

/** The IST calendar date (YYYY-MM-DD) of an epoch ms or an ISO time with any offset. */
export function istDate(t: number | string): string {
  const m = typeof t === "number" ? t : Date.parse(t);
  return new Date(m + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export const todayIst = (): string => istDate(nowMs());

/** The IST hour (0-23) of an epoch ms or ISO time. */
export function istHour(t: number | string): number {
  const m = typeof t === "number" ? t : Date.parse(t);
  return new Date(m + IST_OFFSET_MS).getUTCHours();
}

/** "14:02" in IST for any ISO time or epoch ms. */
export function hhmm(t: number | string): string {
  const m = typeof t === "number" ? t : Date.parse(t);
  return new Date(m + IST_OFFSET_MS).toISOString().slice(11, 16);
}

/** Midnight IST of a YYYY-MM-DD date, as epoch ms. */
export const dayStartMs = (date: string): number => Date.parse(`${date}T00:00:00+05:30`);

export const minutesBetween = (from: string | number, to: string | number): number =>
  Math.round(((typeof to === "number" ? to : Date.parse(to)) - (typeof from === "number" ? from : Date.parse(from))) / 60_000);

/** The day before a YYYY-MM-DD date. */
export const previousDate = (date: string): string => istDate(dayStartMs(date) - 12 * 3600_000);
