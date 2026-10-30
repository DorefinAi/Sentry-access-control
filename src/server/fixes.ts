// "What to fix", ranked: severity first, then open before acked, then oldest first.
// Unresolved alerts make fixes; open follow-ups on resolved incidents come last.
import type { Alert, Fix, Severity } from "@/types/control";
import { waitingMinutes } from "@/data/stats";
import { SLUGS, STORY_BY_SLUG } from "@/data/stories";
import { hhmm, minutesBetween } from "@/data/time";
import { MAX_UPLOAD_MB, UNKNOWN_WA_NUMBER } from "@/data/world";
import { cleanEvidence } from "./evidence";
import { liveMoment, type Moment } from "./moment";

const SEV: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

function fixForAlert(a: Alert, m: Moment): Omit<Fix, "rank"> {
  const s = m.stats;
  const storyNow = (slug: string) => m.stories.find((x) => x.slug === slug) ?? STORY_BY_SLUG.get(slug)!;
  const base = { id: `fix-${a.id}`, severity: a.severity, steps: a.runbook.fix, evidence: a.evidence, alertId: a.id };

  switch (a.ruleId) {
    case "ftp-upload-failed": {
      const st = storyNow(SLUGS.rozgar);
      const tries = st.ftpAttempts?.length ?? 0;
      const sizes = st.oversize!.map((f) => `${f.mb} MB`).join(" and ");
      return {
        ...base,
        title: `Get the ${st.oversize!.length} Ajmer videos onto FTP`,
        impact: `1 approved story (${st.slug}) cannot enter the feed`,
        why: `Both videos (${sizes}) are over the ${MAX_UPLOAD_MB} MB upload limit, so the worker refused them ${tries === 1 ? "once" : `${tries} times`}. The story was approved at ${hhmm(st.deskAt!)} and has waited ${minutesBetween(st.deskAt!, m.at)} min since. FTP itself is fine: ${s.inFeed} other uploads went through today.`,
      };
    }
    case "render-failed": {
      const st = STORY_BY_SLUG.get(SLUGS.rain)!;
      const tries = st.renderAttempts!;
      return {
        ...base,
        title: `Shorten the card headline for ${st.slug} and re-render`,
        impact: "The story is in the feed, but its X post is blocked",
        why: `Socia tried ${tries.length} times between ${hhmm(tries[0])} and ${hhmm(tries[tries.length - 1])}; each time the headline overflowed the card box. The story already reached Octopus at ${hhmm(st.collectedAt!)}, so only the X post waits.`,
      };
    }
    case "desk-unmatched": {
      const st = storyNow(SLUGS.unknown);
      const mins = waitingMinutes(st, m.at);
      return {
        ...base,
        title: `Decide on the WhatsApp item from ${UNKNOWN_WA_NUMBER}`,
        impact: `1 item has waited ${mins} min with no reporter`,
        why: `No reporter has the number ${UNKNOWN_WA_NUMBER}, so Samvadia parked the item as needs_desk at ${hhmm(st.receivedAt)}. It has waited ${mins} min. It may be a reporter's new phone or a tip from the public.`,
      };
    }
    case "x-cap": {
      const cap = m.cap;
      return {
        ...base,
        title: `Watch the X cap (${cap.pct}% used)`,
        impact: `${cap.limit - cap.used} X writes left today`,
        why: `Socia has used ${cap.used} of ${cap.limit} writes: ${cap.posts} posts, ${cap.media} media uploads and ${cap.deletes} delete. ${s.waitingOperator} drafts still wait for an operator, so there is room if nothing loops.`,
      };
    }
    default:
      return { ...base, title: a.title, impact: a.runbook.meaning, why: a.runbook.meaning };
  }
}

export function listFixes(m: Moment = liveMoment()): Fix[] {
  const { alerts, incidents } = m;
  const fromAlerts = alerts
    .filter((a) => a.state !== "resolved")
    .sort(
      (a, b) =>
        SEV[a.severity] - SEV[b.severity] ||
        Number(a.state === "acked") - Number(b.state === "acked") ||
        Date.parse(a.firedAt) - Date.parse(b.firedAt),
    )
    .map((a) => fixForAlert(a, m));

  const followUps = incidents
    .filter((i) => i.status === "resolved")
    .sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt))
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
            why: `${i.id} is resolved, but this follow-up is still open. ${i.rootCause}`,
            steps: [f.text, `Tick it off on ${i.id} when done.`],
            evidence: [{ kind: "incident", id: i.id, label: `${i.id}: ${i.title}` }],
            alertId: null,
          }),
        ),
    );

  return [...fromAlerts, ...followUps].map((fix, i) => ({ ...fix, evidence: cleanEvidence(fix.evidence), rank: i + 1 }));
}
