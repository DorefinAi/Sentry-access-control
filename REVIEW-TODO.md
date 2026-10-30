# Review findings (second review, 2026-10-27)

Items 1-5 and the first two small items under 12 were fixed on 2026-10-30. Tests:
`node --no-warnings --import ./scripts/test-resolve.mjs src/server/auth.test.ts` and `node --no-warnings src/lib/safeNext.test.ts`.

## Fix before the team uses it (all fixed 2026-10-30)
1. ~~**Login lockout is easy to bypass.**~~ Fixed.
   - Each attempt is now counted before scrypt runs (`takeAttempt` in `src/server/session.ts`), against both the address and the username: 5 tries per key in 15 minutes, then a 5-minute wait. Twenty parallel wrong tries from twenty addresses get 5 answers and 15 x 429. Password changes use the same limit.
   - **Still open: a real socket IP.** Next route handlers and the proxy cannot see the socket; Next copies the socket address into `X-Forwarded-For` only when the client sent none. So the per-address key is still the client's word, and the per-username limit is what holds. A true socket key needs a small custom server (`server.mjs`) in front of Next that overwrites the header; not done because it changes how the app starts and could not be tried without running a server.
2. ~~**A failed read of `users.local.json` can wipe every account.**~~ Fixed. `updateUsers` refuses to write (500, nothing changed) when the file cannot be read, is not JSON, is not a list, or has an entry that is not a valid account. A missing file still counts as an empty team.
3. ~~**CSRF from the other apps on this host.**~~ Fixed. The proxy refuses every write (not GET/HEAD/OPTIONS) without `Content-Type: application/json` (415) or with an `Origin` that is not this host and port (403), login and logout included (`crossSiteWrite` in `src/server/http.ts`).
4. ~~**Open redirect after login.**~~ Fixed. `safeNext` (now `src/lib/safeNext.ts`) rejects control characters and backslashes, requires a single leading `/`, and requires the same origin; 23 cases in `src/lib/safeNext.test.ts`.
5. ~~**Signed-out, disabled and revoked cookies still work.**~~ Fixed.
   - Sessions live in `sessions.local.json` (gitignored). A cookie counts only while its session id is listed there; sign-out, revoke-others, password reset and disable remove entries, so they hold after a restart.
   - The proxy runs the full check (`checkToken` in `src/server/liveSessions.ts`: signature, listed session, enabled account, `sessionsValidAfter`), the same one every route uses.
   - Session ids are `crypto.randomUUID()`. Cookies from before this change have no listed session, so everyone signs in once more.
   - The proxy matcher now always covers `/api/*`, so an API path ending in `.js` or `.png` no longer skips it (part of item 10).

## Bugs
6. **Replay breaks over time.** It goes wrong after 16:30 board time and stops entirely after the server has run past midnight IST. Fix: take the upper limit from the frozen `NOW` (`JogWheel.tsx`, `moment.ts`).
7. **The uptime knob moves the wrong way** and can't reach 99–100. Fix: give each gauge its own step, 0.1 for uptime (`Knob.tsx`).
8. **Viewers get a 403 when they mark notifications read** (`api/notifications/route.ts`). Fix: allow any signed-in user.
9. **Writes to `thresholds.local.json` aren't serialised.** In-memory values change before the disk write succeeds.
10. **Paths ending in `.js`, `.css`, `.png` and similar skip the proxy** (`src/proxy.ts` matcher). Fixed for `/api/*` (2026-10-30); page paths with those endings still skip it.
11. **While you turn the jog wheel, the board flashes back to live data.** Fix: keep the last replay result until the next one arrives.
12. **Small items:**
    - ~~An admin can reset their own password through the team PATCH.~~ Fixed: 403, use Settings > Account (asks for the current password). The button is hidden on your own row.
    - ~~Typed usernames from failed logins are shown to every role.~~ Fixed: `/api/logins` shows them to admins and owners only; others and the assistant see `(hidden)`. The demo seed data in `src/data/logs.ts` and `notifications.ts` still names them.
    - ~~`loginLog` has no size limit.~~ Fixed 2026-10-30: capped at 5000 (`trimLoginLog`), failed tries dropped before successes; the throttle map is capped too (`pruneFailures`).
    - The CLI writes outside the server's write lock. Mitigated 2026-10-30: `add-user.mjs` refuses a file with any invalid entry, refuses to save if the file changed while it ran (mtime check), writes its own temp file, and says to run it while nobody edits the team. A shared cross-process lock is still not built.
    - A knob change still waiting to save is saved during replay.
    - A pending jog update can override a key press.
    - `src/components/status/Gauges.tsx` is no longer used.
    - ~~The README says nothing about `SENTRY_SECRET`, `.env.local`, `add-user.mjs` or roles.~~ Fixed: "Sign-in and roles" section.

## Third review (security + TypeScript, 2026-10-30), all fixed the same day
Next 16.2.4 has proxy-bypass advisories, so nothing may rely on the proxy alone (upgrading Next is a separate decision).
- **S1** Every API route checks the session itself (`requireSession` / `requireCurrent` / `requireRole`), including the
  17 that relied on the proxy and three GETs in files whose writes were checked (alerts/[id], incidents, incidents/[id]).
  `handle(req, fn)` now runs `crossSiteWrite` for every non-GET, and the signature makes `req` required.
  `src/server/guards.test.ts` scans every route file and fails on a handler without a session check or without `handle(req, …)`.
- **S3** Sign-in log and throttle map are bounded (see item 12).
- **S5** People: a backend URL on plain http to another machine is refused ("not connected", says why); http only to loopback.
- **S6** People: every owner write is logged before the backend call and again with the outcome (failures and
  unreadable replies too), in Sentry's action log and the server log; target names come from the backend's answer,
  never from the browser (`?name=` removed).
- **S7** `add-user.mjs` (item 12).
- **S9** People answers carry `Cache-Control: no-store, private`; a backend error code is passed on only if it is a short machine word.
- `package.json`: `dev` and `start` listen on 127.0.0.1 only (takes effect at the next start of the console).
- People page (TS review): drafts survive tab switches (both editors stay mounted), closing with unsaved changes asks
  first, the drawer stays if the row vanishes while dirty, a stale `?p=` is cleared; history retries a system that
  failed on page 1 and keeps older pages across refreshes; drawer is `role="dialog"` + `aria-modal`; role change and
  page/action edits are saved one at a time (the other is locked); a write without confirmation (timeout, 5xx,
  unreadable reply) says "may or may not have been saved" and reloads; other 409s stay 409; history sorts with microseconds.

## Suspected
- Knob or jog can stay stuck mid-drag if `releasePointerCapture` throws; a right-click also starts a drag.
- Saving both knob marks quickly can be rejected.
- Possible hydration mismatch in `useNow` at a minute boundary.
- `SENTRY_SECRET` strength is checked by length only.

## Housekeeping
- Remove the `.next-rev` include lines from `tsconfig.json`.
- Change `next-env.d.ts` to import `./.next/dev/types/routes.d.ts` instead of the `.next-rev` one.
- Delete the `.next-rev/` folder.
