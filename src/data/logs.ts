// Logs for 26 and 27 Oct, generated once at module load from the stories and today's facts.
// The noise uses a seeded PRNG, so every restart produces the same ids and lines.
import type { LogEntry, LogLevel, SystemId } from "@/types/control";
import { LOGINS } from "./logins";
import { STORIES, type Story } from "./stories";
import { addMin, at, dateOf, hhmm, ms, NOW, TODAY, YESTERDAY } from "./time";
import { BACKUP, FEED_PATH_MASKED, POLL_SECOND, MAIL_DEAD, MAX_UPLOAD_MB, OCTOPUS_GAP, UNKNOWN_WA_NUMBER, X_CAP } from "./world";

type Raw = Omit<LogEntry, "id"> & { key?: string };

const raw: Raw[] = [];

function log(
  when: string,
  system: SystemId,
  level: LogLevel,
  logger: string,
  message: string,
  extra: { slug?: string; itemId?: string; fields?: LogEntry["fields"]; key?: string } = {},
) {
  if (ms(when) > ms(NOW)) return;
  raw.push({ at: when, system, level, logger, message, slug: extra.slug ?? null, itemId: extra.itemId ?? null, fields: extra.fields, key: extra.key });
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(270526);
const pick = <T,>(list: T[]): T => list[Math.floor(rand() * list.length)];

function timeAt(date: string, minute: number, second = 0): string {
  const h = String(Math.floor(minute / 60)).padStart(2, "0");
  const m = String(minute % 60).padStart(2, "0");
  return at(`${h}:${m}:${String(second).padStart(2, "0")}`, date);
}

function scatter(date: string, fromMin: number, toMin: number, n: number, fn: (when: string) => void) {
  for (let i = 0; i < n; i++) {
    fn(timeAt(date, fromMin + Math.floor(rand() * (toMin - fromMin)), Math.floor(rand() * 60)));
  }
}

// ─── Story events ───────────────────────────────────────────────────────────

function storyLogs(s: Story) {
  const { slug, itemId } = s;
  const ref = { slug, itemId };
  const k = (step: string) => ({ ...ref, key: `${slug}:${step}` });
  const files = s.files ?? { count: 1, mb: 10 };

  if (s.source === "whatsapp") {
    if (s.reporter) {
      log(s.receivedAt, "samvadia-api", "info", "whatsapp", `webhook: message from ${s.from} matched ${s.reporter} (${s.city}), ${files.count} media`, k("received"));
    } else {
      log(s.receivedAt, "samvadia-api", "warn", "whatsapp", `webhook: no reporter matched for ${s.from}; item ${itemId} set to needs_desk`, k("received"));
      log(addMin(s.receivedAt, 15), "samvadia-api", "warn", "desk", `needs_desk item ${itemId} from ${s.from} waiting 15 min, nobody picked it up`, k("waiting"));
    }
  } else if (s.source === "outlook") {
    log(s.receivedAt, "samvadia-worker", "info", "outlook", `poll: new mail from ${s.from}, ${files.count} attachments`, k("received"));
  } else {
    log(s.receivedAt, "samvadia-api", "info", "portal", `POST /portal/stories 201 by ${s.from}, ${files.count} files`, k("received"));
  }

  if (s.desk === "approved" && s.deskAt) {
    log(s.deskAt, "samvadia-api", "info", "desk", `item ${itemId} approved by ${s.deskBy}`, k("desk"));
  } else if (s.desk === "rejected" && s.deskAt) {
    log(s.deskAt, "samvadia-api", "info", "desk", `item ${itemId} rejected by ${s.deskBy}: ${s.rejectReason}`, k("desk"));
  }

  if (s.ftp === "done" && s.ftpAt) {
    log(s.ftpAt, "samvadia-worker", "info", "tasks", `tasks: uploaded ${files.count} files to FTP vartmaan/incoming/${slug}`, {
      ...k("ftp"),
      fields: { files: files.count, mb: files.mb, queue: "media" },
    });
    log(s.ftpAt, "ftp", "info", "pyftpdlib", `127.0.0.1 [samvadia] STOR vartmaan/incoming/${slug}/ ${files.count} files, ${files.mb} MB, 226 Transfer complete`, ref);
  }
  if (s.ftp === "uploading" && s.deskAt) {
    log(addMin(s.deskAt, 1), "samvadia-worker", "info", "tasks", `tasks: uploading ${files.count} files to FTP vartmaan/incoming/${slug}`, k("ftp"));
    log(addMin(s.deskAt, 5), "samvadia-worker", "info", "tasks", `tasks: ${Math.floor(files.count / 2)} of ${files.count} files on FTP for ${slug}`, ref);
  }
  if (s.ftp === "failed" && s.ftpAttempts && s.oversize) {
    log(s.ftpAttempts[0], "samvadia-worker", "info", "tasks", `tasks: media job queued for ${slug}: ${files.count} files, ${files.mb} MB`, ref);
    s.ftpAttempts.forEach((when, i) => {
      s.oversize!.forEach((f, j) => {
        log(when, "samvadia-worker", "error", "tasks", `FTP upload refused: file ${f.mb} MB over limit (MAX_UPLOAD_MB=${MAX_UPLOAD_MB})`, {
          ...ref,
          key: i === 0 && j === 0 ? `${slug}:ftp-refused` : undefined,
          fields: { file: f.name, mb: f.mb, attempt: i + 1, maxAttempts: s.ftpAttempts!.length },
        });
      });
      if (i < s.ftpAttempts!.length - 1) {
        log(when, "samvadia-worker", "warn", "tasks", `tasks: retrying media job for ${slug} (attempt ${i + 2}/${s.ftpAttempts!.length})`, ref);
      }
    });
    log(s.ftpAttempts[s.ftpAttempts.length - 1], "samvadia-worker", "error", "tasks", `tasks: media job for ${slug} failed for good after ${s.ftpAttempts.length} attempts; ${s.oversize.length} files not on FTP`, k("ftp-failed"));
  }

  if (s.feedAt) log(s.feedAt, "samvadia-api", "info", "feed", `feed item added guid=vartmaan-${slug}-v1`, k("feed"));
  if (s.collectedAt) {
    log(s.collectedAt, "samvadia-api", "info", "feed_log", `GET ${FEED_PATH_MASKED} 200 from Octopus, served guid=vartmaan-${slug}-v1`, k("collected"));
  }

  if (s.ingestAt) {
    if (s.digital === "skipped") {
      log(s.ingestAt, "socia-ingest", "info", "ingest", `skipped ${slug}: text only, no visuals for a card`, k("ingest"));
    } else {
      log(s.ingestAt, "socia-ingest", "info", "ingest", `picked up ${slug} from Samvadia feed`, k("ingest"));
    }
  }
  if (s.renderAt) {
    log(s.renderAt, "socia-render", "info", "render", `card rendered for ${slug} (1080x1350, 2.4 s)`, k("render"));
  }
  if (s.renderAttempts) {
    const n = s.renderAttempts.length;
    s.renderAttempts.forEach((when, i) => {
      log(when, "socia-render", "error", "render", `render failed for ${slug}: headline overflows the card text box (attempt ${i + 1}/${n})`, {
        ...ref,
        fields: { attempt: i + 1, chars: 96, maxChars: 72 },
      });
    });
    log(s.renderAttempts[n - 1], "socia-render", "error", "render", `gave up on ${slug} after ${n} attempts; draft marked render_failed`, k("render-failed"));
  }
  if (s.operatorAt) {
    const verb = s.digital === "operator_rejected" ? "rejected" : "approved";
    log(s.operatorAt, "socia-api", "info", "drafts", `draft for ${slug} ${verb} by ${s.operator}`, k("operator"));
  }
  if (s.postedAt) {
    log(s.postedAt, "socia-publish", "info", "publish", `posted to X (fake mode) id=${s.xPostId}`, k("posted"));
  }
  if (s.recalledAt) {
    log(s.recalledAt, "socia-publish", "warn", "publish", `recalled X post id=${s.xPostId}: ${s.recallReason}`, k("recalled"));
  }
}

// ─── Octopus feed polls ─────────────────────────────────────────────────────

// Every poll is in feed_log. To keep the sample readable we show single polls around
// the incident and in the last 20 min, and roll the rest up per half hour.
function feedPolls(date: string, lastMinute: number, minuteWindows: [number, number][]) {
  const collectedMinutes = new Set(
    STORIES.filter((s) => s.collectedAt && dateOf(s.collectedAt) === date).map((s) => hhmm(s.collectedAt!)),
  );
  const gap =
    date === TODAY
      ? [toMinute(OCTOPUS_GAP.from), toMinute(OCTOPUS_GAP.resumedAt) - 1]
      : [-1, -1];
  const inWindow = (m: number) => minuteWindows.some(([a, b]) => m >= a && m <= b);

  let bucket = { polls: 0, ok200: 0, first: -1, last: -1 };
  const flush = () => {
    if (bucket.polls) {
      log(timeAt(date, bucket.last, 5), "samvadia-api", "info", "feed_log",
        `Octopus polled ${bucket.polls} times since ${hhmmOf(bucket.first)} (200: ${bucket.ok200}, 304: ${bucket.polls - bucket.ok200})`);
    }
    bucket = { polls: 0, ok200: 0, first: -1, last: -1 };
  };

  for (let m = 0; m <= lastMinute; m++) {
    if (m % 30 === 0) flush();
    if (m >= gap[0] && m <= gap[1]) continue;
    const label = hhmmOf(m);
    if (inWindow(m)) {
      flush();
      if (!collectedMinutes.has(label)) {
        log(timeAt(date, m, POLL_SECOND), "samvadia-api", "info", "feed_log", `GET ${FEED_PATH_MASKED} 304 from Octopus (${8 + Math.floor(rand() * 20)} ms)`);
      }
    } else {
      if (!bucket.polls) bucket.first = m;
      bucket.polls++;
      if (collectedMinutes.has(label)) bucket.ok200++;
      bucket.last = m;
    }
  }
  flush();
}

function toMinute(iso: string): number {
  const [h, m] = hhmm(iso).split(":").map(Number);
  return h * 60 + m;
}

function hhmmOf(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

// ─── Everything else ────────────────────────────────────────────────────────

const API_ROUTES = [
  '"GET /desk/items?state=new HTTP/1.1" 200',
  '"GET /desk/items?state=needs_desk HTTP/1.1" 200',
  '"GET /health HTTP/1.1" 200',
  '"POST /desk/items/approve HTTP/1.1" 200',
  '"GET /feed/stats HTTP/1.1" 200',
];
const SOCIA_ROUTES = ["GET /api/drafts", "GET /api/queue", "POST /api/drafts/approve", "GET /api/health"];

function dailyNoise(date: string, lastMinute: number) {
  scatter(date, 6 * 60, lastMinute, 20, (w) =>
    log(w, "samvadia-api", "info", "uvicorn.access", `127.0.0.1:${50000 + Math.floor(rand() * 9000)} - ${pick(API_ROUTES)}`),
  );
  scatter(date, 6 * 60, lastMinute, 14, (w) => {
    const route = pick(SOCIA_ROUTES);
    const msTaken = 4 + Math.floor(rand() * 30);
    log(w, "socia-api", "info", "fastify", `request completed ${route} 200 ${msTaken}ms`, {
      fields: { statusCode: 200, responseTime: msTaken, reqId: `req-${Math.floor(rand() * 9000) + 1000}` },
    });
  });
  scatter(date, 7 * 60, lastMinute, 8, (w) =>
    log(w, "ollama", "info", "ollama", `[GIN] 200 | ${(1.5 + rand() * 3).toFixed(1)}s | 127.0.0.1 | POST "/api/chat" model=qwen3:30b`),
  );
  for (let m = 15; m <= lastMinute; m += 240) {
    log(timeAt(date, m, 11), "postgres", "info", "postgres", `checkpoint complete: wrote ${600 + Math.floor(rand() * 400)} buffers (${(3 + rand() * 4).toFixed(1)}%)`);
  }
  for (let m = 6 * 60; m <= lastMinute; m += 60) {
    log(timeAt(date, m, 30), "samvadia-worker", "debug", "worker", "heartbeat: queues default and media alive");
  }
  for (const h of [0, 6, 12, 18]) {
    if (h * 60 <= lastMinute) {
      log(timeAt(date, h * 60, 4), "socia-crons", "info", "crons", "metrics: refreshed engagement for posts in the last 24 h");
    }
  }
  log(timeAt(date, 120, 9), "socia-crons", "info", "crons", "handles: refreshed X handle list");

  log(at("02:00", date), "backups", "info", "backup.ps1", "backup started (pg_dump samvadia, socia)");
  log(at("02:03", date), "backups", "info", "backup.ps1", `pg_dump samvadia ok (${BACKUP.samvadiaMb} MB)`);
  log(at("02:05", date), "backups", "info", "backup.ps1", `pg_dump socia ok (${BACKUP.sociaMb} MB)`);
  log(at("02:06", date), "backups", "info", "backup.ps1", `wrote ${BACKUP.dir}\\${date}_0200; pruned 1 old backup, keeping ${BACKUP.keep}`);

  for (const e of LOGINS[date] ?? []) {
    if (e.app === "sentry") continue; // console sign-ins are not a watched system
    const msg =
      e.result === "success"
        ? `login ok for ${e.user} from ${e.ip}`
        : e.result === "locked"
          ? `account ${e.user} locked after repeated failed logins from ${e.ip}`
          : e.result === "totp_failed"
            ? `TOTP check failed for ${e.user} from ${e.ip}`
            : `login failed for ${e.user} from ${e.ip}: ${e.result.replace("_", " ")}`;
    log(e.at, e.app, e.result === "success" ? "info" : "warn", "auth", msg, { fields: { loginId: e.id } });
  }
}

function todaysEvents() {
  // The dead email at 09:14
  [at("09:12"), at("09:13"), MAIL_DEAD.at].forEach((w, i) => {
    log(w, "samvadia-worker", "error", "outlook", `attachment fetch failed: Graph returned ${MAIL_DEAD.graphStatus} (attempt ${i + 1}/${MAIL_DEAD.attempts})`, {
      fields: { from: MAIL_DEAD.from, attempt: i + 1 },
    });
  });
  log(MAIL_DEAD.at, "samvadia-worker", "error", "outlook", `moved message from ${MAIL_DEAD.from} to mail_dead after ${MAIL_DEAD.attempts} failures`, { key: "mail-dead" });
  log(at("09:27"), "samvadia-worker", "info", "outlook", `resend from ${MAIL_DEAD.from} received; attachments fetched fine`);

  // Octopus gap
  log(at("11:42"), "samvadia-api", "warn", "feed_log", "no poll from Octopus for 3 min (last at 11:39)", { key: "octopus-silent" });
  log(at("11:45"), "samvadia-api", "warn", "feed_log", "no poll from Octopus for 6 min (last at 11:39)");
  log(at("11:50"), "samvadia-api", "warn", "feed_log", "no poll from Octopus for 11 min (last at 11:39)");
  log(OCTOPUS_GAP.resumedAt, "samvadia-api", "info", "feed_log", `Octopus polling again after ${OCTOPUS_GAP.minutesBlind} min of silence`, { key: "octopus-back" });

  // X cap
  log(at("15:40"), "socia-publish", "warn", "publish", `X daily write cap at 80% (40 of ${X_CAP.limit})`, { key: "x-cap" });
  log(at("16:28"), "socia-publish", "warn", "publish", `X daily write cap at 82% (41 of ${X_CAP.limit})`);

  log(at("16:07"), "whatsapp", "info", "webhook", `Meta webhook delivered 1 message from ${UNKNOWN_WA_NUMBER}; no retries`);
  log(at("16:25"), "ftp", "info", "pyftpdlib", "127.0.0.1 [samvadia] logged in, 0 errors in the last hour");
}

function yesterdaysEvents() {
  const d = YESTERDAY;
  log(at("15:20", d), "samvadia-worker", "error", "worker", "worker process used 2148 MB, over the 2048 MB limit; restarting", { key: "worker-restart" });
  log(at("15:21", d), "samvadia-worker", "warn", "worker", "re-queued 3 jobs that were running at restart");
  log(at("15:24", d), "samvadia-worker", "info", "worker", "worker back up; queues default and media draining");
  log(at("19:40", d), "socia-render", "warn", "render", "Chromium took 9.8 s to start; card rendered on retry");
}

// ─── Build ──────────────────────────────────────────────────────────────────

for (const s of STORIES) storyLogs(s);
todaysEvents();
yesterdaysEvents();
dailyNoise(YESTERDAY, 1439);
dailyNoise(TODAY, toMinute(NOW) - 1);
feedPolls(YESTERDAY, 1439, []);
feedPolls(TODAY, toMinute(NOW) - 1, [
  [11 * 60 + 20, 12 * 60 + 9],
  [16 * 60 + 10, 16 * 60 + 29],
]);

const sorted = raw
  .map((r, i) => ({ r, i }))
  .sort((a, b) => ms(a.r.at) - ms(b.r.at) || a.i - b.i)
  .map((x) => x.r);

const counters: Record<string, number> = {};
const idByKey = new Map<string, string>();

// Oldest first. Ids look like log-20261027-0001.
export const LOGS: LogEntry[] = sorted.map(({ key, ...entry }) => {
  const date = dateOf(entry.at);
  counters[date] = (counters[date] ?? 0) + 1;
  const id = `log-${date.replace(/-/g, "")}-${String(counters[date]).padStart(4, "0")}`;
  if (key) idByKey.set(key, id);
  return { id, ...entry };
});

export const LOG_BY_ID = new Map(LOGS.map((l) => [l.id, l]));

// logIdFor("271026_JPR_RAIN_AV_POOJA:render-failed") -> "log-20261027-0312"
export function logIdFor(key: string): string | null {
  return idByKey.get(key) ?? null;
}
