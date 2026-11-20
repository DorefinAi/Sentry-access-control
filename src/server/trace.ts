// Where is a story? Asks both backends (GET /owner/ops/story/{slug}) and joins the two paths by
// slug: Samvadia's steps (intake to Octopus) first, then Socia's (ingest to X), since Socia keeps
// the Samvadia slug. The story's own log lines (slug set on the line) are added to the steps as
// evidence, and unresolved alerts that name the story are added to the step that is stuck.
import type { Evidence, LogEntry, SystemId, Trace, TraceSearchHit, TraceSearchResult, TraceStep } from "@/types/control";
import { SYSTEM_LABEL } from "@/types/people";
import { listAlerts } from "./alerts";
import { cleanEvidence } from "./evidence";
import { HttpError, notFound } from "./http";
import { logsForSlug } from "./logs";
import { fetchStories, fetchStory } from "./ops/client";
import { opsState } from "./ops/pull";
import { OPS_SOURCES, type OpsSource, type OpsStory, type StoryState } from "./ops/types";
import { hhmm } from "./time";
import { isSystemId } from "./validate";

const STAGE_SYSTEM: Record<string, SystemId> = {
  intake: "samvadia-api",
  desk: "assignment-desk",
  ftp: "ftp",
  feed: "samvadia-api",
  octopus: "octopus",
  ingest: "socia-ingest",
  convert: "socia-ingest",
  compose: "socia-ingest",
  render: "socia-render",
  operator: "digital-desk",
  publish: "x",
};
const STATE_RANK: Record<StoryState, number> = { done: 0, on_track: 1, stuck: 2, failed: 3 };
const PER_STEP_LOGS = 5;
const NEAR_MS = 15 * 60_000;

const configured = () => OPS_SOURCES.filter((s) => opsState(s).configured);

export async function searchTraces(q: string | null, fetchImpl?: typeof fetch): Promise<TraceSearchResult> {
  const sources = configured();
  const errors: string[] = [];
  const hits = new Map<string, TraceSearchHit>();
  await Promise.all(
    sources.map(async (source) => {
      try {
        // Every day the backend still has (contract v1.1 date=all); an older backend refuses that, so ask it for today
        const query = { q: q?.trim() || undefined, limit: 20, fetchImpl };
        const found = await fetchStories(source, { ...query, date: "all" }).catch((e: unknown) => {
          if (e instanceof HttpError && e.status >= 400 && e.status < 500 && e.status !== 429) return fetchStories(source, query);
          throw e;
        });
        for (const h of found) {
          const known = hits.get(h.slug);
          // The same slug in both backends: keep the first time it was received
          if (!known || Date.parse(h.receivedAt) < Date.parse(known.receivedAt)) hits.set(h.slug, { slug: h.slug, headline: h.headline || known?.headline || "", receivedAt: h.receivedAt });
        }
      } catch (e) {
        errors.push(`${SYSTEM_LABEL[source]}: ${(e as Error).message}`);
      }
    }),
  );
  if (sources.length && errors.length === sources.length) throw new HttpError(503, "backend_unavailable", `Could not search for stories. ${errors.join(" ")}`);
  if (errors.length) console.error(`[trace] search left out a backend: ${errors.join(" ")}`);
  return {
    hits: [...hits.values()].sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt)).slice(0, 20),
    partial: errors.length ? errors.join(" ") : null,
  };
}

function toSteps(source: OpsSource, story: OpsStory): TraceStep[] {
  return story.steps.map((s) => ({
    at: s.at,
    system: isSystemId(s.system) ? s.system : (STAGE_SYSTEM[s.stage] ?? (source === "samvadia" ? "samvadia-api" : "socia-api")),
    stage: s.label,
    state: s.state,
    ...(s.detail ? { detail: s.detail } : {}),
  }));
}

const logLabel = (l: LogEntry) => `${l.level === "error" ? "Error" : l.level === "warn" ? "Warning" : "Log"} ${hhmm(l.at)}: ${l.message.slice(0, 60)}`;

/**
 * Puts each log line on the step of the same system nearest in time (else the nearest step).
 * Each step keeps every error line plus the latest PER_STEP_LOGS other lines.
 */
export function attachLogs(steps: TraceStep[], logs: LogEntry[]): void {
  const timed = steps.map((s, i) => ({ i, t: s.at ? Date.parse(s.at) : null, system: s.system }));
  const per = new Map<number, LogEntry[]>();
  for (const l of logs) {
    const t = Date.parse(l.at);
    const near = (c: (typeof timed)[number]) => (c.t === null ? Infinity : Math.abs(c.t - t));
    const same = timed.filter((c) => c.system === l.system && near(c) <= NEAR_MS).sort((a, b) => near(a) - near(b))[0];
    const any = timed.filter((c) => c.t !== null).sort((a, b) => near(a) - near(b))[0];
    const target = same ?? any;
    if (target) per.set(target.i, [...(per.get(target.i) ?? []), l]);
  }
  for (const [i, lines] of per) {
    const sorted = [...lines].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const latest = new Set(sorted.filter((l) => l.level !== "error").slice(-PER_STEP_LOGS));
    const kept = sorted.filter((l) => l.level === "error" || latest.has(l));
    steps[i].evidence = [...(steps[i].evidence ?? []), ...kept.map((l): Evidence => ({ kind: "log", id: l.id, label: logLabel(l) }))];
  }
}

export async function getTrace(slug: string, fetchImpl?: typeof fetch): Promise<Trace> {
  const clean = slug.trim();
  if (!clean || clean.length > 120) throw notFound(`No story with slug ${slug}.`);
  const sources = configured();
  const errors: string[] = [];
  const found: [OpsSource, OpsStory][] = [];
  await Promise.all(
    sources.map(async (source) => {
      try {
        const s = (await fetchStory(source, clean, fetchImpl)) ?? (clean !== clean.toUpperCase() ? await fetchStory(source, clean.toUpperCase(), fetchImpl) : null);
        if (s) found.push([source, s]);
      } catch (e) {
        errors.push(`${SYSTEM_LABEL[source]}: ${(e as Error).message}`);
      }
    }),
  );
  found.sort((a, b) => (a[0] === b[0] ? 0 : a[0] === "samvadia" ? -1 : 1));
  if (errors.length) console.error(`[trace] ${clean}: ${errors.join(" ")}`);
  if (!found.length) {
    if (errors.length) throw new HttpError(503, "backend_unavailable", `Could not look the story up. ${errors.join(" ")}`);
    throw notFound(`No story with slug ${clean}. Check the spelling, or search with /api/trace?q=.`);
  }

  const steps = found.flatMap(([source, s]) => toSteps(source, s));
  const worstStory = found.reduce((a, b) => (STATE_RANK[b[1].state] > STATE_RANK[a[1].state] ? b : a))[1];
  // Samvadia done but Socia still working on it: the story as a whole is on track
  const state = found.reduce<StoryState>((acc, [, s]) => (STATE_RANK[s.state] > STATE_RANK[acc] ? s.state : acc), "done");
  const stuckStep = worstStory.stuckAt ? worstStory.steps.find((s) => s.stage === worstStory.stuckAt) : null;
  const main = found[0][1];
  const theSlug = main.slug;

  attachLogs(steps, logsForSlug(theSlug));
  const alerts = listAlerts().filter((a) => a.state !== "resolved" && a.evidence.some((e) => e.kind === "trace" && e.id === theSlug));
  const problem = steps.find((s) => s.state === "failed") ?? steps.find((s) => s.state === "waiting");
  if (problem && alerts.length) problem.evidence = [...alerts.map((a): Evidence => ({ kind: "alert", id: a.id, label: a.title })), ...(problem.evidence ?? [])];

  return {
    slug: theSlug,
    headline: found.map(([, s]) => s.headline).find(Boolean) ?? "",
    reporter: found.map(([, s]) => s.reporter).find(Boolean) ?? null,
    city: found.map(([, s]) => s.city).find(Boolean) ?? null,
    source: ((src) => (src === "share" ? null : src))(found.map(([, s]) => s.source).find(Boolean) ?? null),
    state,
    stuckAt: state === "stuck" || state === "failed" ? (stuckStep?.label ?? worstStory.stuckAt) : null,
    steps: steps.map((s) => (s.evidence ? { ...s, evidence: cleanEvidence(s.evidence) } : s)),
    partial: errors.length ? errors.join(" ") : null,
  };
}
