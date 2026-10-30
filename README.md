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
| Status `/` | Is everything OK? Shows both pipelines, "What to fix", the AI paragraph for today and every system |
| Alerts `/alerts` | What is wrong right now? Each alert has a runbook and Ack / Resolve buttons |
| Logs `/logs` | What did the systems say? Filters stay in the link. "Summarize what I'm looking at" |
| Trace `/trace` | Where is this story? Type a slug to see its path from intake to Octopus to X |
| Reports `/reports` | Incidents (with a `.md` export), daily report, app logins, build log |
| Ask (header) | Chat: "What broke today?", "Daily report", "Who logged in?", "What should I fix first?" |

## Phase 1: static data

- Every route in `src/app/api/**` serves typed static data from `src/data/**`. The data is built in `src/server/**`.
- "Now" is fixed at 2026-10-27 16:30 IST (`src/data/time.ts`), so the demo never goes stale.
- Ack, resolve and incident changes are kept in memory. A restart resets them.
- The response shapes are defined in `src/types/control.ts`. Phase 2 changes only `src/server/**`; the UI stays as it is.
- The AI is static templates for now (`model: "static"`). `src/server/ai/verifyNumbers.ts` flags any number in an answer that is not in the facts it was given, and Phase 2 will run it on every Qwen answer. Test it with:
  `node --no-warnings src/server/ai/verifyNumbers.test.ts`

## Next phases

1. ~~Static UI and API~~
2. Read-only access to the local `samvadia` and `socia` databases, and Qwen through Ollama (`QwenAssistant` behind the same `Assistant` interface)
3. A log sink and worker heartbeats in both backends
4. Alert delivery (WhatsApp, email, desktop push)
5. Optional: Sentry.io for code exceptions

Planned Phase 2 changes:
- Log paging by `(at, id)` instead of offsets.
- Real queries instead of the demo stories that are hard-coded in `fixes.ts`, `pipelines.ts` and `reports.ts`.
- Follow-ups with their own ids.
