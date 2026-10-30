import type { Evidence, SystemId, Trace, TraceSearchHit, TraceStep } from "@/types/control";
import { logIdFor } from "@/data/logs";
import { STORIES, STORY_BY_SLUG, type Story } from "@/data/stories";
import { waitingMinutes } from "@/data/stats";
import { minutesBetween } from "@/data/time";
import { MAX_UPLOAD_MB } from "@/data/world";
import { cleanEvidence } from "./evidence";
import { notFound } from "./http";
import { store } from "./store";

const RECEIVED: Record<Story["source"], [SystemId, string]> = {
  whatsapp: ["whatsapp", "Received on WhatsApp"],
  outlook: ["outlook", "Received by email (Outlook)"],
  portal: ["reporter-portal", "Submitted on Reporter portal"],
};

const UNMATCHED_AFTER_MIN = 15;

function logEv(slug: string, step: string, label = "Log line"): Evidence[] {
  const id = logIdFor(`${slug}:${step}`);
  return id ? [{ kind: "log", id, label }] : [];
}

function alertEv(slug: string): Evidence[] {
  return store()
    .alerts.filter((a) => a.state !== "resolved" && a.evidence.some((e) => e.kind === "trace" && e.id === slug))
    .map((a) => ({ kind: "alert" as const, id: a.id, label: a.title }));
}

function waiting(system: SystemId, stage: string, detail?: string): TraceStep {
  return { at: null, system, stage, state: "waiting", detail };
}

export function buildTrace(s: Story): Trace {
  const { slug } = s;
  const files = s.files ?? { count: 0, mb: 0 };
  const steps: TraceStep[] = [];
  let state: Trace["state"] = "done";
  let stuckAt: string | null = null;

  const [srcSystem, srcStage] = RECEIVED[s.source];
  steps.push({
    at: s.receivedAt,
    system: srcSystem,
    stage: srcStage,
    state: "done",
    detail: s.reporter
      ? `from ${s.reporter} (${s.from}), ${files.count} files, ${files.mb} MB`
      : `from unknown number ${s.from}, no reporter matched; ${files.count} file, ${files.mb} MB`,
    evidence: logEv(slug, "received"),
  });

  if (s.desk === "waiting") {
    const mins = waitingMinutes(s);
    steps.push(waiting("assignment-desk", "Desk review", `waiting ${mins} min${s.reporter ? "" : " as needs_desk"}`));
    steps.at(-1)!.evidence = alertEv(slug);
    steps.push(waiting("ftp", "Uploaded to FTP"), waiting("samvadia-api", "Added to feed"), waiting("octopus", "Collected by Octopus"));
    if (mins >= UNMATCHED_AFTER_MIN && !s.reporter) {
      state = "stuck";
      stuckAt = "Desk review";
    } else {
      state = "on_track";
    }
    return { slug, headline: s.headline, reporter: s.reporter, city: s.city, source: s.source, state, stuckAt, steps };
  }

  if (s.desk === "rejected") {
    steps.push({ at: s.deskAt!, system: "assignment-desk", stage: "Rejected by desk", state: "done", detail: `by ${s.deskBy}: ${s.rejectReason}`, evidence: logEv(slug, "desk") });
    return { slug, headline: s.headline, reporter: s.reporter, city: s.city, source: s.source, state: "done", stuckAt: null, steps };
  }

  steps.push({ at: s.deskAt!, system: "assignment-desk", stage: "Approved by desk", state: "done", detail: `by ${s.deskBy}`, evidence: logEv(slug, "desk") });

  if (s.ftp === "failed") {
    const sizes = (s.oversize ?? []).map((f) => `${f.name} ${f.mb} MB`).join(", ");
    steps.push({
      at: s.ftpAttempts!.at(-1)!,
      system: "ftp",
      stage: "Uploaded to FTP",
      state: "failed",
      detail: `refused: ${sizes}; limit ${MAX_UPLOAD_MB} MB; ${s.ftpAttempts!.length} attempts`,
      evidence: [...logEv(slug, "ftp-failed", "Failed for good"), ...alertEv(slug)],
    });
    steps.push(waiting("samvadia-api", "Added to feed", "needs the files on FTP first"), waiting("octopus", "Collected by Octopus"));
    return { slug, headline: s.headline, reporter: s.reporter, city: s.city, source: s.source, state: "stuck", stuckAt: "Uploaded to FTP", steps };
  }
  if (s.ftp === "uploading") {
    steps.push(waiting("ftp", "Uploaded to FTP", `uploading ${files.count} files, ${files.mb} MB`));
    steps.at(-1)!.evidence = logEv(slug, "ftp");
    steps.push(waiting("samvadia-api", "Added to feed"), waiting("octopus", "Collected by Octopus"));
    return { slug, headline: s.headline, reporter: s.reporter, city: s.city, source: s.source, state: "on_track", stuckAt: null, steps };
  }

  steps.push({ at: s.ftpAt!, system: "ftp", stage: "Uploaded to FTP", state: "done", detail: `${files.count} files, ${files.mb} MB to vartmaan/incoming/${slug}/`, evidence: logEv(slug, "ftp") });
  steps.push({ at: s.feedAt!, system: "samvadia-api", stage: "Added to feed", state: "done", detail: `GUID vartmaan-${slug}-v1`, evidence: logEv(slug, "feed") });

  const late = minutesBetween(s.feedAt!, s.collectedAt!);
  steps.push({
    at: s.collectedAt!,
    system: "octopus",
    stage: "Collected by Octopus",
    state: "done",
    detail: late > 2 ? `${late} min late: Octopus was not polling (INC-0007)` : "next poll returned 200",
    evidence: [
      ...logEv(slug, "collected"),
      ...(late > 2 ? [{ kind: "incident" as const, id: "INC-0007", label: "INC-0007" }] : []),
    ],
  });

  if (s.ingestAt) {
    steps.push({ at: s.ingestAt, system: "socia-ingest", stage: "Taken in by Socia", state: "done", evidence: logEv(slug, "ingest") });
    if (s.digital === "skipped") {
      steps.push({ at: null, system: "socia-render", stage: "Card rendered", state: "skipped", detail: "text only, no visuals for a card" });
    } else if (s.digital === "render_failed") {
      const attempts = s.renderAttempts ?? [];
      steps.push({
        at: attempts.at(-1) ?? null,
        system: "socia-render",
        stage: "Card rendered",
        state: "failed",
        detail: `headline overflows the card text box; ${attempts.length} attempts`,
        evidence: [...logEv(slug, "render-failed", "Gave up"), ...alertEv(slug)],
      });
      steps.push(waiting("digital-desk", "Approved by operator"), waiting("x", "Posted on X"));
      state = "failed";
      stuckAt = "Card rendered";
    } else if (s.renderAt) {
      steps.push({ at: s.renderAt, system: "socia-render", stage: "Card rendered", state: "done", detail: "1080x1350", evidence: logEv(slug, "render") });
    }

    if (s.digital === "waiting_operator") {
      steps.push(waiting("digital-desk", "Approved by operator"), waiting("x", "Posted on X"));
      state = "on_track";
    } else if (s.digital === "operator_rejected") {
      steps.push({ at: s.operatorAt!, system: "digital-desk", stage: "Rejected by operator", state: "done", detail: `by ${s.operator}`, evidence: logEv(slug, "operator") });
    } else if (s.operatorAt) {
      steps.push({ at: s.operatorAt, system: "digital-desk", stage: "Approved by operator", state: "done", detail: `by ${s.operator}`, evidence: logEv(slug, "operator") });
    }
    if (s.postedAt) {
      steps.push({ at: s.postedAt, system: "x", stage: "Posted on X", state: "done", detail: `post id ${s.xPostId} (fake mode)`, evidence: logEv(slug, "posted") });
    }
    if (s.recalledAt) {
      steps.push({ at: s.recalledAt, system: "x", stage: "Recalled from X", state: "done", detail: s.recallReason, evidence: logEv(slug, "recalled") });
    }
  }

  return { slug, headline: s.headline, reporter: s.reporter, city: s.city, source: s.source, state, stuckAt, steps };
}

export function getTrace(slug: string): Trace {
  const story = STORY_BY_SLUG.get(slug) ?? STORY_BY_SLUG.get(slug.toUpperCase());
  if (!story) throw notFound(`No story with slug ${slug}. Check the spelling, or search with /api/trace?q=.`);
  const trace = buildTrace(story);
  return { ...trace, steps: trace.steps.map((st) => (st.evidence ? { ...st, evidence: cleanEvidence(st.evidence) } : st)) };
}

export function searchTraces(q: string | null): TraceSearchHit[] {
  const needle = (q ?? "").trim().toLowerCase();
  return STORIES.filter((s) => !needle || s.slug.toLowerCase().includes(needle) || s.headline.toLowerCase().includes(needle))
    .sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt))
    .slice(0, 20)
    .map((s) => ({ slug: s.slug, headline: s.headline, receivedAt: s.receivedAt }));
}
