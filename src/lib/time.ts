// Relative times for reading at a glance, exact IST for the tooltip.
import { serverNow } from "./clock";

const IST = "Asia/Kolkata";

const exactFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: IST,
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
const clockFmt = new Intl.DateTimeFormat("en-IN", { timeZone: IST, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const dayFmt = new Intl.DateTimeFormat("en-IN", { timeZone: IST, weekday: "short", day: "numeric", month: "short", year: "numeric" });

export const exactIst = (iso: string) => `${exactFmt.format(new Date(iso))} IST`;
export const clockIst = (iso: string) => clockFmt.format(new Date(iso));
export const dayLabel = (yyyyMmDd: string) => dayFmt.format(new Date(`${yyyyMmDd}T12:00:00+05:30`));

export function relative(iso: string, now: number): string {
  const diff = Math.round((now - new Date(iso).getTime()) / 1000);
  const future = diff < 0;
  const s = Math.abs(diff);
  let text: string;
  if (s < 45) text = `${s} s`;
  else if (s < 3600) text = `${Math.round(s / 60)} min`;
  else if (s < 86400) {
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    text = m && h < 6 ? `${h} h ${m} min` : `${h} h`;
  } else text = `${Math.round(s / 86400)} d`;
  if (s < 10) return "just now";
  return future ? `in ${text}` : `${text} ago`;
}

export function duration(sec: number): string {
  if (sec < 60) return `${sec} s`;
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  return `${Math.floor(sec / 3600)} h ${Math.round((sec % 3600) / 60)} min`;
}

// Today in IST as YYYY-MM-DD
export function todayIst(now = serverNow()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(new Date(now));
}

export type RangePreset = "15m" | "1h" | "6h" | "24h" | "today" | "all";
export const RANGE_LABELS: Record<RangePreset, string> = {
  "15m": "Last 15 min",
  "1h": "Last hour",
  "6h": "Last 6 hours",
  "24h": "Last 24 hours",
  today: "Today",
  all: "Any time",
};

export function rangeToWindow(r: RangePreset, now = serverNow()): { from?: string; to?: string } {
  const back = (ms: number) => ({ from: new Date(now - ms).toISOString() });
  switch (r) {
    case "15m":
      return back(15 * 60e3);
    case "1h":
      return back(3600e3);
    case "6h":
      return back(6 * 3600e3);
    case "24h":
      return back(24 * 3600e3);
    case "today":
      return { from: `${todayIst(now)}T00:00:00+05:30` };
    case "all":
      return {};
  }
}

const hmsFmt = new Intl.DateTimeFormat("en-GB", { timeZone: IST, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const hmFmt = new Intl.DateTimeFormat("en-GB", { timeZone: IST, hour: "2-digit", minute: "2-digit", hour12: false });

/** Wall clock in IST: "16:30:04". */
export const hmsIst = (ms: number) => hmsFmt.format(new Date(ms));
/** "16:30" in IST. */
export const hmIst = (msOrIso: number | string) => hmFmt.format(new Date(msOrIso));

/** Elapsed time as a console counter: "02:14:09" (hours keep growing past 24). */
export function counter(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** A streak in the fewest honest words: "38m", "4h 38m", "3d 4h", "19 d". */
export function streak(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d >= 7) return `${d} d`;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Midnight IST of the day containing `ms`, as epoch ms. */
export function istMidnight(ms: number): number {
  return Date.parse(`${todayIst(ms)}T00:00:00+05:30`);
}

/** A long-running counter: "04:38:12", or "2d 04:38:12" past a day. */
export function upCounter(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const d = Math.floor(s / 86400);
  return d ? `${d}d ${counter(s % 86400)}` : counter(s);
}
