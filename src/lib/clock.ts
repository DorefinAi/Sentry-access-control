// "Now" as the server sees it. Phase 1 serves a frozen world (NOW is fixed in
// src/data), so relative times and time-range filters must count from the
// server's clock, not the browser's. Later phases make the offset ~0.
let offsetMs = 0;
let synced = false;
const listeners = new Set<() => void>();

export function serverNow(): number {
  return Date.now() + offsetMs;
}

export function syncClock(serverIso: string | null) {
  const next = serverIso ? Date.parse(serverIso) - Date.now() : 0;
  // Ignore jitter from request latency
  const changed = !synced || Math.abs(next - offsetMs) > 2000;
  if (!Number.isNaN(next) && serverIso) offsetMs = next;
  synced = true;
  if (changed) listeners.forEach((l) => l());
}

export function subscribeClock(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export const isClockSynced = () => synced;
export const clockOffset = () => offsetMs;
