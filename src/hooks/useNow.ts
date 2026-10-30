"use client";

import { useSyncExternalStore } from "react";
import { isClockSynced, serverNow, subscribeClock } from "@/lib/clock";

// One shared 15 s clock for every relative time on the page, instead of a timer per row.
let now = 0;
const listeners = new Set<() => void>();
let timer: number | undefined;
let unsubClock: (() => void) | undefined;

const tick = () => {
  now = serverNow();
  listeners.forEach((l) => l());
};

function subscribe(cb: () => void) {
  listeners.add(cb);
  // Fresh reading for the first subscriber after a quiet spell
  now = serverNow();
  if (timer === undefined) {
    timer = window.setInterval(tick, 15_000);
    unsubClock = subscribeClock(tick);
  }
  return () => {
    listeners.delete(cb);
    if (!listeners.size && timer !== undefined) {
      window.clearInterval(timer);
      unsubClock?.();
      timer = undefined;
    }
  };
}

// Read lazily so the first paint never counts from 0 (which shows "in 20754 d").
// Stable between ticks, as useSyncExternalStore requires.
const snapshot = () => {
  if (!now) now = serverNow();
  return now;
};

export function useNow(): number {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** False until the server clock has been read once (or failed to be). */
export function useClockReady(): boolean {
  return useSyncExternalStore(subscribeClock, isClockSynced, () => false);
}

// A separate one-second clock for the header's wall clock and shift timer, so only
// those two re-render every second.
let secNow = 0;
const secListeners = new Set<() => void>();
let secTimer: number | undefined;

function subscribeSeconds(cb: () => void) {
  secListeners.add(cb);
  secNow = serverNow();
  if (secTimer === undefined) {
    secTimer = window.setInterval(() => {
      secNow = serverNow();
      secListeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    secListeners.delete(cb);
    if (!secListeners.size && secTimer !== undefined) {
      window.clearInterval(secTimer);
      secTimer = undefined;
    }
  };
}

const secSnapshot = () => {
  if (!secNow) secNow = serverNow();
  return secNow;
};

export function useSecondClock(): number {
  return useSyncExternalStore(subscribeSeconds, secSnapshot, () => 0);
}
