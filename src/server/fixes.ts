// "What to fix", ranked: severity first, then open before acked, then oldest first.
// Unresolved alerts make fixes (their runbook steps); stories stuck past a stage's limit come next,
// oldest first; open follow-ups on resolved incidents come last. Every number is from live data.
import type { Alert, Fix, Severity } from "@/types/control";
import { SYSTEM_LABEL } from "@/types/people";
import { cleanEvidence } from "./evidence";
import { liveMoment, type Moment } from "./moment";
import type { OpsSource } from "./ops/types";
import { hhmm } from "./time";

const SEV: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
const MAX_STUCK_FIXES = 10;

function fixForAlert(a: Alert, m: Moment): Omit<Fix, "rank"> {
  const openMin = Math.max(0, Math.round((m.atMs - Date.parse(a.firedAt)) / 60_000));
  const slugs = a.evidence.filter((e) => e.kind === "trace").length;
  return {
    id: `fix-${a.id}`,
    title: a.runbook.fix[0] ?? a.title,
    severity: a.severity,
    impact: slugs ? `${a.title}; ${slugs} ${slugs === 1 ? "story" : "stories"} held up` : a.title,
    why: `${a.runbook.meaning} Open since ${hhmm(a.firedAt)} (${openMin} min)${a.state === "acked" ? ", acked" : ""}.`,
    steps: [...a.runbook.checkFirst, ...a.runbook.fix],
    evidence: [{ kind: "alert", id: a.id, label: a.id }, ...a.evidence],
    alertId: a.id,
  };
}

function stuckFixes(m: Moment): Omit<Fix, "rank">[] {
  return (["samvadia", "socia"] as OpsSource[])
    .flatMap((source) => (m.ops[source].summary?.stuck ?? []).map((s) => ({ source, s })))
    .sort((a, b) => b.s.minutes - a.s.minutes)
    .slice(0, MAX_STUCK_FIXES)
    .map(({ source, s }) => ({
      id: `fix-stuck-${source}-${s.slug}`,
      title: `Move ${s.slug} on from ${s.stage}`,
      severity: "warning" as const,
      impact: `${s.headline || s.slug} has waited ${s.minutes} min at ${s.stage}`,
      why: `${SYSTEM_LABEL[source]} reports it at ${s.stage} since ${hhmm(s.since)}, longer than that stage's limit.`,
      steps: [`Open the trace of ${s.slug} to see the last step that worked.`, `Check the system behind ${s.stage} on Systems.`, "Unblock it (decide on the desk, re-run the upload, restart the worker)."],
      evidence: [{ kind: "trace" as const, id: s.slug, label: s.slug }],
      alertId: null,
    }));
}

export function listFixes(m: Moment = liveMoment()): Fix[] {
  const fromAlerts = m.alerts
    .filter((a) => a.state !== "resolved")
    .sort((a, b) => SEV[a.severity] - SEV[b.severity] || Number(a.state === "acked") - Number(b.state === "acked") || Date.parse(a.firedAt) - Date.parse(b.firedAt))
    .map((a) => fixForAlert(a, m));

  const followUps = m.incidents
    .filter((i) => i.status === "resolved")
    .flatMap((i) =>
      i.followUps
        .map((f, n) => ({ f, n }))
        .filter(({ f }) => !f.done)
        .map(
          ({ f, n }): Omit<Fix, "rank"> => ({
            id: `fix-${i.id}-${n}`,
            title: f.text,
            severity: "info",
            impact: `Follow-up from ${i.id}: ${i.impact.summary}`,
            why: `${i.id} is resolved, but this follow-up is still open.${i.rootCause ? ` ${i.rootCause}` : ""}`,
            steps: [f.text, `Tick it off on ${i.id} when done.`],
            evidence: [{ kind: "incident", id: i.id, label: `${i.id}: ${i.title}` }],
            alertId: null,
          }),
        ),
    );

  return [...fromAlerts, ...stuckFixes(m), ...followUps].map((fix, i) => ({ ...fix, evidence: cleanEvidence(fix.evidence), rank: i + 1 }));
}
