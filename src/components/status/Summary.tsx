"use client";

// The pieces of the mission summary that are not instruments of their own:
// the mission header with its STATUS annunciator, the counts readout, the stack
// uptime streak, the last code change and the events line.
import Link from "next/link";
import { Box, Typography, useTheme } from "@mui/material";
import { GitCommitHorizontal, History } from "lucide-react";
import type { CodeChange, Notification, Overview, StackUptime } from "@/types/control";
import { STATUS_WORDS, systemName } from "@/lib/labels";
import { useSecondClock } from "@/hooks/useNow";
import { counter, exactIst, hmIst, hmsIst, streak, upCounter } from "@/lib/time";
import { clockOffset } from "@/lib/clock";
import { useSession } from "@/providers/SessionProvider";
import type { ReactNode } from "react";
import { HealthIcon, healthColor } from "@/components/common/Health";
import { ConsoleLabel, Raw, RelTime } from "@/components/common/Bits";
import { Panel } from "@/components/common/Panel";
import { DISPLAY_STACK, MONO_STACK } from "@/providers/MuiProvider";

/** Live boards tick with the wall clock; a replayed board shows its fixed moment. */
function BoardTime({ asOf, replay }: { asOf: string; replay: boolean }) {
  const now = useSecondClock();
  const ms = replay || !now ? Date.parse(asOf) : now;
  return <>{hmsIst(ms)}</>;
}

/** Shift time runs on the real clock: sign-in times are real even while the board is frozen. */
function ShiftTime({ since }: { since: string }) {
  const now = useSecondClock();
  return <>{now ? counter((now - clockOffset() - Date.parse(since)) / 1000) : "--:--:--"}</>;
}

function StreakCounter({ u, asOf, replay }: { u: StackUptime; asOf: string; replay: boolean }) {
  const now = useSecondClock();
  const extra = replay || !now ? 0 : Math.max(0, (now - Date.parse(asOf)) / 1000);
  return <>{upCounter(u.streakSec + extra)}</>;
}

function BandReadout({ label, children, tone }: { label: string; children: ReactNode; tone?: string }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <ConsoleLabel component="p" sx={{ fontSize: "0.6875rem" }}>
        {label}
      </ConsoleLabel>
      <Box sx={{ fontFamily: MONO_STACK, fontSize: { xs: "1.375rem", md: "1.875rem" }, fontWeight: 500, lineHeight: 1.15, letterSpacing: "0.02em", color: tone ?? "text.primary", whiteSpace: "nowrap" }}>{children}</Box>
    </Box>
  );
}

/** The full-bleed band at the top of the wall. */
export function MissionHeader({ o, replay }: { o: Overview; replay: boolean }) {
  const theme = useTheme();
  const color = healthColor(theme, o.health);
  const since = useSession().me.data?.onShiftSince;
  return (
    <Box
      component="section"
      aria-label="Mission status"
      sx={{
        position: "relative",
        // Break out of the page padding to run edge to edge
        mx: { xs: -2, sm: -3 },
        // Edge to edge at the top, unless the replay banner sits above it
        mt: replay ? 0 : { xs: -2, sm: -3 },
        borderBottom: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
        backgroundImage: "var(--ops-scan)",
        overflow: "hidden",
      }}
    >
      {/* the state colour as a thin rail along the top edge */}
      <Box aria-hidden sx={{ height: 3, bgcolor: color }} />
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "auto minmax(0, 1fr) auto" }, gap: { xs: 2, md: 4 }, alignItems: "center", px: { xs: 2, sm: 3 }, py: { xs: 2, md: 1.5 } }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <Box
            aria-hidden
            sx={{
              width: { xs: 48, md: 56 },
              height: { xs: 48, md: 56 },
              borderRadius: "50%",
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: theme.palette.getContrastText(color),
              bgcolor: color,
              border: "3px solid var(--ops-bezel)",
              boxShadow: `0 0 0 1px ${color}, 0 0 28px ${color}88, inset 0 -6px 12px rgba(0,0,0,0.25)`,
            }}
          >
            <HealthIcon health={o.health} size={26} title="" />
          </Box>
          <Box role="status" aria-label={`Status ${STATUS_WORDS[o.health]}`}>
            <ConsoleLabel component="p">Status</ConsoleLabel>
            <Typography component="p" sx={{ fontFamily: DISPLAY_STACK, fontWeight: 700, fontSize: { xs: "2.25rem", md: "3.25rem" }, lineHeight: 1, letterSpacing: "0.08em", color }}>
              {STATUS_WORDS[o.health]}
            </Typography>
          </Box>
        </Box>

        <Box sx={{ minWidth: 0, borderLeft: { md: 1 }, borderColor: { md: "divider" }, pl: { md: 4 } }}>
          <ConsoleLabel component="p" sx={{ color: "text.primary" }}>
            Mission Vartmaan
          </ConsoleLabel>
          <Typography component="h1" sx={{ fontFamily: DISPLAY_STACK, fontSize: { xs: "1.5rem", md: "2rem" }, fontWeight: 600, lineHeight: 1.15, mt: 0.25 }}>
            {o.headline}
          </Typography>
        </Box>

        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", sm: "repeat(3, auto)" }, columnGap: { xs: 2, sm: 4 }, rowGap: 1.5 }}>
          <BandReadout label="T+ IST">
            <BoardTime asOf={o.asOf} replay={replay} />
          </BandReadout>
          <BandReadout label="Stack up" tone="success.main">
            <StreakCounter u={o.uptime} asOf={o.asOf} replay={replay} />
          </BandReadout>
          {since ? (
            <BandReadout label="On shift">
              <ShiftTime since={since} />
            </BandReadout>
          ) : null}
        </Box>
      </Box>
      <Box sx={{ px: { xs: 2, sm: 3 }, py: 1, borderTop: 1, borderColor: "divider", bgcolor: "var(--ops-screen)" }}>
        <Readout c={o.counts} />
      </Box>
    </Box>
  );
}

/** Today's counts as one readout strip. */
function Readout({ c }: { c: Overview["counts"] }) {
  const items: [string, number][] = [
    ["Stories in", c.storiesIn],
    ["Approved", c.approved],
    ["In feed", c.inFeed],
    ["Octopus", c.collectedByOctopus],
    ["On X", c.xPosts],
    ["Open alerts", c.openAlerts],
    ["Incidents", c.openIncidents],
  ];
  return (
    <Box component="dl" aria-label="Today so far" sx={{ m: 0, display: "flex", flexWrap: "wrap", columnGap: { xs: 2.5, sm: 4 }, rowGap: 1 }}>
      {items.map(([label, n]) => (
        <Box key={label} sx={{ display: "flex", alignItems: "baseline", gap: 0.75 }}>
          <Box component="dd" sx={{ m: 0, fontFamily: MONO_STACK, fontSize: "1.0625rem", fontWeight: 500, order: 2 }}>
            {n}
          </Box>
          <Box component="dt" sx={{ fontFamily: DISPLAY_STACK, fontSize: "0.6875rem", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "text.secondary", order: 1 }}>
            {label}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

/** "UP 4h 38m", ticking with the clock on a live board. */
function StreakNow({ u, asOf, replay }: { u: StackUptime; asOf: string; replay: boolean }) {
  const now = useSecondClock();
  const extra = replay || !now ? 0 : Math.max(0, (now - Date.parse(asOf)) / 1000);
  return <>{streak(u.streakSec + extra)}</>;
}

export function StackUptimePanel({ u, asOf, replay, n }: { u: StackUptime; asOf: string; replay: boolean; n?: number }) {
  const o = u.lastOutage;
  return (
    <Panel n={n} title="Stack uptime" id="uptime">
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, mt: 0.5 }}>
        <Typography component="span" sx={{ fontFamily: DISPLAY_STACK, fontWeight: 700, fontSize: "1rem", letterSpacing: "0.1em", color: "success.main" }}>
          UP
        </Typography>
        <Typography component="span" sx={{ fontFamily: MONO_STACK, fontSize: "2rem", fontWeight: 500, lineHeight: 1.1 }}>
          <StreakNow u={u} asOf={asOf} replay={replay} />
        </Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" title={exactIst(u.upSince)}>
        since {hmIst(u.upSince)}, longest {streak(u.longestStreakSec)}
      </Typography>
      <Box sx={{ display: "flex", gap: 3, mt: 1.25 }}>
        {(
          [
            ["24 h", u.uptimePct24h],
            ["7 d", u.uptimePct7d],
          ] as const
        ).map(([label, pct]) => (
          <Box key={label}>
            <Typography sx={{ fontFamily: MONO_STACK, fontSize: "1.125rem", fontWeight: 500 }}>{pct.toFixed(pct >= 99.95 ? 0 : 1)}%</Typography>
            <ConsoleLabel component="p" sx={{ fontSize: "0.6875rem" }}>
              Uptime {label}
            </ConsoleLabel>
          </Box>
        ))}
      </Box>
      <Box sx={{ mt: 1.25, pt: 1.25, borderTop: 1, borderColor: "divider" }}>
        {o ? (
          <Typography variant="body2">
            <Box component="span" sx={{ color: "text.secondary" }}>
              Last outage{" "}
            </Box>
            <Box component="span" sx={{ fontFamily: MONO_STACK }}>
              {hmIst(o.from)}–{o.to ? hmIst(o.to) : "now"}
            </Box>{" "}
            {o.reason}
            {o.incidentId ? (
              <>
                {" "}
                <Box component={Link} href={`/reports/incidents/${encodeURIComponent(o.incidentId)}`} sx={{ color: "primary.main", fontFamily: MONO_STACK, fontWeight: 600 }}>
                  {o.incidentId}
                </Box>
              </>
            ) : null}
          </Typography>
        ) : (
          <Typography variant="body2" color="text.secondary">
            No outage on record.
          </Typography>
        )}
      </Box>
    </Panel>
  );
}

/** One code change: what, where, who, when and which files. */
export function ChangeSummary({ c }: { c: CodeChange | null }) {
  return (
    <Box>
      {c ? (
        <>
          <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start", mt: 0.75 }}>
            <Box sx={{ color: "primary.main", pt: "2px", flexShrink: 0 }}>
              <GitCommitHorizontal size={16} aria-hidden />
            </Box>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {c.summary}
            </Typography>
          </Box>
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5, display: "flex", gap: 1, flexWrap: "wrap", alignItems: "baseline" }}>
            <Raw sx={{ color: "text.primary" }}>{c.repo}</Raw>
            {c.ref ? <Raw>{c.ref.slice(0, 8)}</Raw> : null}
            <span>{c.system === "sentry" ? "Sentry" : systemName(c.system)}</span>
            <span>{c.author}</span>
            <RelTime iso={c.at} />
          </Typography>
          {c.files.length ? (
            <Box component="ul" aria-label="Files changed" sx={{ listStyle: "none", m: 0, mt: 0.75, p: 0 }}>
              {c.files.slice(0, 3).map((f) => (
                <li key={f}>
                  <Raw>{f}</Raw>
                </li>
              ))}
              {c.files.length > 3 ? (
                <li>
                  <Raw>+{c.files.length - 3} more</Raw>
                </li>
              ) : null}
            </Box>
          ) : null}
          {c.source !== "git" ? (
            <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>
              {c.source === "file-mtime" ? "Seen from file times; this repo is not in git." : "Sample data."}
            </Typography>
          ) : null}
        </>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
          No code changes recorded.
        </Typography>
      )}
    </Box>
  );
}

/** The latest events as one console line. In replay only events up to that moment show. */
export function EventsLine({ items, asOf }: { items: Notification[]; asOf: string }) {
  const until = Date.parse(asOf);
  const shown = items.filter((n) => Date.parse(n.at) <= until).slice(0, 5);
  return (
    <Box sx={{ display: "flex", gap: { xs: 1, sm: 2 }, alignItems: "baseline", flexWrap: { xs: "wrap", md: "nowrap" }, minWidth: 0 }}>
      <ConsoleLabel component="h2" sx={{ display: "flex", alignItems: "center", gap: 0.5, flexShrink: 0 }}>
        <History size={13} aria-hidden /> Events
      </ConsoleLabel>
      {shown.length ? (
        <Box component="ol" aria-label="Latest events" sx={{ listStyle: "none", m: 0, p: 0, display: "flex", gap: { xs: 0.5, md: 2.5 }, flexDirection: { xs: "column", md: "row" }, minWidth: 0, overflow: "hidden" }}>
          {shown.map((n) => {
            const first = n.evidence[0];
            return (
              <Box component="li" key={n.id} sx={{ display: "flex", gap: 0.75, alignItems: "baseline", minWidth: 0, flexShrink: { md: 1 } }}>
                <Box component="time" dateTime={n.at} sx={{ fontFamily: MONO_STACK, fontSize: "0.75rem", color: n.severity === "critical" ? "error.main" : n.severity === "warning" ? "warning.main" : "text.secondary", flexShrink: 0 }}>
                  {hmIst(n.at)}
                </Box>
                <Typography variant="body2" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }} title={n.title}>
                  {first ? (
                    <Box component={Link} href="/notifications" sx={{ color: "text.primary", textDecoration: "none", "&:hover": { textDecoration: "underline" } }}>
                      {n.title}
                    </Box>
                  ) : (
                    n.title
                  )}
                </Typography>
              </Box>
            );
          })}
        </Box>
      ) : (
        <Typography variant="body2" color="text.secondary">
          No events yet.
        </Typography>
      )}
    </Box>
  );
}
