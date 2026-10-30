// What we know about 26 Oct beyond its logs. Today is derived from stories instead.
import type { SystemId } from "@/types/control";

export const YESTERDAY_FLOW = {
  storiesIn: 52,
  bySource: { portal: 11, outlook: 15, whatsapp: 26 },
  approved: 38,
  rejected: 9,
  inFeed: 38,
  collected: 38,
  medianMinutesToFeed: 6,
  xPosts: 27,
  xRecalled: 0,
};

// Stories in per hour, 0–23; sums to storiesIn.
export const YESTERDAY_HOURLY_IN = [0, 0, 0, 0, 0, 0, 1, 3, 4, 5, 6, 5, 4, 4, 3, 5, 4, 3, 2, 2, 1, 0, 0, 0];

export const YESTERDAY_FAILURES = [{ label: "Worker restart", count: 1 }];

export const YESTERDAY_UPTIME: { system: SystemId; pct: number }[] = [
  { system: "samvadia-api", pct: 100 },
  { system: "samvadia-worker", pct: 99.7 },
  { system: "socia-api", pct: 100 },
  { system: "socia-render", pct: 100 },
  { system: "postgres", pct: 100 },
  { system: "ftp", pct: 100 },
  { system: "ollama", pct: 100 },
  { system: "octopus", pct: 100 },
];
