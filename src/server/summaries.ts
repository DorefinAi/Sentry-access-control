import type { AiSummary, SummaryScope } from "@/types/control";
import { TODAY } from "@/data/time";
import { dayNarrative, incidentDraft, logsSummary } from "./ai/summary";
import { badRequest, notFound } from "./http";
import { filterLogs, parseLogQuery } from "./logs";
import { REPORT_DATES } from "./reports";
import { liveMoment } from "./moment";
import { liveNow, store } from "./store";
import { dateParam, oneOf } from "./validate";

const SCOPES: SummaryScope[] = ["day", "logs", "incident"];

export function getSummary(params: URLSearchParams): AiSummary {
  const scope = oneOf(params.get("scope") ?? "", SCOPES, "scope");
  const now = liveNow();
  const { incidents } = store();

  if (scope === "day") {
    const date = dateParam(params.get("date"), TODAY);
    if (!REPORT_DATES.includes(date)) throw notFound(`No data for ${date}. Days with data: ${REPORT_DATES.join(" and ")}.`);
    return dayNarrative(date, liveMoment(), now);
  }

  if (scope === "incident") {
    const id = params.get("id");
    if (!id) throw badRequest("id is required for scope=incident, for example id=INC-0008.");
    const incident = incidents.find((i) => i.id === id.toUpperCase());
    if (!incident) throw notFound(`There is no incident ${id}.`);
    return incidentDraft(incident, now);
  }

  // scope=logs takes the same filters as /api/logs, plus date=YYYY-MM-DD as a shortcut for one day.
  const q = parseLogQuery(params);
  const date = params.get("date") ? dateParam(params.get("date"), TODAY) : null;
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
  ].filter(Boolean);
  return logsSummary(filterLogs(q), label.length ? label.join(", ") : "all filters", now);
}
