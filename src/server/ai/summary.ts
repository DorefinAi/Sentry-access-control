// Written text from static templates (no AI yet: model "static"). Each template prints only numbers
// from the real facts it is given (ops summaries, alerts, incidents, log counts), and every summary
// is checked by verifyNumbers against those same facts.
import type { AiSummary, Alert, Evidence, Incident } from "@/types/control";
import { SYSTEM_LABEL } from "@/types/people";
import { systemName } from "../catalog";
import { cleanEvidence } from "../evidence";
import type { IncidentRecord } from "../incidents";
import type { LogStats } from "../logs";
import type { OpsSummary } from "../ops/types";
import { hhmm } from "../time";
import { verifyNumbers, type Facts } from "./verifyNumbers";

export const STATIC_MODEL = "static";

export function makeSummary(text: string, evidence: Evidence[], facts: Facts, generatedAt: string): AiSummary {
  return { text, evidence: cleanEvidence(evidence), model: STATIC_MODEL, generatedAt, unverifiedNumbers: verifyNumbers(text, facts) };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Alerts not yet resolved and worth a person's attention. Acked ones still count: acking says "seen",
// not "fixed", and the headline must not say all is well while a stage is still red.
export function needsYou(alerts: Alert[]): Alert[] {
  return alerts.filter((a) => a.state !== "resolved" && a.severity !== "info");
}

export function headlineFor(alerts: Alert[]): string {
  const n = needsYou(alerts).length;
  return n === 0 ? "All good" : `${n} ${n === 1 ? "thing needs" : "things need"} you`;
}

/** What one day's paragraph is written from. */
export interface DayFacts {
  date: string;
  today: boolean; // true: describes now (open alerts count); false: a past day's totals
  samvadia: OpsSummary | null;
  socia: OpsSummary | null;
  problems: string[]; // why a backend's numbers are missing
  alerts: Alert[];
  incidents: IncidentRecord[]; // opened that day
}

export function dayNarrative(f: DayFacts, generatedAt: string): AiSummary {
  const evidence: Evidence[] = f.incidents.map((i) => ({ kind: "incident", id: i.id, label: `${i.id}: ${i.title}` }));
  const open = f.today ? needsYou(f.alerts) : [];
  const lines: string[] = [];
  if (f.today) lines.push(open.length ? `**${headlineFor(f.alerts)}.**` : "**All good right now.**");

  const s = f.samvadia;
  if (s) {
    const b = s.flow.bySource;
    lines.push(
      `${plural(s.flow.storiesIn, "story", "stories")} came in${f.today ? " today" : ""} (${b.whatsapp} WhatsApp, ${b.outlook} Outlook, ${b.portal} portal); ${s.flow.approved} approved, ${s.flow.rejected} rejected, ${s.flow.inFeed} in the feed and ${s.flow.collected} collected by Octopus.` +
        (s.flow.medianMinutesToFeed !== null ? ` Median time to feed ${f.today ? "is" : "was"} ${s.flow.medianMinutesToFeed} min.` : ""),
    );
    if (s.stuck.length) lines.push(`${plural(s.stuck.length, "story is", "stories are")} stuck in Samvadia.`);
  }
  const x = f.socia;
  if (x) {
    lines.push(`Socia took in ${plural(x.flow.storiesIn, "breaking story", "breaking stories")}; ${x.flow.posts} marked posted on X, ${x.flow.recalled} recalled.`);
    if (x.stuck.length) lines.push(`${plural(x.stuck.length, "item is", "items are")} stuck in Socia.`);
  }
  for (const p of f.problems) lines.push(p);
  if (open.length) {
    lines.push(`Not fixed yet: ${open.map((a) => a.title).join("; ")}.`);
    evidence.unshift(...open.map((a) => ({ kind: "alert" as const, id: a.id, label: a.title })));
  }
  for (const i of f.incidents) lines.push(`${i.id} (${i.status}): ${i.title}.`);
  if (lines.length === (f.today ? 1 : 0)) lines.push(`Sentry has no numbers for ${f.date}.`);

  const facts: Facts = {
    values: { samvadia: s && { flow: s.flow, stuck: s.stuck.length }, socia: x && { flow: x.flow, stuck: x.stuck.length }, needYou: open.length },
    quotable: [f.date, ...open.map((a) => a.title), ...f.problems, ...f.incidents.flatMap((i) => [i.id, i.title])],
  };
  return makeSummary(lines.join(" "), evidence, facts, generatedAt);
}

/** A backend's numbers are missing: the plain reason, for the paragraph. */
export const missingLine = (source: "samvadia" | "socia", problem: string | null) => {
  const why = (problem ?? "no data").trim();
  return `No numbers from ${SYSTEM_LABEL[source]}: ${why}${/[.?!]$/.test(why) ? "" : "."}`;
};

export function incidentDraft(i: IncidentRecord, generatedAt: string): AiSummary {
  const openFollowUps = i.followUps.filter((f) => !f.done).length;
  const opened = hhmm(i.openedAt);
  const resolved = i.resolvedAt ? hhmm(i.resolvedAt) : null;
  const parts = [
    `${i.title}.`,
    `Opened ${opened} ${i.openedBy === "auto" ? "automatically" : "by hand"}${resolved ? `, resolved ${resolved}` : `, still ${i.status}`}.`,
    `Impact: ${i.impact.summary}.`,
    i.rootCause ? `Likely cause: ${i.rootCause}` : "Cause not known yet.",
    i.fix ? `Fix: ${i.fix}` : "",
    openFollowUps ? `${plural(openFollowUps, "follow-up is", "follow-ups are")} still open.` : "",
  ].filter(Boolean);
  const evidence: Evidence[] = [
    ...i.alertIds.map((id) => ({ kind: "alert" as const, id, label: id })),
    ...i.affectedSlugs.map((slug) => ({ kind: "trace" as const, id: slug, label: slug })),
  ];
  // Title, cause and fix are the incident's own text (people can edit them), so they are quoted as-is.
  const facts: Facts = {
    values: { openFollowUps, impact: i.impact },
    quotable: [i.title, i.impact.summary, i.rootCause, i.fix, opened, resolved],
  };
  return makeSummary(parts.join(" "), evidence, facts, generatedAt);
}

export function withDraft(i: IncidentRecord, generatedAt: string): Incident {
  return {
    ...i,
    timeline: i.timeline.map((e) => (e.evidence ? { ...e, evidence: cleanEvidence(e.evidence) } : e)),
    aiDraft: incidentDraft(i, generatedAt),
  };
}

// Takes counts over every matching line (logStats in logs.ts), so a large window is summarised exactly.
export function logsSummary(stats: LogStats, scopeLabel: string, generatedAt: string): AiSummary {
  const { total, byLevel, topError } = stats;
  const topSystems = stats.bySystem.slice(0, 3);
  const name = (id: string) => systemName(id);

  // Only the counts are facts; the scope label, system names and the quoted error are repeated verbatim.
  const facts: Facts = {
    values: { total, byLevel, topSystems: topSystems.map(([, n]) => n), topErrorCount: topError?.count ?? 0 },
    quotable: [scopeLabel, topError?.message, ...topSystems.map(([id]) => name(id))],
  };

  if (!total) {
    return makeSummary(`No log lines match ${scopeLabel}.`, [], facts, generatedAt);
  }
  const parts = [
    `${plural(total, "log line matches", "log lines match")} ${scopeLabel}: ${byLevel.error} errors, ${byLevel.warn} warnings.`,
    `Most come from ${topSystems.map(([id, n]) => `${name(id)} (${n})`).join(", ")}.`,
  ];
  const evidence: Evidence[] = [];
  if (topError) {
    parts.push(`The most common error is "${topError.message}" (${plural(topError.count, "time", "times")}).`);
    evidence.push({ kind: "log", id: topError.firstId, label: "First of these errors" });
  } else {
    parts.push("There are no errors in this set.");
  }
  return makeSummary(parts.join(" "), evidence, facts, generatedAt);
}
