// Recent code changes across the repos. Static in Phase 1; later read from git or file times.
// The deploy restarts in uptime.ts line up with these.
import type { CodeChange } from "@/types/control";
import { at } from "./time";

type Row = [string, string, CodeChange["system"], string, string, string, string[]];

// [date, time, system, repo, author, summary, files]
const ROWS: Row[] = [
  ["2026-10-24", "11:20", "ollama", "local-dev", "vansh", "Pull qwen3:30b-a3b-instruct-2507 and pin it in the chat app", ["ollama/pull-models.ps1", "chat/config.json"]],
  ["2026-10-24", "17:05", "samvadia-api", "backend-Samvadia", "claude", "Feed: add feed_log row for every Octopus poll", ["app/routes/feed.py", "app/models/feed_log.py", "migrations/0042_feed_log.sql"]],
  ["2026-10-25", "12:30", "socia-render", "backend-socia", "vansh", "Card text box: cap headline at 72 characters", ["apps/worker/src/stages/render.ts", "packages/core/src/card.ts"]],
  ["2026-10-25", "19:38", "socia-api", "backend-socia", "claude", "Compose: shorter hooks, drop emoji from X copy", ["packages/core/src/compose.ts", "packages/core/src/prompts/x.md", "apps/worker/src/stages/compose.ts"]],
  ["2026-10-25", "19:43", "digital-desk", "digital desk frontetnd", "vansh", "Operator queue: show render errors on the draft card", ["src/pages/queue.tsx", "src/components/DraftCard.tsx"]],
  ["2026-10-26", "11:50", "postgres", "db-setup", "vansh", "Backup script: keep 14 nightly dumps", ["backup.ps1", "README.md"]],
  ["2026-10-26", "16:40", "samvadia-worker", "backend-Samvadia", "claude", "Worker: process thumbnails in batches of 20 (INC-0006)", ["app/tasks.py", "app/services/media.py"]],
  ["2026-10-26", "22:05", "samvadia-worker", "backend-Samvadia", "vansh", "Refuse uploads over MAX_UPLOAD_MB before sending to FTP", ["app/services/ftp.py", "app/config.py", "app/tasks.py", "tests/test_ftp.py"]],
  ["2026-10-26", "22:06", "samvadia-api", "backend-Samvadia", "vansh", "Intake: keep unmatched WhatsApp senders as needs_desk", ["app/intake.py", "app/routes/whatsapp.py"]],
  ["2026-10-26", "22:10", "assignment-desk", "Assignment-desk-samvadia", "vansh", "Retry button for failed media jobs", ["src/components/MediaJobs.tsx", "src/api/desk.ts"]],
  ["2026-10-26", "22:10", "reporter-portal", "reporterportal", "claude", "Show upload progress per file", ["src/app/submit/page.tsx", "src/lib/upload.ts"]],
  ["2026-10-27", "06:28", "ftp", "local-dev", "vansh", "FTP server: rotate logs daily", ["ftp/server.py", "ftp/start-ftp.ps1"]],
  ["2026-10-27", "10:05", "assignment-desk", "Assignment-desk-samvadia", "vansh", "List needs_desk items first", ["src/pages/DeskQueue.tsx"]],
  ["2026-10-27", "12:40", "samvadia-api", "backend-Samvadia", "claude", "Log the sender number when no reporter matches", ["app/intake.py"]],
  ["2026-10-27", "15:55", "sentry", "sentry", "claude", "Phase 1: static control centre API and screens", ["src/types/control.ts", "src/server/overview.ts", "src/app/page.tsx"]],
  ["2026-10-27", "16:12", "postgres", "db-setup", "vansh", "Index feed_log(at) for the control centre", ["sql/0007_feed_log_at_idx.sql"]],
];

function sha(n: number): string {
  return ((0x9e3779b1 * (n + 7)) >>> 0).toString(16).padStart(8, "0").slice(0, 7);
}

// Newest first.
export const CHANGES: CodeChange[] = ROWS.map(([date, time, system, repo, author, summary, files], i) => ({
  id: `chg-${String(i + 1).padStart(3, "0")}`,
  system,
  repo,
  at: at(time, date),
  author,
  summary,
  ref: sha(i),
  files: files.slice(0, 10),
  source: "static" as const,
})).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
