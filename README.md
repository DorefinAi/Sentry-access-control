# Sentry: control centre

One place to see whether the newsroom systems are working, what broke, and what to fix first.
It is for us, not for the newsroom team. It is a Next.js app with its own API routes, so there is no separate backend.

## Run it

```powershell
cd c:\vartmaan\code\sentry
npm run dev          # http://localhost:3005
```

## Sign-in and roles

- `.env.local` needs `SENTRY_SECRET` (32+ characters); it signs the session cookie.
- Accounts live in `users.local.json`. Add or change one with `node scripts/add-user.mjs <username> "<Name>" <owner|admin|operator|viewer>`; add `--keep-password` to change only the name and role (for example to make someone an owner).
- Roles, highest first: **owner** (everything an admin can; only an owner, or the script, can make or change an owner), **admin** (everything, including the team), **operator** (alerts, incidents, gauges), **viewer** (look only).
- Signed-in sessions live in `sessions.local.json`. A cookie works only while its session is listed there, so signing out, "sign out other sessions", a password reset and disabling someone all hold after a restart. Deleting the file signs everyone out.
- Sign-in is limited to 5 tries per username and 5 per address in 15 minutes, then a 5-minute wait.
- Every write must be JSON from this console's own origin; the proxy refuses anything else (other apps on this host count as the same site).
- **People** (`/people`, owners only; hidden from the nav and 403 for everyone else) controls every person in the Assignment desk and Socia through each backend's owner API. Set `SAMVADIA_API_URL` / `SAMVADIA_OWNER_KEY` and `SOCIA_API_URL` / `SOCIA_OWNER_KEY` in `.env.local` (each key = that backend's `OWNER_API_KEY`); a missing pair shows that system as "not connected". Use https://, or http:// only to this machine (localhost / 127.0.0.1): the key is refused over plain http to anything else. Tests: `node --no-warnings --import ./scripts/test-resolve.mjs src/server/people.test.ts`.
- Every API route checks the session itself as well as in the proxy, and every write is checked for JSON + same origin inside `handle()`. `node --no-warnings --import ./scripts/test-resolve.mjs src/server/guards.test.ts` fails on a route without a session check.
- `npm run dev` and `npm start` listen on 127.0.0.1:3005 only. Run `node scripts/add-user.mjs` while nobody is editing the team in the console.
- Tests for all of this: `node --no-warnings --import ./scripts/test-resolve.mjs src/server/auth.test.ts` (uses a temp folder, never the real files) and `node --no-warnings src/lib/safeNext.test.ts`.

## Screens

| Screen | What it answers |
|---|---|
| Status `/` | Is everything OK? Shows both pipelines, "What to fix", today in one paragraph and every system |
| Alerts `/alerts` | What is wrong right now? Each alert has a runbook and Ack / Resolve buttons |
| Logs `/logs` | What did the systems say? Filters stay in the link. "Summarize what I'm looking at" |
| Trace `/trace` | Where is this story? Type a slug to see its path from intake to Octopus to X |
| Reports `/reports` | Incidents (with a `.md` export), daily report, app logins, build log |
| Ask (header) | Chat: "What broke today?", "Daily report", "Who logged in?", "What should I fix first?" |

## Live data: where every screen gets its numbers

Nothing is demo data and nothing runs on a frozen clock: "now" is the real clock everywhere. When Sentry cannot see something it says so ("unknown", with the reason), never a made-up number.

| Screen | Source |
|---|---|
| Overview, Pipelines | Each backend's `GET /owner/ops/summary` (counts, waiting, stuck, checks, queues); stages map 1:1 to the contract ids (assignment: intake, desk, ftp, feed, octopus; digital: ingest, convert, compose, render, operator, publish) |
| Systems | Health probes (below), metrics from the ops summaries, 24 h uptime from stored health samples, last error from the logs |
| Alerts, Notifications | The detection engine (below); acks, notes and resolves are stored in `sentry.local.db` |
| What to fix | Unresolved alerts (their runbooks), then stories stuck past a stage limit, then open incident follow-ups |
| Trace | Search asks both backends for every day they still have (`date=all`, contract v1.1; an older backend is asked for today). `GET /owner/ops/story/{slug}` from both backends, joined by slug (Samvadia steps, then Socia's); the story's own log lines are attached to the steps as evidence |
| Logs | Pulled every 15 s (below) |
| Reports: daily | The day's final ops summary per backend (`ops_daily`), uptime from health samples, incidents from the database. Today uses only a fresh pull; if it has to fall back to the stored one, the paragraph says "as of HH:MM (stale)". Only days with stored data have a report |
| Reports: incidents | `sentry.local.db`; auto incidents come from the engine |
| Reports: logins | `GET /owner/ops/logins?date=` from both backends plus this console's own sign-ins. Each backend's state is shown (ok / last answer as of HH:MM / not reachable / not connected), never silent zeros; its true day `totals` are used and a cut list is flagged (contract v1.1; older backends still work). Below admin: failed tries hide user, name and role, every event hides IP and browser, and active sessions hide user and IP. `new_ip` remembers addresses across days (`login_ips`) |
| Reports: build log | One live entry: what Sentry is watching right now and what it cannot see |
| Changes | Real `git log` of `samvadia/backend`, `samvadia/frontend`, `samvadia/reporterportal`, `digital/backend`, `digital/frontend` and `sentry` (under `SENTRY_REPOS_ROOT`, default the folder above this app), refreshed every 5 min |
| Gauges, telemetry, streaks, uptime | Stored ops snapshots, health samples and log lines. The `x-cap` gauge is gone (no backend reports X writes); `stuck` replaced it |
| Replay (jog wheel) | Rebuilt from stored snapshots, health samples and alert/incident history. It starts at the first stored moment today and is switched off (with a note) when there is none |
| Ask, summaries | The same static templates (no AI yet), fed the real facts above; every number is checked by `verifyNumbers` |

### The watch loop (`src/server/monitor.ts`, started by `src/instrumentation.ts`)

Every 30 s:
1. **Ops pull** (`src/server/ops/`): `GET /owner/ops/summary` from each configured backend through `ownerFetch` (same key, actor `sentry-sync`). The answer is checked, cached in memory, and stored in `ops_snapshots` (kept 2 days; a new row only when the answer changed, otherwise the last row's `until_ms` moves on) and `ops_daily` (the day's latest; kept 400 days). At midnight the previous day's final summary is read once. A failed pull is stored too; a summary older than `opsStaleSec` is not used. Contract: `c:\vartmaan\code\dev-docs\ops-status-contract.md`.
2. **Health probes** (`src/server/probes/probes.ts`): Samvadia `/health`, Socia `/healthz` and `/healthz/worker` (a 200 from the first two also means Postgres answered `SELECT 1`), Ollama `/api/tags` (up/down), the front ends on 127.0.0.1:3000 (assignment desk), :3002 (reporter portal), :3006 (digital desk) (`ASSIGNMENT_DESK_URL`, `REPORTER_PORTAL_URL`, `DIGITAL_DESK_URL`, `OLLAMA_URL` override), the Cloudflare tunnel's Windows service (`sc query Cloudflared`, read-only, Windows only; the tunnel named "socia" runs inside the `Cloudflared` service; `SENTRY_TUNNEL_SERVICE` overrides), the newest `socia-*.dump` in `C:/vartmaan/code/db/backups` (written by `digital/backup-socia-db.ps1`; `SENTRY_BACKUP_DIR` overrides), process heartbeats from the summaries (stale at 90 s = warn, 5 min = down, over 1 h = gone: a retired process, shown unknown and never alerted), and the backends' own checks (`db` = Postgres, `ftp`, `outlook`, `whatsapp`, `octopus`, `share`, `worker`, `data-files`, `x`).
3. **Health samples** (`src/server/probes/health.ts`): one sample per system and one for the whole stack, stored run-length encoded in `health_spans` (kept 35 days). Time Sentry was not running is left out of uptime.

Every 60 s, the **detection engine** (`src/server/detect/`) runs the rules and keeps the `alerts` table in step: a finding opens one alert per rule + target (deduped); an alert resolves automatically only after its finding has been absent 3 rounds in a row (no flapping), and never while Sentry cannot see the condition (that backend's summary missing or stale, the rule failed, no probe round yet); and an alert a person resolved while the condition still held stays quiet until the condition has cleared once. Resolved alerts and incidents are kept 180 days. A critical alert unresolved for 5 min opens an incident automatically (`openedBy: "auto"`) or joins the auto incident already open; when all its alerts are resolved it moves to monitoring, and a returning problem reopens it. A person resolves incidents. Every alert carries a runbook, and every fire/clear writes a notification.

| Rule | Fires when | Severity |
|---|---|---|
| `service-down` | An HTTP probe or the tunnel service is down; a backend's db check fails; Sentry cannot read a backend's ops status | Critical for Samvadia API, Socia API, Socia worker, Postgres; warning otherwise |
| `heartbeat-stale` | A process has not beaten for `heartbeatWarnSec` (90) / `heartbeatDownSec` (300) | Warning / critical |
| `error-spike` | At least `errorSpikeMin` (5) error lines in `errorSpikeWindowMin` (10) min and `errorSpikeFactor` (3) times the last 24 h rate, per system | Warning |
| `error-repeat` | The same error `errorRepeatCount` (5) times in `errorRepeatWindowMin` (30) min; lines with `fields.tmpl` (contract v1.1) group on logger + template, others on the message | Warning |
| `check-failing` | A backend check other than db reports ok=false (share, FTP, Outlook, WhatsApp, Octopus, worker...) | Critical for FTP and share; warning otherwise |
| `no-intake` | Samvadia's stories-in count has not moved for `noIntakeMinutes` (60) inside working hours `workStartHour`-`workEndHour` (08-23 IST) | Warning |
| `stories-stuck` | A backend lists stuck stories (its own stage limits; `stuckMinMinutes` adds a floor), one alert per backend and stage | Warning; critical from 5 stories at a machine stage. Desk and operator (waiting for a person) are always warnings, so never an auto incident |
| `check-quiet` | In working hours, a check that has not succeeded for `quietOctopusMin` (15), `quietWhatsappMin` (120), `quietOutlookMin` (60), `quietShareMin` (60) min (Octopus, WhatsApp, Outlook from Samvadia; share from Socia) | Warning |
| `backup-old` | The newest backup is older than `backupMaxHours` (26) or missing | Warning |

The rule levels, `heartbeatGoneSec` (3600), `autoIncidentMinutes` (5) and `opsStaleSec` (120) live under `"rules"` in `thresholds.local.json`; Sentry writes the defaults there once. Edit the file and restart to change them. Gauge levels are still changed from the Overview knobs.

## Logs

- Sentry pulls `GET /owner/logs` from each backend every 15 s (`src/server/logSync.ts`), with the same key as the People page, actor `sentry-sync`. Contract: `c:\vartmaan\code\dev-docs\ops-logs-contract.md`.
- Lines are stored in `sentry.local.db` (gitignored, Node's built-in `node:sqlite`, Node 22.13+) and kept for 30 days. With no backend configured the page says so and shows only what was stored before.
- Every line is redacted twice: by the backend and again by Sentry (`src/server/redact.ts`).
- HTTP request lines ("incoming request" / "request completed", over 90% of what is stored) are hidden by default. The list header shows how many were hidden and their rate per minute; the "Request lines" switch (`noise=1` in the link) shows them.
- Errors in the current view are grouped by message (count, first seen, last seen, a "Show" button that filters to them).
- If a backend's URL changes, or its database is reset, Sentry drops that backend's stored lines and starts again from its newest ones.

## Audit trail

The action log (team, People, alerts, incidents, settings and account changes) and the sign-in log are saved to `audit.local.json` (gitignored). Each new action is saved within a second, and any other change within 10 s, so a restart keeps them. If the file cannot be read, the console starts with an empty log and does not save over the file. Alerts, incidents and notifications are in `sentry.local.db`.

## Tests

Each runs with `node --no-warnings --import ./scripts/test-resolve.mjs <file>` (temp folders, fake backends; never the real files):

- `src/server/ops/ops.test.ts`: ops client, pull, snapshots, day rollover, trace join and story search, sign-ins
- `src/server/probes/probes.test.ts`: heartbeats, sc output, checks, backups, a full probe round, health spans, uptime, streaks, gaps
- `src/server/detect/detect.test.ts`: every rule, dedupe, auto-resolve, hold after a manual resolve, auto incident, monitoring and reopen, persistence, replay
- `src/server/logs.test.ts`, `logSource.test.ts`, `logSummary.test.ts`, `redact.test.ts`, `audit.test.ts`, `auth.test.ts`, `people.test.ts`, `guards.test.ts`, `ai/verifyNumbers.test.ts`, and `node --no-warnings src/lib/safeNext.test.ts`

`scripts/live-check.mts` prints what the live data path sees against the real backends, on a copy of `sentry.local.db` in a temp folder (it reads `.env.local` without printing it).

## Next phases

1. ~~Static UI and API~~
2. ~~Live data: ops status, probes, detection, history~~
3. Qwen through Ollama behind the same `Assistant` interface (the templates stay as the fallback)
4. Alert delivery (WhatsApp, email, desktop push)
5. Optional: Sentry.io for code exceptions
