import type { Alert, Health, System, SystemDetail } from "@/types/control";
import { NOW } from "@/data/time";
import { SYSTEM_BY_ID, SYSTEMS } from "@/data/systems";
import { notFound } from "./http";
import { recentLogs } from "./logs";
import { outageNow } from "./mission";
import { store } from "./store";
import { isSystemId } from "./validate";

const RANK: Record<Health, number> = { ok: 0, unknown: 1, warn: 2, down: 3 };

export function worst(list: Health[]): Health {
  return list.reduce<Health>((w, h) => (RANK[h] > RANK[w] ? h : w), "ok");
}

// A system that is running but has an unresolved warning or critical alert shows as warn.
// "down" is kept for a system inside a known outage (Octopus 11:40 to 11:52 on a replay).
function withAlerts(system: System, alerts: Alert[], at: string): System {
  if (outageNow(system.id, at)) return { ...system, health: "down" };
  const live = alerts.some((a) => a.state !== "resolved" && a.severity !== "info" && a.systems.includes(system.id));
  return live ? { ...system, health: worst([system.health, "warn"]) } : system;
}

export function systemsFor(alerts: Alert[], at: string): System[] {
  return SYSTEMS.map((s) => withAlerts(s, alerts, at));
}

export function listSystems(): System[] {
  return systemsFor(store().alerts, NOW);
}

export function getSystemDetail(id: string): SystemDetail {
  if (!isSystemId(id)) throw notFound(`There is no system called "${id}".`);
  const alerts = store().alerts;
  const system = withAlerts(SYSTEM_BY_ID.get(id)!, alerts, NOW);
  const logs = recentLogs(id, 50);
  const openAlerts = alerts.filter((a) => a.state !== "resolved" && a.systems.includes(id));
  return { ...system, recentLogs: logs, openAlerts };
}
