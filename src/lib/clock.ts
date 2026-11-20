// "Now" as the server sees it: relative times and time-range filters count from
// the server's clock, not the browser's, so a browser with a wrong clock still
// shows the right "2 min ago". The server runs on the real clock, so the offset
// is usually close to 0.
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
