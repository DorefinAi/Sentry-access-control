// Phase 1 runs on a frozen clock so the static world never goes stale.
// Every time in the data is IST (+05:30) and built through these helpers.

export const TODAY = "2026-10-27";
export const YESTERDAY = "2026-10-26";
export const NOW = "2026-10-27T16:30:00+05:30";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// at("11:40") -> "2026-10-27T11:40:00+05:30"
export function at(time: string, date: string = TODAY): string {
  const t = time.length === 5 ? `${time}:00` : time;
  return `${date}T${t}+05:30`;
}

export function ms(iso: string): number {
  return Date.parse(iso);
}

export function ist(epochMs: number): string {
  return new Date(epochMs + IST_OFFSET_MS).toISOString().slice(0, 19) + "+05:30";
}

export function addMin(iso: string, minutes: number): string {
  return ist(ms(iso) + minutes * 60_000);
}

export function minutesBetween(from: string, to: string): number {
  return Math.round((ms(to) - ms(from)) / 60_000);
}

// Only for times this module produced (already IST).
export function hhmm(iso: string): string {
  return iso.slice(11, 16);
}

export function dateOf(iso: string): string {
  return iso.slice(0, 10);
}

export function minutesAgo(iso: string): number {
  return minutesBetween(iso, NOW);
}
