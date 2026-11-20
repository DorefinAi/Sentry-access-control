// A backend that refused Sentry's owner key (401) or is rate-limiting it (429) is left alone for a
// while, by every reader (ops pull, log sync). Hammering it every 15-30 s with a wrong or rotated key
// would trip the backend's bad-key lockout for this address, which also blocks the People page.
import type { PeopleSystem } from "@/types/people";
import { HttpError } from "./http";
import { NotConnected } from "./ownerApi";
import { hhmm, nowMs } from "./time";

export const BACKOFF_MS = 5 * 60_000;
const MAX_MS = 60 * 60_000;

interface Pause {
  until: number;
  reason: string;
}
const g = globalThis as typeof globalThis & { __sentryBackoff?: Map<PeopleSystem, Pause> };
const pauses = () => (g.__sentryBackoff ??= new Map());

/** How long to stay away after this error, or null when the error is not a refusal. */
export function backoffMs(e: unknown): number | null {
  const retryAfter = e instanceof HttpError ? (e as HttpError & { retryAfterSec?: number }).retryAfterSec : undefined;
  const refused = (e instanceof NotConnected && e.reason === "refused" && (e as NotConnected & { upstream?: number }).upstream === 401) || (e instanceof HttpError && e.status === 429);
  if (!refused) return null;
  return Math.min(MAX_MS, Math.max(BACKOFF_MS, (retryAfter ?? 0) * 1000));
}

/** Remembers a refusal; returns true when the source is now paused. */
export function noteRefusal(source: PeopleSystem, e: unknown, now = nowMs()): boolean {
  const ms = backoffMs(e);
  if (ms === null) return false;
  const until = now + ms;
  pauses().set(source, { until, reason: `${(e as Error).message} Sentry waits until ${hhmm(until)} before asking again.` });
  return true;
}

/** The pause in force for a source, or null. */
export function pausedFor(source: PeopleSystem, now = nowMs()): Pause | null {
  const p = pauses().get(source);
  if (!p) return null;
  if (now >= p.until) {
    pauses().delete(source);
    return null;
  }
  return p;
}

/** For tests. */
export function resetBackoff(): void {
  g.__sentryBackoff = new Map();
}
