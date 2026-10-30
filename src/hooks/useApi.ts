"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { onInvalidate } from "@/lib/invalidate";

interface Result<T> {
  key: string;
  data?: T;
  error?: Error;
}

export interface ApiState<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean; // true while the current key has no answer yet
  reload: () => void;
  mutate: (next: T | ((prev: T | undefined) => T)) => void;
}

/**
 * Loads `fetcher` whenever `key` changes; a null key skips loading.
 * With `refreshMs` it reloads on that interval while the tab is visible and
 * right away when the tab comes back. Old data stays on screen while reloading.
 * `invalidate(prefix)` from lib/invalidate reloads every hook whose key matches.
 * With `keepPrevious`, the last answer (for any earlier key) stays in `data` until the
 * new key answers; `loading` still says the current key has not answered yet.
 */
export function useApi<T>(key: string | null, fetcher: (signal: AbortSignal) => Promise<T>, opts: { refreshMs?: number; keepPrevious?: boolean } = {}): ApiState<T> {
  const [result, setResult] = useState<Result<T>>({ key: "" });
  const [tick, setTick] = useState(0);
  const { refreshMs, keepPrevious } = opts;
  // Each request gets a number. A mutate or invalidate raises the floor, so a poll
  // that started before it cannot land afterwards and overwrite newer data.
  const seq = useRef(0);
  const floor = useRef(0);

  useEffect(() => {
    if (key === null) return;
    const ctrl = new AbortController();
    const mine = ++seq.current;
    fetcher(ctrl.signal).then(
      (data) => {
        if (mine > floor.current) setResult({ key, data });
      },
      (error: Error) => {
        if (error.name !== "AbortError" && mine > floor.current) setResult((prev) => ({ key, data: prev.key === key ? prev.data : undefined, error }));
      }
    );
    return () => ctrl.abort();
    // The fetcher is identified by `key`; callers build it inline
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);

  useEffect(() => {
    if (!refreshMs) return;
    const bump = () => {
      if (document.visibilityState === "visible") setTick((t) => t + 1);
    };
    const id = window.setInterval(bump, refreshMs);
    document.addEventListener("visibilitychange", bump);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", bump);
    };
  }, [refreshMs]);

  useEffect(() => {
    if (key === null) return;
    return onInvalidate((prefixes) => {
      if (!prefixes.some((p) => key.startsWith(p))) return;
      floor.current = seq.current;
      setTick((t) => t + 1);
    });
  }, [key]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const mutate = useCallback((next: T | ((prev: T | undefined) => T)) => {
    floor.current = seq.current;
    setResult((prev) => ({ key: prev.key, data: typeof next === "function" ? (next as (p: T | undefined) => T)(prev.data) : next }));
  }, []);

  const current = key !== null && result.key === key;
  return {
    data: current || (keepPrevious && key !== null) ? result.data : undefined,
    error: current ? result.error : undefined,
    loading: key !== null && !current,
    reload,
    mutate,
  };
}
