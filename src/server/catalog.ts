// What Sentry watches: every system's name, group and where it runs. This is configuration, not
// data; health, metrics and uptime are measured live (probes/, ops/, systems.ts).
import type { SystemGroup, SystemId } from "@/types/control";

export interface SystemInfo {
  id: SystemId;
  name: string;
  group: SystemGroup;
  where: string;
}

const env = (name: string, fallback: string) => process.env[name]?.trim() || fallback;

/** Local ports of the front ends (testing/local-dev/start.ps1, digital/start-socia.ps1). */
export const FRONTEND_URLS = {
  "assignment-desk": () => env("ASSIGNMENT_DESK_URL", "http://127.0.0.1:3000"),
  "reporter-portal": () => env("REPORTER_PORTAL_URL", "http://127.0.0.1:3002"),
  "digital-desk": () => env("DIGITAL_DESK_URL", "http://127.0.0.1:3006"),
} as const;

export const OLLAMA_URL = () => env("OLLAMA_URL", "http://127.0.0.1:11434");
export const BACKUP_DIR = () => env("SENTRY_BACKUP_DIR", "C:/vartmaan/code/db/backups");
// The Cloudflare tunnel "socia" (sociaai.in -> :3006) runs inside the Windows service "Cloudflared"
export const TUNNEL_SERVICE = () => env("SENTRY_TUNNEL_SERVICE", "Cloudflared");

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return "not configured";
  }
};
const host = (name: string) => hostOf(process.env[name] ?? "");

export const SYSTEM_CATALOG: (() => SystemInfo)[] = [
  () => ({ id: "samvadia-api", name: "Samvadia API", group: "samvadia", where: `${host("SAMVADIA_API_URL")} (FastAPI, GET /health)` }),
  () => ({ id: "samvadia-worker", name: "Samvadia worker", group: "samvadia", where: "Samvadia job worker (heartbeat in ops summary)" }),
  () => ({ id: "socia-api", name: "Socia API", group: "socia", where: `${host("SOCIA_API_URL")} (Fastify, GET /healthz)` }),
  () => ({ id: "socia-ingest", name: "Socia ingest", group: "socia", where: "Socia worker: ingest (GET /healthz/worker)" }),
  () => ({ id: "socia-render", name: "Socia render", group: "socia", where: "Socia worker: render" }),
  () => ({ id: "socia-publish", name: "Socia publish", group: "socia", where: "Socia worker: publish" }),
  () => ({ id: "socia-crons", name: "Socia crons", group: "socia", where: "Socia worker: maintenance and trends" }),
  () => ({ id: "postgres", name: "Postgres", group: "infra", where: "Each backend's database check, and SELECT 1 in their health pages" }),
  () => ({ id: "backups", name: "Backups", group: "infra", where: `${BACKUP_DIR()} (socia-*.dump)` }),
  () => ({ id: "ftp", name: "FTP", group: "infra", where: "Samvadia's last upload result" }),
  () => ({ id: "ollama", name: "Ollama", group: "infra", where: `${hostOf(OLLAMA_URL())} (GET /api/tags)` }),
  () => ({ id: "assignment-desk", name: "Assignment desk", group: "frontend", where: hostOf(FRONTEND_URLS["assignment-desk"]()) }),
  () => ({ id: "reporter-portal", name: "Reporter portal", group: "frontend", where: hostOf(FRONTEND_URLS["reporter-portal"]()) }),
  () => ({ id: "digital-desk", name: "Digital desk", group: "frontend", where: `${hostOf(FRONTEND_URLS["digital-desk"]())}, Cloudflare tunnel (service ${TUNNEL_SERVICE()})` }),
  () => ({ id: "whatsapp", name: "WhatsApp", group: "external", where: "Samvadia's last message / webhook" }),
  () => ({ id: "outlook", name: "Outlook", group: "external", where: "Samvadia's last mailbox poll" }),
  () => ({ id: "octopus", name: "Octopus", group: "external", where: "Last time Octopus fetched Samvadia's feed" }),
  () => ({ id: "x", name: "X", group: "external", where: "Socia (posts marked by hand in phase 1)" }),
];

export const SYSTEM_IDS: SystemId[] = [
  "samvadia-api", "samvadia-worker", "socia-api", "socia-ingest", "socia-render", "socia-publish", "socia-crons",
  "postgres", "backups", "ftp", "ollama", "assignment-desk", "reporter-portal", "digital-desk", "whatsapp", "outlook", "octopus", "x",
];

export function systemInfo(id: SystemId): SystemInfo {
  return SYSTEM_CATALOG.map((f) => f()).find((s) => s.id === id)!;
}

export function allSystemInfo(): SystemInfo[] {
  return SYSTEM_CATALOG.map((f) => f());
}

export const systemName = (id: string): string => {
  try {
    return systemInfo(id as SystemId)?.name ?? id;
  } catch {
    return id;
  }
};
