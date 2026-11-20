// Health probes, run every 30 s by monitor.ts. Each probe answers ok / warn / down / unknown with a
// plain reason; nothing is guessed. Sources:
// - HTTP: Samvadia GET /health, Socia GET /healthz and /healthz/worker, Ollama GET /api/tags (up or
//   down only), the three front ends on their local ports;
// - the backends' ops summaries: process heartbeats (stale >= heartbeatWarnSec = warn, >=
//   heartbeatDownSec = down) and their own checks (db -> Postgres, ftp, outlook, whatsapp,
//   octopus, share, worker, data-files, x);
// - this machine: the Cloudflare tunnel Windows service (sc query, read-only) and the age of the
//   newest backup file written by digital/backup-socia-db.ps1.
// Then every system gets one health from the probes that cover it (composeSystems).
import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { Health, SystemId } from "@/types/control";
import { SYSTEM_LABEL } from "@/types/people";
import { BACKUP_DIR, FRONTEND_URLS, OLLAMA_URL, SYSTEM_IDS, TUNNEL_SERVICE } from "../catalog";
import { freshSummary, opsProblem, opsState } from "../ops/pull";
import { OPS_SOURCES, type OpsCheck, type OpsSource, type OpsSummary } from "../ops/types";
import { ruleThresholds, type RuleLevels } from "../thresholds";
import { nowMs } from "../time";

const HTTP_TIMEOUT_MS = 5_000;

export interface ProbeResult {
  target: string; // "http:samvadia-api", "hb:samvadia:worker", "check:samvadia:ftp", "backups", ...
  label: string; // plain name: "Samvadia /health"
  health: Health;
  reason: string; // one plain line
  systems: SystemId[]; // which systems this probe speaks for
  value?: number | null; // a number when the probe has one (heartbeat age s, backup age h)
  gone?: boolean; // a heartbeat older than heartbeatGoneSec: a retired process, not a live problem
  at: number;
}

export interface ProbeDeps {
  now: number;
  fetchImpl: typeof fetch;
  levels: RuleLevels;
  ops: Record<OpsSource, { configured: boolean; summary: OpsSummary | null; problem: string | null }>;
  backendUrl: (source: OpsSource) => string | null;
  scQuery: (service: string) => Promise<string | null>; // sc query output, null when not on Windows; rejects when sc could not run
  listBackups: () => Promise<{ name: string; mtimeMs: number }[] | null>; // null when the folder cannot be read
}

// ─── Small pure pieces (tested on their own) ────────────────────────────────

/**
 * A heartbeat's health from its age: >= warnSec warn, >= downSec down. Past goneSec (default 1 h)
 * the process is taken as retired (an old worker name still in the table): unknown, never an alert.
 */
export function heartbeatHealth(
  beatAt: string,
  now: number,
  levels: Pick<RuleLevels, "heartbeatWarnSec" | "heartbeatDownSec"> & Partial<Pick<RuleLevels, "heartbeatGoneSec">>,
): { health: Health; ageSec: number; gone: boolean } {
  const ageSec = Math.max(0, Math.round((now - Date.parse(beatAt)) / 1000));
  if (ageSec >= (levels.heartbeatGoneSec ?? Infinity)) return { ageSec, health: "unknown", gone: true };
  return { ageSec, gone: false, health: ageSec >= levels.heartbeatDownSec ? "down" : ageSec >= levels.heartbeatWarnSec ? "warn" : "ok" };
}

/** The STATE line of `sc query <name>`: "RUNNING", "STOPPED", ... or null when the service is unknown. */
export function parseScState(out: string): string | null {
  const m = /STATE\s*:\s*\d+\s+([A-Z_]+)/.exec(out);
  return m ? m[1] : null;
}

const SOCIA_ROLES: [RegExp, SystemId][] = [
  [/\bingest\b/, "socia-ingest"],
  [/\brender\b/, "socia-render"],
  [/\bpublish\b/, "socia-publish"],
  [/\b(maintenance|trends|crons?)\b/, "socia-crons"],
];

/** Which systems a backend process speaks for: its own system id, plus the worker roles it runs. */
export function processSystems(source: OpsSource, process: string, system: string): SystemId[] {
  const out = new Set<SystemId>();
  if ((SYSTEM_IDS as string[]).includes(system)) out.add(system as SystemId);
  if (source === "socia") for (const [re, id] of SOCIA_ROLES) if (re.test(process)) out.add(id);
  if (source === "samvadia" && /worker/.test(process)) out.add("samvadia-worker");
  return [...out];
}

const CHECK_SYSTEMS: Record<OpsSource, Record<string, SystemId[]>> = {
  samvadia: { db: ["postgres"], ftp: ["ftp"], outlook: ["outlook"], whatsapp: ["whatsapp"], octopus: ["octopus"] },
  socia: { db: ["postgres"], share: ["socia-ingest"], worker: ["socia-ingest"], "data-files": ["socia-api"], x: ["x"] },
};

/** One backend check as a probe result. ok=false is down; never checked is unknown. */
export function checkProbe(source: OpsSource, c: OpsCheck, now: number): ProbeResult {
  const label = `${SYSTEM_LABEL[source]}: ${c.label}`;
  const base = { target: `check:${source}:${c.id}`, label, systems: CHECK_SYSTEMS[source][c.id] ?? [], at: now };
  if (c.ok === null) return { ...base, health: "unknown", reason: `${c.label}: not checked yet` };
  if (c.ok) return { ...base, health: "ok", reason: c.detail ? `${c.label}: ${c.detail}` : `${c.label}: OK` };
  return { ...base, health: "down", reason: `${c.label} failing${c.lastError ? `: ${c.lastError}` : ""}` };
}

/** The newest backup's age as a probe result. */
export function backupProbe(files: { name: string; mtimeMs: number }[] | null, now: number, maxHours: number, dir: string): ProbeResult {
  const base = { target: "backups", label: "Newest backup", systems: ["backups" as SystemId], at: now };
  if (files === null) return { ...base, health: "unknown", reason: `Cannot read ${dir}`, value: null };
  const dumps = files.filter((f) => /\.dump$/i.test(f.name));
  if (!dumps.length) return { ...base, health: "down", reason: `No backup file in ${dir}`, value: null };
  const newest = dumps.reduce((a, b) => (b.mtimeMs > a.mtimeMs ? b : a));
  const hours = Math.round(((now - newest.mtimeMs) / 3_600_000) * 10) / 10;
  return {
    ...base,
    health: hours > maxHours ? "warn" : "ok",
    reason: `${newest.name} is ${hours < 1 ? `${Math.round(hours * 60)} min` : `${hours} h`} old${hours > maxHours ? ` (over ${maxHours} h)` : ""}`,
    value: hours,
  };
}

async function httpProbe(
  target: string,
  label: string,
  url: string | null,
  systems: SystemId[],
  deps: ProbeDeps,
  { upBelow = 400, notSet = "not configured" }: { upBelow?: number; notSet?: string } = {},
): Promise<ProbeResult> {
  const base = { target, label, systems, at: deps.now };
  if (!url) return { ...base, health: "unknown", reason: notSet };
  const started = nowMs();
  try {
    const res = await deps.fetchImpl(url, { cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    await res.body?.cancel().catch(() => undefined);
    const took = nowMs() - started;
    if (res.status < upBelow) return { ...base, health: "ok", reason: `answered ${res.status} in ${took} ms`, value: took };
    return { ...base, health: "down", reason: `answered ${res.status}`, value: took };
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { ...base, health: "down", reason: timedOut ? `no answer in ${HTTP_TIMEOUT_MS / 1000} s` : "not reachable (is it running?)", value: null };
  }
}

// ─── One round ──────────────────────────────────────────────────────────────

export async function runProbes(deps: ProbeDeps): Promise<ProbeResult[]> {
  const { now } = deps;
  const out: Promise<ProbeResult | ProbeResult[]>[] = [];
  const samvadia = deps.backendUrl("samvadia");
  const socia = deps.backendUrl("socia");

  // Both health pages run SELECT 1, so a 200 also says Postgres answers (a failure says nothing about it)
  const dbToo = (label: string) => (r: ProbeResult): ProbeResult[] =>
    r.health === "ok" ? [r, { target: `db-via:${r.target}`, label: `Postgres via ${label}`, health: "ok", reason: `${label} ran SELECT 1`, systems: ["postgres"], at: r.at }] : [r];
  out.push(httpProbe("http:samvadia-api", "Samvadia /health", samvadia && `${samvadia}/health`, ["samvadia-api"], deps, { notSet: "SAMVADIA_API_URL is not set" }).then(dbToo("Samvadia /health")));
  out.push(httpProbe("http:socia-api", "Socia /healthz", socia && `${socia}/healthz`, ["socia-api"], deps, { notSet: "SOCIA_API_URL is not set" }).then(dbToo("Socia /healthz")));
  out.push(
    httpProbe("http:socia-worker", "Socia /healthz/worker", socia && `${socia}/healthz/worker`, ["socia-ingest", "socia-render", "socia-publish", "socia-crons"], deps, { notSet: "SOCIA_API_URL is not set" }).then((r) =>
      r.health === "down" && r.reason === "answered 503" ? { ...r, reason: "Socia says the worker has stopped" } : r,
    ),
  );
  out.push(httpProbe("http:ollama", "Ollama /api/tags", `${OLLAMA_URL()}/api/tags`, ["ollama"], deps));
  for (const id of ["assignment-desk", "reporter-portal", "digital-desk"] as const) {
    // A front end that answers at all (even a redirect to its login page) is up
    out.push(httpProbe(`http:${id}`, `${id} web page`, FRONTEND_URLS[id](), [id], deps, { upBelow: 500 }));
  }

  // The Cloudflare tunnel in front of the digital desk (Windows service, read-only query)
  out.push(
    deps.scQuery(TUNNEL_SERVICE()).then((text): ProbeResult => {
      const base = { target: "service:tunnel", label: `Cloudflare tunnel service ${TUNNEL_SERVICE()}`, systems: ["digital-desk" as SystemId], at: now };
      if (text === null) return { ...base, health: "unknown", reason: "Only checked on Windows" };
      const state = parseScState(text);
      if (!state) return { ...base, health: "unknown", reason: `No Windows service named "${TUNNEL_SERVICE()}"` };
      return { ...base, health: state === "RUNNING" ? "ok" : "down", reason: `Tunnel service is ${state.toLowerCase().replace(/_/g, " ")}` };
    }).catch((e: unknown): ProbeResult => ({
      target: "service:tunnel",
      label: `Cloudflare tunnel service ${TUNNEL_SERVICE()}`,
      systems: ["digital-desk"],
      at: now,
      health: "unknown",
      reason: `Could not run sc: ${(e as Error).message}`,
    })),
  );

  out.push(deps.listBackups().then((files) => backupProbe(files, now, deps.levels.backupMaxHours, BACKUP_DIR())));

  // From the backends' own ops summaries
  for (const source of OPS_SOURCES) {
    const o = deps.ops[source];
    if (!o.configured) continue;
    const label = SYSTEM_LABEL[source];
    if (!o.summary) {
      out.push(Promise.resolve({ target: `ops:${source}`, label: `${label} ops status`, health: "down" as Health, reason: o.problem ?? "No ops status", systems: [], at: now }));
      continue;
    }
    out.push(Promise.resolve({ target: `ops:${source}`, label: `${label} ops status`, health: "ok" as Health, reason: "Ops status read", systems: [], at: now }));
    for (const p of o.summary.processes) {
      const { health, ageSec, gone } = heartbeatHealth(p.beatAt, now, deps.levels);
      out.push(
        Promise.resolve({
          target: `hb:${source}:${p.process}`,
          label: `${label} ${p.process} heartbeat`,
          health,
          reason: gone
            ? `${p.process}: last beat ${Math.round(ageSec / 3600)} h ago (gone, ignored)`
            : health === "ok"
              ? `${p.process}: beat ${ageSec} s ago`
              : `${p.process}: no heartbeat for ${ageSec >= 120 ? `${Math.round(ageSec / 60)} min` : `${ageSec} s`}`,
          systems: processSystems(source, p.process, p.system),
          value: ageSec,
          ...(gone ? { gone: true } : {}),
          at: now,
        }),
      );
    }
    for (const c of o.summary.checks) out.push(Promise.resolve(checkProbe(source, c, now)));
  }

  return (await Promise.all(out)).flat();
}

// ─── Systems from probes ────────────────────────────────────────────────────

export interface SystemHealth {
  health: Health;
  reason: string;
  parts: ProbeResult[];
}

const RANK: Record<Health, number> = { ok: 0, unknown: 1, warn: 2, down: 3 };

/**
 * Every system's health from the probes that cover it: the worst of the parts that know something;
 * unknown only when nothing covering it knows anything. noData gives the reason for a system
 * nothing covers (for example "Samvadia is not reachable").
 */
export function composeSystems(results: ProbeResult[], noData: (id: SystemId) => string): Record<SystemId, SystemHealth> {
  const out = {} as Record<SystemId, SystemHealth>;
  for (const id of SYSTEM_IDS) {
    const parts = results.filter((r) => r.systems.includes(id));
    const known = parts.filter((p) => p.health !== "unknown");
    if (!known.length) {
      out[id] = { health: "unknown", reason: parts[0]?.reason ?? noData(id), parts };
      continue;
    }
    const worst = known.reduce((a, b) => (RANK[b.health] > RANK[a.health] ? b : a));
    out[id] = { health: worst.health, reason: worst.health === "ok" ? known.map((p) => p.reason).join("; ") : worst.reason, parts };
  }
  return out;
}

/** Systems whose outage stops news flowing: the stack is down while any of them is. */
export const CRITICAL_SYSTEMS: SystemId[] = ["samvadia-api", "samvadia-worker", "socia-api", "socia-ingest", "postgres"];

export function stackHealth(systems: Record<SystemId, SystemHealth>): { health: Health; reason: string } {
  const parts = CRITICAL_SYSTEMS.map((id) => ({ id, ...systems[id] }));
  const down = parts.filter((p) => p.health === "down");
  if (down.length) return { health: "down", reason: down.map((p) => `${p.id}: ${p.reason}`).join("; ") };
  const known = parts.filter((p) => p.health !== "unknown");
  const unknown = parts.filter((p) => p.health === "unknown").map((p) => p.id);
  if (!known.length) return { health: "unknown", reason: "Nothing critical can be seen" };
  const notKnown = unknown.length ? `; not known: ${unknown.join(", ")}` : "";
  if (known.some((p) => p.health === "warn")) return { health: "warn", reason: known.filter((p) => p.health === "warn").map((p) => `${p.id}: ${p.reason}`).join("; ") + notKnown };
  return { health: "ok", reason: unknown.length ? `Up: ${known.map((p) => p.id).join(", ")}${notKnown}` : "All critical systems up" };
}

/** Which backend a system's numbers come from (for "no data" reasons). */
export function backendOf(id: SystemId): OpsSource | null {
  if (["samvadia-api", "samvadia-worker", "ftp", "whatsapp", "outlook", "octopus"].includes(id)) return "samvadia";
  if (["socia-api", "socia-ingest", "socia-render", "socia-publish", "socia-crons", "x"].includes(id)) return "socia";
  return null;
}

// ─── Real dependencies ──────────────────────────────────────────────────────

function scQuery(service: string): Promise<string | null> {
  if (process.platform !== "win32") return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    // Read-only: "sc query" only reports the service state
    execFile("sc", ["query", service], { timeout: 5_000, windowsHide: true }, (err, stdout) => {
      const out = typeof stdout === "string" ? stdout : "";
      // sc exits non-zero for an unknown service (1060) but still prints why: that is an answer
      if (!err || /STATE\s*:|\b1060\b/.test(out)) return resolve(out);
      const code = (err as NodeJS.ErrnoException).code;
      reject(new Error(code === "ENOENT" ? "sc.exe was not found" : err.killed ? "it did not answer in 5 s" : err.message.slice(0, 200)));
    });
  });
}

async function listBackups(): Promise<{ name: string; mtimeMs: number }[] | null> {
  const dir = BACKUP_DIR();
  try {
    const names = (await readdir(dir)).filter((n) => /^socia-.*\.dump$/i.test(n));
    return await Promise.all(names.map(async (name) => ({ name, mtimeMs: (await stat(path.join(dir, name))).mtimeMs })));
  } catch {
    return null;
  }
}

function backendUrl(source: OpsSource): string | null {
  const raw = process.env[source === "samvadia" ? "SAMVADIA_API_URL" : "SOCIA_API_URL"]?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href.replace(/\/+$/, "") : null;
  } catch {
    return null;
  }
}

export function defaultProbeDeps(now = nowMs()): ProbeDeps {
  const ops = Object.fromEntries(
    OPS_SOURCES.map((s) => [s, { configured: opsState(s).configured, summary: freshSummary(s, now), problem: opsProblem(s, now) }]),
  ) as ProbeDeps["ops"];
  return { now, fetchImpl: globalThis.fetch, levels: ruleThresholds(), ops, backendUrl, scQuery, listBackups };
}
