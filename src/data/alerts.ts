// Today's alerts as they stood at 16:30. The store copies these at start; PATCH changes the copy.
import type { Alert, Evidence } from "@/types/control";
import { logIdFor } from "./logs";
import { dayStats, waitingMinutes, xCap } from "./stats";
import { SLUGS, STORY_BY_SLUG } from "./stories";
import { at } from "./time";
import { MAIL_DEAD, MAX_UPLOAD_MB, OCTOPUS_GAP, UNKNOWN_WA_NUMBER } from "./world";

function logEv(key: string, label: string): Evidence[] {
  const id = logIdFor(key);
  return id ? [{ kind: "log", id, label }] : [];
}

export function seedAlerts(): Alert[] {
  const s = dayStats();
  const cap = xCap();
  const rozgar = STORY_BY_SLUG.get(SLUGS.rozgar)!;
  const unknown = STORY_BY_SLUG.get(SLUGS.unknown)!;
  const sizes = rozgar.oversize!.map((f) => `${f.mb} MB`).join(" and ");

  return [
    {
      id: "ALR-0100",
      ruleId: "mail-dead",
      title: `Outlook email moved to mail_dead after ${MAIL_DEAD.attempts} failures`,
      severity: "info",
      state: "resolved",
      systems: ["outlook", "samvadia-worker"],
      firedAt: MAIL_DEAD.at,
      lastSeenAt: MAIL_DEAD.at,
      ackedAt: at("09:16"),
      resolvedAt: MAIL_DEAD.resolvedAt,
      note: `Kota bureau resent the mail at 09:27; it went through as ${SLUGS.dussehra}.`,
      evidence: [
        ...logEv("mail-dead", "Moved to mail_dead at 09:14"),
        { kind: "trace", id: SLUGS.dussehra, label: "The resent story" },
        { kind: "system", id: "outlook", label: "Outlook" },
      ],
      runbook: {
        meaning: "An email could not be processed after all retries and was parked in mail_dead. Its story did not reach the desk.",
        checkFirst: [
          "Open the dead email in the worker logs and read the last error.",
          "If Graph returned 5xx, it was Microsoft's side; one email is not a pattern.",
          "Check whether other emails from the same sender went through.",
        ],
        fix: [
          "Ask the sender to resend, or requeue the email from mail_dead once Graph is healthy.",
          "Confirm the resent item appears on the desk.",
        ],
      },
      incidentId: null,
    },
    {
      id: "ALR-0101",
      ruleId: "octopus-silent",
      title: `Octopus has not polled the feed for ${OCTOPUS_GAP.minutesBlind} min`,
      severity: "critical",
      state: "resolved",
      systems: ["octopus", "samvadia-api"],
      firedAt: at("11:42"),
      lastSeenAt: at("11:51"),
      ackedAt: at("11:44"),
      resolvedAt: OCTOPUS_GAP.resumedAt,
      note: "Octopus IT confirmed a switch reboot on their side.",
      evidence: [
        ...logEv("octopus-silent", "First warning: no poll for 3 min"),
        ...logEv("octopus-back", "Polling again at 11:52"),
        { kind: "incident", id: "INC-0007", label: "INC-0007" },
        { kind: "system", id: "octopus", label: "Octopus" },
      ],
      runbook: {
        meaning: "Octopus normally fetches our feed every minute. No requests in feed_log means stories in the feed are not reaching the newsroom system.",
        checkFirst: [
          "Look at feed_log: when was the last GET /feed/…/feed.xml?",
          "Open the feed URL yourself from this machine; if it loads, our side is fine.",
          "Call Octopus IT and ask if their poller or network is down.",
        ],
        fix: [
          "If our side is down, restart Samvadia API and check the feed loads.",
          "If their side is down, wait for them; tell the desk which stories are waiting.",
          "When polls resume, check every waiting story shows as collected.",
        ],
      },
      incidentId: "INC-0007",
    },
    {
      id: "ALR-0102",
      ruleId: "ftp-upload-failed",
      title: `${s.ftpFailedFiles} FTP uploads from Ajmer failed (files over ${MAX_UPLOAD_MB} MB)`,
      severity: "critical",
      state: "open",
      systems: ["ftp", "samvadia-worker"],
      firedAt: rozgar.ftpAttempts![0],
      lastSeenAt: rozgar.ftpAttempts![rozgar.ftpAttempts!.length - 1],
      ackedAt: null,
      resolvedAt: null,
      note: null,
      evidence: [
        ...logEv(`${SLUGS.rozgar}:ftp-refused`, `Upload refused: ${sizes}`),
        ...logEv(`${SLUGS.rozgar}:ftp-failed`, "Failed for good after 3 attempts"),
        { kind: "trace", id: SLUGS.rozgar, label: SLUGS.rozgar },
        { kind: "incident", id: "INC-0008", label: "INC-0008" },
      ],
      runbook: {
        meaning: `The worker could not put the story's videos on FTP because each file is over MAX_UPLOAD_MB (${MAX_UPLOAD_MB}). The story is approved but cannot enter the feed until the files are on FTP.`,
        checkFirst: [
          "Open the trace and confirm which files were refused and their sizes.",
          "Check the FTP server is up (other uploads today went through).",
        ],
        fix: [
          `Ask Ramesh to send the two videos straight to FTP folder vartmaan/incoming/${SLUGS.rozgar}/.`,
          "When the files are there, call POST /desk/media/{id}/retry for the item (or press Retry on the desk).",
          "Check the story appears in the feed and Octopus collects it.",
        ],
      },
      incidentId: "INC-0008",
    },
    {
      id: "ALR-0103",
      ruleId: "render-failed",
      title: `Card render failed for ${SLUGS.rain} (text overflow, 3 attempts)`,
      severity: "warning",
      state: "open",
      systems: ["socia-render"],
      firedAt: at("15:21"),
      lastSeenAt: at("15:21"),
      ackedAt: null,
      resolvedAt: null,
      note: null,
      evidence: [
        ...logEv(`${SLUGS.rain}:render-failed`, "Gave up after 3 attempts"),
        { kind: "trace", id: SLUGS.rain, label: SLUGS.rain },
        { kind: "system", id: "socia-render", label: "Socia render" },
      ],
      runbook: {
        meaning: "Socia could not make the social card for this draft. The headline is longer than the card's text box. The story itself is fine and already in the Octopus feed; only the X post is blocked.",
        checkFirst: ["Open the draft on the Digital desk and look at the card headline length."],
        fix: [
          "Shorten the card headline on the Digital desk.",
          "Press Re-render; then approve the draft so it can post.",
        ],
      },
      incidentId: null,
    },
    {
      id: "ALR-0104",
      ruleId: "x-cap",
      title: `X daily cap ${cap.pct}% used`,
      severity: "warning",
      state: "acked",
      systems: ["socia-publish", "x"],
      firedAt: at("15:40"),
      lastSeenAt: at("16:28"),
      ackedAt: at("15:46"),
      resolvedAt: null,
      note: "Fake mode, nothing really posts. Watching it.",
      evidence: [
        ...logEv("x-cap", "Cap crossed 80% at 15:40"),
        { kind: "system", id: "x", label: "X" },
      ],
      runbook: {
        meaning: `Socia has used ${cap.used} of ${cap.limit} daily X writes (posts, media uploads and deletes). At 100% further posts fail until midnight.`,
        checkFirst: ["Check how many drafts are still waiting for an operator.", "Check if anything is retrying posts in a loop."],
        fix: ["Hold low-value posts until after midnight.", "If a loop is retrying, stop it on the Digital desk."],
      },
      incidentId: null,
    },
    {
      id: "ALR-0105",
      ruleId: "desk-unmatched",
      title: `WhatsApp item from unknown number ${UNKNOWN_WA_NUMBER} waiting ${waitingMinutes(unknown)} min`,
      severity: "warning",
      state: "open",
      systems: ["whatsapp", "assignment-desk"],
      firedAt: at("16:07"),
      lastSeenAt: at("16:30"),
      ackedAt: null,
      resolvedAt: null,
      note: null,
      evidence: [
        ...logEv(`${SLUGS.unknown}:received`, "No reporter matched"),
        { kind: "trace", id: SLUGS.unknown, label: "The waiting item" },
      ],
      runbook: {
        meaning: "A WhatsApp message came from a number that is not any reporter's. It sits as needs_desk until someone on the desk decides what it is.",
        checkFirst: [
          "Open the item on the Assignment desk and look at the media.",
          "Check whether a reporter changed their phone number.",
        ],
        fix: [
          "If it is a reporter's new number, update their profile and match the item.",
          "If it is a tip from the public, accept it as a tip or reject it.",
        ],
      },
      incidentId: null,
    },
  ];
}
