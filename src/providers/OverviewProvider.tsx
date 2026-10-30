"use client";

// One overview poll for the whole app, plus the replay moment. Every monitor
// screen (Overview, Pipelines, a system) reads `board`: the live board,
// or the board as it stood at `replayAt`. The nav badge always reads `live`.
// It also keeps the server clock in sync (see lib/clock.ts).
import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { getOverview } from "@/lib/api";
import { syncClock } from "@/lib/clock";
import { ApiState, useApi } from "@/hooks/useApi";
import type { Overview } from "@/types/control";

interface Boards {
  live: ApiState<Overview>;
  /** What monitor screens show: the replayed board when replaying (once loaded), else live. */
  board: Overview | undefined;
  replayAt: string | null;
  replay: ApiState<Overview> | null;
  setReplay: (iso: string | null) => void;
}

const OverviewContext = createContext<Boards | null>(null);

export function useBoards() {
  const ctx = useContext(OverviewContext);
  if (!ctx) throw new Error("useBoards must be used inside OverviewProvider");
  return ctx;
}

/** The live overview, for things that must never show a replay (badge, Ask context). */
export function useOverview() {
  return useBoards().live;
}

export default function OverviewProvider({ children }: { children: ReactNode }) {
  const live = useApi("overview", getOverview, { refreshMs: 30_000 });
  const [replayAt, setReplay] = useState<string | null>(null);
  // While scrubbing, the last replayed board stays up until the next one answers
  const past = useApi(replayAt ? `overview@${replayAt}` : null, (s) => getOverview(s, replayAt!), { keepPrevious: true });

  const generatedAt = live.data?.generatedAt;
  const failed = !!live.error;
  useEffect(() => {
    if (generatedAt) syncClock(generatedAt);
    else if (failed) syncClock(null);
  }, [generatedAt, failed]);

  const value = useMemo<Boards>(
    () => ({ live, board: replayAt && past.data ? past.data : live.data, replayAt, replay: replayAt ? past : null, setReplay }),
    [live, past, replayAt]
  );
  return <OverviewContext.Provider value={value}>{children}</OverviewContext.Provider>;
}
