// Incidents as they stood at 16:30. aiDraft is written on read from the incident itself.
import type { Incident } from "@/types/control";
import { logIdFor } from "./logs";
import { dayStats } from "./stats";
import { SLUGS, STORIES, STORY_BY_SLUG } from "./stories";
import { at, dateOf, ms, TODAY, YESTERDAY } from "./time";
import { MAX_UPLOAD_MB, OCTOPUS_GAP } from "./world";

export type IncidentRecord = Omit<Incident, "aiDraft">;

function logEv(key: string, label: string) {
  const id = logIdFor(key);
  return id ? [{ kind: "log" as const, id, label }] : [];
}

export function seedIncidents(): IncidentRecord[] {
  const s = dayStats();
  const delayed = STORIES.filter(
    (st) =>
      dateOf(st.receivedAt) === TODAY &&
      st.feedAt &&
      ms(st.feedAt) > ms(OCTOPUS_GAP.lastPollBefore) &&
      ms(st.feedAt) < ms(OCTOPUS_GAP.resumedAt),
  ).map((st) => st.slug);
  const rozgar = STORY_BY_SLUG.get(SLUGS.rozgar)!;
  const sizes = rozgar.oversize!.map((f) => `${f.mb} MB`).join(" and ");

  return [
    {
      id: "INC-0006",
      title: "Samvadia worker restarted after a memory spike",
      severity: "warning",
      status: "resolved",
      openedAt: at("15:20", YESTERDAY),
      resolvedAt: at("15:24", YESTERDAY),
      openedBy: "auto",
      systems: ["samvadia-worker"],
      impact: { storiesDelayed: 0, postsMissed: 0, minutesBlind: 0, summary: "3 jobs re-queued after the restart; no story lost" },
      affectedSlugs: [],
      timeline: [
        { at: at("15:20", YESTERDAY), kind: "log", text: "Worker used 2148 MB, over the 2048 MB limit, and restarted", evidence: logEv("worker-restart", "Restart log") },
        { at: at("15:20", YESTERDAY), kind: "status", text: "Incident opened automatically" },
        { at: at("15:21", YESTERDAY), kind: "log", text: "3 running jobs re-queued" },
        { at: at("15:24", YESTERDAY), kind: "status", text: "Resolved: worker back up and queues drained" },
      ],
      rootCause: "A large batch of media thumbnails was held in memory at once.",
      fix: "Worker restarted by its supervisor; jobs re-queued and finished.",
      followUps: [{ text: "Process thumbnails in batches of 20", done: true }],
      alertIds: [],
    },
    {
      id: "INC-0007",
      title: `Octopus stopped polling the feed for ${OCTOPUS_GAP.minutesBlind} min`,
      severity: "critical",
      status: "resolved",
      openedAt: at("11:42"),
      resolvedAt: at("11:53"),
      openedBy: "auto",
      systems: ["octopus", "samvadia-api"],
      impact: {
        storiesDelayed: delayed.length,
        postsMissed: 0,
        minutesBlind: OCTOPUS_GAP.minutesBlind,
        summary: `${delayed.length} stories reached Octopus late; blind 11:40 to 11:52`,
      },
      affectedSlugs: delayed,
      timeline: [
        { at: OCTOPUS_GAP.lastPollBefore, kind: "log", text: "Last poll from Octopus before the gap" },
        { at: at("11:42"), kind: "alert", text: "Alert fired: no poll from Octopus for 3 min", evidence: [{ kind: "alert", id: "ALR-0101", label: "ALR-0101" }, ...logEv("octopus-silent", "feed_log warning")] },
        { at: at("11:42"), kind: "status", text: "Incident opened automatically" },
        { at: at("11:44"), kind: "note", text: "vansh acked. The feed loads fine from this machine, so our side is up." },
        { at: at("11:47"), kind: "note", text: "Called Octopus IT; they are checking their network." },
        { at: at("11:51"), kind: "note", text: "Octopus IT: their office network switch rebooted and is coming back." },
        { at: OCTOPUS_GAP.resumedAt, kind: "log", text: `Octopus polling again after ${OCTOPUS_GAP.minutesBlind} min; ${delayed.length} waiting stories collected`, evidence: logEv("octopus-back", "Polling again") },
        { at: at("11:53"), kind: "status", text: "Resolved" },
        { at: at("12:10"), kind: "note", text: "Follow-up: give Octopus a second allowed IP so one network path cannot blind us." },
      ],
      rootCause: OCTOPUS_GAP.cause,
      fix: "The switch came back by itself at 11:51; Octopus polled again at 11:52 and collected every waiting story.",
      followUps: [
        { text: "Add a second allowed IP for Octopus", done: false },
        { text: "Ask Octopus IT to tell us before switch maintenance", done: true },
      ],
      alertIds: ["ALR-0101"],
    },
    {
      id: "INC-0008",
      title: `${s.ftpFailedFiles} Ajmer videos cannot reach FTP (over ${MAX_UPLOAD_MB} MB)`,
      severity: "critical",
      status: "open",
      openedAt: at("14:07"),
      resolvedAt: null,
      openedBy: "auto",
      systems: ["ftp", "samvadia-worker"],
      impact: {
        storiesDelayed: 1,
        postsMissed: 0,
        minutesBlind: 0,
        summary: "1 approved story cannot enter the feed until its 2 videos are on FTP",
      },
      affectedSlugs: [SLUGS.rozgar],
      timeline: [
        { at: rozgar.deskAt!, kind: "log", text: `Story approved by ${rozgar.deskBy}`, evidence: [{ kind: "trace", id: SLUGS.rozgar, label: SLUGS.rozgar }] },
        { at: rozgar.ftpAttempts![0], kind: "log", text: `Upload refused: ${sizes}, over the ${MAX_UPLOAD_MB} MB limit`, evidence: logEv(`${SLUGS.rozgar}:ftp-refused`, "Refused upload") },
        { at: at("14:07"), kind: "alert", text: "Alert fired: FTP uploads from Ajmer failed", evidence: [{ kind: "alert", id: "ALR-0102", label: "ALR-0102" }] },
        { at: at("14:07"), kind: "status", text: "Incident opened automatically" },
        { at: rozgar.ftpAttempts![2], kind: "log", text: "Media job failed for good after 3 attempts", evidence: logEv(`${SLUGS.rozgar}:ftp-failed`, "Final failure") },
        { at: at("14:25"), kind: "note", text: "Desk is trying to reach Ramesh to send the two videos by FTP." },
      ],
      rootCause: `Both videos are larger than MAX_UPLOAD_MB (${MAX_UPLOAD_MB}). The portal accepted them, but the worker refuses anything over the limit.`,
      fix: "Ask Ramesh to send the videos by FTP, then POST /desk/media/{id}/retry.",
      followUps: [{ text: "Make the Reporter portal warn about files over the limit before upload", done: false }],
      alertIds: ["ALR-0102"],
    },
  ];
}
