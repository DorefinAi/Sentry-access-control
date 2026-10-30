// Gauge thresholds the team can move. Kept in memory and in thresholds.local.json (gitignored)
// so they survive a restart. Gauge health and the live X-cap alert follow them.
import { readFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { xCap } from "@/data/stats";
import { badRequest, notFound } from "./http";
import { addNotification, liveNow, recordAction, store } from "./store";
import { isRecord } from "./validate";

export type GaugeId = "x-cap" | "queue" | "uptime" | "to-feed" | "octopus-lag";

export interface GaugeSpec {
  label: string;
  unit: string;
  max: number;
  direction: "up" | "down"; // up = higher is worse
  warnAt: number;
  dangerAt: number;
}

export const GAUGE_SPECS: Record<GaugeId, GaugeSpec> = {
  "x-cap": { label: "X cap", unit: "%", max: 100, direction: "up", warnAt: 80, dangerAt: 95 },
  queue: { label: "Queue depth", unit: "jobs", max: 30, direction: "up", warnAt: 10, dangerAt: 25 },
  uptime: { label: "Uptime 24h", unit: "%", max: 100, direction: "down", warnAt: 99.5, dangerAt: 99 },
  "to-feed": { label: "Median time to feed", unit: "min", max: 30, direction: "up", warnAt: 15, dangerAt: 25 },
  "octopus-lag": { label: "Octopus last poll", unit: "s", max: 300, direction: "up", warnAt: 120, dangerAt: 300 },
};

export const GAUGE_IDS = Object.keys(GAUGE_SPECS) as GaugeId[];
const FILE = path.join(process.cwd(), "thresholds.local.json");

type Levels = Record<GaugeId, { warnAt: number; dangerAt: number }>;
const g = globalThis as typeof globalThis & { __sentryThresholds?: Levels };

function valid(id: GaugeId, warnAt: number, dangerAt: number): string | null {
  const { max, direction } = GAUGE_SPECS[id];
  const inRange = (n: number) => Number.isFinite(n) && n >= 0 && n <= max;
  if (!inRange(warnAt) || !inRange(dangerAt)) return `warnAt and dangerAt must be between 0 and ${max}.`;
  if (direction === "up" && !(warnAt < dangerAt)) return "warnAt must be below dangerAt (higher is worse on this gauge).";
  if (direction === "down" && !(warnAt > dangerAt)) return "warnAt must be above dangerAt (lower is worse on this gauge).";
  return null;
}

export function thresholds(): Levels {
  if (g.__sentryThresholds) return g.__sentryThresholds;
  const levels = Object.fromEntries(GAUGE_IDS.map((id) => [id, { warnAt: GAUGE_SPECS[id].warnAt, dangerAt: GAUGE_SPECS[id].dangerAt }])) as Levels;
  try {
    const saved = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, { warnAt?: unknown; dangerAt?: unknown }>;
    for (const id of GAUGE_IDS) {
      const s = saved[id];
      if (s && typeof s.warnAt === "number" && typeof s.dangerAt === "number" && !valid(id, s.warnAt, s.dangerAt)) {
        levels[id] = { warnAt: s.warnAt, dangerAt: s.dangerAt };
      }
    }
  } catch {
    // No file yet, or unreadable: defaults.
  }
  return (g.__sentryThresholds = levels);
}

export function isGaugeId(id: string): id is GaugeId {
  return (GAUGE_IDS as string[]).includes(id);
}

export function parseThresholdPatch(id: string, body: unknown): { warnAt: number; dangerAt: number } {
  if (!isGaugeId(id)) throw notFound(`There is no gauge called "${id}". Gauges: ${GAUGE_IDS.join(", ")}.`);
  if (!isRecord(body)) throw badRequest('Send {"warnAt": 85} and/or {"dangerAt": 95}.');
  for (const k of ["warnAt", "dangerAt"] as const) {
    if (body[k] !== undefined && typeof body[k] !== "number") throw badRequest(`${k} must be a number.`);
  }
  if (body.warnAt === undefined && body.dangerAt === undefined) throw badRequest("Nothing to change. Send warnAt and/or dangerAt.");
  const cur = thresholds()[id];
  const next = { warnAt: (body.warnAt as number | undefined) ?? cur.warnAt, dangerAt: (body.dangerAt as number | undefined) ?? cur.dangerAt };
  const problem = valid(id, next.warnAt, next.dangerAt);
  if (problem) throw badRequest(problem);
  return next;
}

async function save(levels: Levels) {
  const tmp = `${FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(levels, null, 2) + "\n");
  await rename(tmp, FILE);
}

const fmt = (id: GaugeId, n: number) => `${n}${GAUGE_SPECS[id].unit === "%" ? "%" : ` ${GAUGE_SPECS[id].unit}`}`;

export async function setThreshold(id: GaugeId, next: { warnAt: number; dangerAt: number }, actor: string): Promise<void> {
  const levels = thresholds();
  const before = levels[id];
  levels[id] = next;
  await save(levels);

  const at = liveNow();
  const changes = [
    before.warnAt !== next.warnAt ? `${GAUGE_SPECS[id].label} warning to ${fmt(id, next.warnAt)}` : null,
    before.dangerAt !== next.dangerAt ? `${GAUGE_SPECS[id].label} danger to ${fmt(id, next.dangerAt)}` : null,
  ].filter(Boolean);
  if (changes.length) {
    const text = `${actor} set ${changes.join(" and ")}`;
    recordAction({ at, user: actor, kind: "settings", text });
    addNotification({ at, kind: "team_change", severity: "info", title: text, body: "Gauge threshold changed", evidence: [] });
  }
  if (id === "x-cap") reevaluateXCap(actor);
}

// The X-cap rule fires at the warning level. Moving the level re-checks the live alert:
// below it, the alert clears; back over it, an alert cleared this way opens again.
function reevaluateXCap(actor: string) {
  const { warnAt } = thresholds()["x-cap"];
  const cap = xCap();
  const alert = store().alerts.find((a) => a.ruleId === "x-cap");
  if (!alert) return;
  const at = liveNow();
  const ev = [{ kind: "alert" as const, id: alert.id, label: alert.id }];
  if (cap.pct < warnAt && alert.state !== "resolved") {
    alert.state = "resolved";
    alert.resolvedAt = at;
    alert.note = `Cleared: ${cap.pct}% is below the new warning level ${warnAt}% (set by ${actor})`;
    alert.noteHistory = [...(alert.noteHistory ?? []), { at, text: alert.note, by: actor }];
    addNotification({ at, kind: "alert_resolved", severity: "info", title: `Resolved: ${alert.title}`, body: alert.note, evidence: ev });
  } else if (cap.pct >= warnAt && alert.state === "resolved" && alert.note?.startsWith("Cleared:")) {
    alert.state = "open";
    alert.resolvedAt = null;
    alert.ackedAt = null;
    alert.note = `Open again: ${cap.pct}% is at or over the warning level ${warnAt}% (set by ${actor})`;
    alert.noteHistory = [...(alert.noteHistory ?? []), { at, text: alert.note, by: actor }];
    addNotification({ at, kind: "alert_fired", severity: alert.severity, title: `Reopened: ${alert.title}`, body: alert.note, evidence: ev });
  }
}
