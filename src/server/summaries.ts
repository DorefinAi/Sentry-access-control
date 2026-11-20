import type { AiSummary, SummaryScope } from "@/types/control";
import { dayNarrative, incidentDraft, logsSummary } from "./ai/summary";
import { badRequest, notFound } from "./http";
import { getIncidentRecord } from "./incidents";
import { logStats, parseLogQuery } from "./logs";
import { dayFacts, reportDates } from "./reports";
import { nowIso, todayIst } from "./time";
import { dateParam, oneOf } from "./validate";

const SCOPES: SummaryScope[] = ["day", "logs", "incident"];

export function getSummary(params: URLSearchParams): AiSummary {
  const scope = oneOf(params.get("scope") ?? "", SCOPES, "scope");
  const now = nowIso();

  if (scope === "day") {
    const date = dateParam(params.get("date"), todayIst());
    if (date !== todayIst() && !reportDates().includes(date)) throw notFound(`No data for ${date}. Days with data: ${reportDates().slice(0, 10).join(", ") || "none yet"}.`);
    return dayNarrative(dayFacts(date), now);
  }

  if (scope === "incident") {
    const id = params.get("id");
    if (!id) throw badRequest("id is required for scope=incident, for example id=INC-0008.");
    return incidentDraft(getIncidentRecord(id), now);
  }

  // scope=logs takes the same filters as /api/logs, plus date=YYYY-MM-DD as a shortcut for one day.
  const q = parseLogQuery(params);
  const date = params.get("date") ? dateParam(params.get("date"), todayIst()) : null;
  if (date && q.fromMs === undefined && q.toMs === undefined) {
    q.fromMs = Date.parse(`${date}T00:00:00+05:30`);
    q.toMs = Date.parse(`${date}T23:59:59+05:30`);
  }
  const label = [
    q.system?.length ? `system ${q.system.join(", ")}` : null,
    q.level?.length ? `level ${q.level.join(", ")}${q.level.length === 1 ? " and above" : ""}` : null,
    q.q ? `"${q.q}"` : null,
    q.slug ? `slug ${q.slug}` : null,
    date ? `on ${date}` : null,
    q.noise ? null : "without request lines",
  ].filter(Boolean);
  return logsSummary(logStats(q), label.length ? label.join(", ") : "all filters", now);
}
