// Written text for Phase 1. Each template prints only numbers from the facts it builds, and every
// summary is checked by verifyNumbers against those same curated facts (never raw records).
import type { AiSummary, Alert, Evidence, Incident, LogEntry } from "@/types/control";
import { YESTERDAY_FLOW } from "@/data/daily";
import { SYSTEM_BY_ID } from "@/data/systems";
import { hhmm, ms, TODAY } from "@/data/time";
import { BACKUP, OCTOPUS_GAP } from "@/data/world";
import type { IncidentRecord } from "@/data/incidents";
import { cleanEvidence } from "../evidence";
import type { Moment } from "../moment";
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

function incidentQuotes(list: IncidentRecord[]): string[] {
  return list.flatMap((i) => [i.id, i.title, i.impact.summary]);
}

// For today the text describes the moment m (live, or a replay); other days use their totals.
export function dayNarrative(date: string, m: Moment, generatedAt: string): AiSummary {
  const { alerts, incidents } = m;
  const dayIncidents = incidents.filter((i) => i.openedAt.startsWith(date));
  const evidence: Evidence[] = dayIncidents.map((i) => ({ kind: "incident", id: i.id, label: `${i.id}: ${i.title}` }));

  if (date !== TODAY) {
    const f = YESTERDAY_FLOW;
    const parts = [
      `${f.storiesIn} stories came in (${f.bySource.whatsapp} WhatsApp, ${f.bySource.outlook} Outlook, ${f.bySource.portal} portal); ${f.approved} approved, ${f.rejected} rejected, ${f.inFeed} in the feed and ${f.collected} collected by Octopus.`,
      `Median time to feed was ${f.medianMinutesToFeed} min. ${f.xPosts} posts went out on X.`,
      ...dayIncidents.map((i) => `${i.id} (${i.status}): ${i.title}; ${i.impact.summary}.`),
    ];
    return makeSummary(parts.join(" "), evidence, { values: { flow: f }, quotable: incidentQuotes(dayIncidents) }, generatedAt);
  }

  const s = m.stats;
  const cap = m.cap;
  const backupDone = ms(m.at) >= ms(BACKUP.finishedAt);
  const open = needsYou(alerts);
  const octopus = dayIncidents.find((i) => i.systems.includes("octopus"));
  const times = [hhmm(OCTOPUS_GAP.from), hhmm(OCTOPUS_GAP.resumedAt), hhmm(BACKUP.ranAt), hhmm(OCTOPUS_GAP.lastPollBefore)];

  const lines: string[] = [];
  lines.push(
    open.length ? `**${headlineFor(alerts)}.**` : "**All good right now.**",
    `${s.storiesIn} stories came in today (${s.bySource.whatsapp} WhatsApp, ${s.bySource.outlook} Outlook, ${s.bySource.portal} portal); ${s.approved} approved, ${s.rejected} rejected, ${s.inFeed} in the feed and ${s.collected} collected by Octopus. Median time to feed is ${s.medianMinutesToFeed} min.`,
  );
  if (open.length) {
    lines.push(`Not fixed yet: ${open.map((a) => a.title).join("; ")}.`);
    evidence.unshift(...open.map((a) => ({ kind: "alert" as const, id: a.id, label: a.title })));
  }
  if (octopus) {
    lines.push(
      octopus.status !== "resolved" && ms(m.at) < ms(OCTOPUS_GAP.resumedAt)
        ? `Octopus has not polled since ${times[3]}; incident ${octopus.id} is open.`
        : `Octopus was blind ${octopus.impact.minutesBlind} min (${times[0]} to ${times[1]}); ${plural(octopus.impact.storiesDelayed, "story", "stories")} reached it late${octopus.status === "resolved" ? " and it has recovered" : ""}.`,
    );
  }
  lines.push(`On X: ${s.xPosts} posts, ${s.xRecalled} recalled, ${cap.pct}% of the daily cap used.${backupDone ? ` Backup ran at ${times[2]} OK.` : ""}`);

  const facts: Facts = {
    values: { stats: s, capPct: cap.pct, needYou: open.length, octopus: octopus?.impact },
    quotable: [...open.map((a) => a.title), ...times, octopus?.id],
  };
  return makeSummary(lines.join(" "), evidence, facts, generatedAt);
}

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

export function logsSummary(entries: LogEntry[], scopeLabel: string, generatedAt: string): AiSummary {
  const byLevel = { error: 0, warn: 0, info: 0, debug: 0 };
  const bySystem = new Map<string, number>();
  const errorMessages = new Map<string, { count: number; first: LogEntry }>();
  for (const e of entries) {
    byLevel[e.level]++;
    bySystem.set(e.system, (bySystem.get(e.system) ?? 0) + 1);
    if (e.level === "error") {
      const m = errorMessages.get(e.message);
      if (m) m.count++;
      else errorMessages.set(e.message, { count: 1, first: e });
    }
  }
  const topSystems = [...bySystem.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const topError = [...errorMessages.entries()].sort((a, b) => b[1].count - a[1].count)[0];
  const name = (id: string) => SYSTEM_BY_ID.get(id as never)?.name ?? id;

  // Only the counts are facts; the scope label, system names and the quoted error are repeated verbatim.
  const facts: Facts = {
    values: { total: entries.length, byLevel, topSystems: topSystems.map(([, n]) => n), topErrorCount: topError?.[1].count ?? 0 },
    quotable: [scopeLabel, topError?.[0], ...topSystems.map(([id]) => name(id))],
  };

  if (!entries.length) {
    return makeSummary(`No log lines match ${scopeLabel}.`, [], facts, generatedAt);
  }
  const parts = [
    `${plural(entries.length, "log line matches", "log lines match")} ${scopeLabel}: ${byLevel.error} errors, ${byLevel.warn} warnings.`,
    `Most come from ${topSystems.map(([id, n]) => `${name(id)} (${n})`).join(", ")}.`,
  ];
  const evidence: Evidence[] = [];
  if (topError) {
    parts.push(`The most common error is "${topError[0]}" (${plural(topError[1].count, "time", "times")}).`);
    evidence.push({ kind: "log", id: topError[1].first.id, label: "First of these errors" });
  } else {
    parts.push("There are no errors in this set.");
  }
  return makeSummary(parts.join(" "), evidence, facts, generatedAt);
}
