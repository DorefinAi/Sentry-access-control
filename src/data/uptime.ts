// Outages over the last month, per system and for the stack as a whole.
// Most "outages" are short restarts for deploys (see changes.ts); two were real.
import type { Outage, SystemId } from "@/types/control";
import { at } from "./time";
import { OCTOPUS_GAP } from "./world";

const DAY = 86_400;

interface SystemOutages {
  outages: Outage[]; // oldest first
  longestSec: number; // best streak in the last 30 days before the current one
}

const deploySamvadia = (from: string, to: string): Outage => ({ from: at(from, "2026-10-26"), to: at(to, "2026-10-26"), reason: "Restarted for a deploy of backend-Samvadia" });
const deploySocia = (from: string, to: string): Outage => ({ from: at(from, "2026-10-25"), to: at(to, "2026-10-25"), reason: "Restarted for a deploy of backend-socia" });

export const OUTAGES: Record<SystemId, SystemOutages> = {
  "samvadia-api": { outages: [deploySamvadia("22:07:40", "22:08:05")], longestSec: 11 * DAY + 3 * 3600 },
  "samvadia-worker": {
    outages: [
      { from: at("15:20", "2026-10-26"), to: at("15:24", "2026-10-26"), reason: "Worker went over its memory limit and restarted", incidentId: "INC-0006" },
      deploySamvadia("22:09:30", "22:10:00"),
    ],
    longestSec: 11 * DAY + 3 * 3600,
  },
  "socia-api": { outages: [deploySocia("19:41", "19:42")], longestSec: 8 * DAY + 5 * 3600 },
  "socia-ingest": { outages: [deploySocia("19:41", "19:42")], longestSec: 8 * DAY + 5 * 3600 },
  "socia-render": {
    outages: [deploySocia("19:41", "19:42"), { from: at("19:40", "2026-10-26"), to: at("19:41", "2026-10-26"), reason: "Chromium took too long to start; renderer restarted" }],
    longestSec: 8 * DAY + 5 * 3600,
  },
  "socia-publish": { outages: [deploySocia("19:41", "19:42")], longestSec: 8 * DAY + 5 * 3600 },
  "socia-crons": { outages: [deploySocia("19:41", "19:42")], longestSec: 8 * DAY + 5 * 3600 },
  postgres: {
    outages: [
      { from: at("15:02", "2026-10-08"), to: at("15:20", "2026-10-08"), reason: "Disk full on C:; Postgres stopped accepting writes" },
      { from: at("03:05", "2026-10-15"), to: at("03:10", "2026-10-15"), reason: "Windows update reboot" },
    ],
    longestSec: 19 * DAY + 4 * 3600,
  },
  backups: {
    outages: [{ from: at("02:00", "2026-10-18"), to: at("09:30", "2026-10-18"), reason: "Nightly backup failed: D: was full; rerun at 09:30 after cleanup" }],
    longestSec: 14 * DAY,
  },
  ftp: {
    outages: [{ from: at("06:30:00"), to: at("06:31:10"), reason: "FTP server restarted to pick up daily log rotation (local-dev change)" }],
    longestSec: 16 * DAY + 2 * 3600,
  },
  ollama: { outages: [{ from: at("08:55", "2026-10-24"), to: at("09:00", "2026-10-24"), reason: "Model update to qwen3:30b-a3b-instruct-2507" }], longestSec: 9 * DAY },
  "assignment-desk": { outages: [{ from: at("22:11", "2026-10-26"), to: at("22:12", "2026-10-26"), reason: "Restarted for a deploy of Assignment-desk-samvadia" }], longestSec: 6 * DAY + 7 * 3600 },
  "reporter-portal": { outages: [{ from: at("22:11", "2026-10-26"), to: at("22:12", "2026-10-26"), reason: "Restarted for a deploy of reporterportal" }], longestSec: 12 * DAY + 2 * 3600 },
  "digital-desk": { outages: [{ from: at("19:44", "2026-10-25"), to: at("19:45", "2026-10-25"), reason: "Restarted for a deploy of digital desk frontetnd" }], longestSec: 8 * DAY + 5 * 3600 },
  whatsapp: { outages: [{ from: at("13:10", "2026-10-20"), to: at("13:25", "2026-10-20"), reason: "Meta delayed webhook deliveries" }], longestSec: 17 * DAY },
  outlook: { outages: [{ from: at("09:40", "2026-10-22"), to: at("10:00", "2026-10-22"), reason: "Microsoft Graph returned 503 for every poll" }], longestSec: 15 * DAY },
  octopus: {
    outages: [{ from: OCTOPUS_GAP.from, to: OCTOPUS_GAP.resumedAt, reason: "Octopus stopped polling the feed (switch reboot on their side)", incidentId: "INC-0007" }],
    longestSec: 19 * DAY + 4 * 3600,
  },
  x: { outages: [deploySocia("19:41", "19:42")], longestSec: 8 * DAY + 5 * 3600 },
};

// Times the whole stack had a critical stage down. The stack streak counts from the last one.
export const STACK_OUTAGES: Outage[] = [
  { from: at("10:55", "2026-09-19"), to: at("11:10", "2026-09-19"), reason: "Samvadia API down after a bad config push" },
  { from: at("15:02", "2026-10-08"), to: at("15:20", "2026-10-08"), reason: "Postgres disk full; Samvadia API answered 500" },
  { from: OCTOPUS_GAP.from, to: OCTOPUS_GAP.resumedAt, reason: "Octopus stopped polling the feed", incidentId: "INC-0007" },
];

// Share of [fromMs, toMs] not covered by an outage, as a percent with 2 decimals.
export function uptimePct(outages: Outage[], fromMs: number, toMs: number): number {
  const down = outages.reduce((sum, o) => {
    const a = Math.max(fromMs, Date.parse(o.from));
    const b = Math.min(toMs, o.to ? Date.parse(o.to) : toMs);
    return sum + Math.max(0, b - a);
  }, 0);
  return Math.round((1 - down / (toMs - fromMs)) * 10000) / 100;
}