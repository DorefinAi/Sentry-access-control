// Facts about today that are not stories: limits, the Octopus gap, the X cap, the dead email.
import { at } from "./time";

export const MAX_UPLOAD_MB = 500;

export const FEED_PATH_MASKED = "/feed/••••/feed.xml";

// Octopus polls every minute. It missed every poll from 11:40 to 11:51.
export const OCTOPUS_GAP = {
  lastPollBefore: at("11:39"),
  from: at("11:40"),
  resumedAt: at("11:52"),
  minutesBlind: 12,
  cause: "Office network switch on the Octopus side rebooted; their poller had no route to us.",
};

// Octopus polls at :28 past each minute, so at 16:30:00 the last poll was 32 s ago.
export const POLL_SECOND = 28;
export const OCTOPUS_LAST_POLL_SEC_AGO = 32;

// X writes today: posts + media uploads + deletes, against the daily cap.
export const X_CAP = { limit: 50, media: 18, deletes: 1 };

export const UNKNOWN_WA_NUMBER = "919999000111";

export const MAIL_DEAD = {
  at: at("09:14"),
  resolvedAt: at("09:31"),
  from: "kota.bureau@vartmaan.in",
  subject: "Dussehra mela visuals",
  attempts: 3,
  graphStatus: 500,
};

export const BACKUP = {
  ranAt: at("02:00"),
  finishedAt: at("02:06"),
  dir: "D:\\pg-backups",
  keep: 14,
  samvadiaMb: 412,
  sociaMb: 96,
};

export const DESK_USERS: Record<string, { name: string; role: string }> = {
  vansh: { name: "Vansh", role: "super admin" },
  lead: { name: "Desk lead", role: "admin" },
  desk: { name: "Assignment desk", role: "assignment desk" },
  chief: { name: "Chief editor", role: "chief editor" },
};
