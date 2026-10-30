"use client";

// Today's telemetry as a chart panel, with the replay jog directly beneath it on
// the same time axis (00:00 to 24:00). Stories in are an area, errors are bars,
// Octopus polls are a strip; the blind spot is shaded and named. A NOW cursor
// marks the live moment and a replay cursor follows the jog. Hover reads out a
// bucket. Drawn at real pixel width so text and lines stay crisp.
import { Box, Typography, useTheme } from "@mui/material";
import { useId, useState } from "react";
import type { TelemetryPoint } from "@/types/control";
import { hmIst, istMidnight } from "@/lib/time";
import { useElementWidth } from "@/hooks/useElementWidth";
import { DISPLAY_STACK, MONO_STACK } from "@/providers/MuiProvider";

const STEP_SEC = 600; // one telemetry bucket
const DAY_SEC = 86400;
const M = { left: 40, right: 12, top: 26, bottom: 24 };
const POLL_H = 10;
const POLL_GAP = 8;

interface Blind {
  from: number;
  to: number;
}

// Runs of buckets with no Octopus poll, inside the span where polling was happening
function blindRuns(points: TelemetryPoint[]): Blind[] {
  const first = points.findIndex((p) => p.feedPolls > 0);
  let last = -1;
  for (let i = points.length - 1; i >= 0; i--)
    if (points[i].feedPolls > 0) {
      last = i;
      break;
    }
  const runs: Blind[] = [];
  if (first < 0) return runs;
  for (let i = first; i <= last; i++) {
    if (points[i].feedPolls > 0) continue;
    const start = Date.parse(points[i].at);
    let j = i;
    while (j + 1 <= last && points[j + 1].feedPolls === 0) j++;
    runs.push({ from: start, to: Date.parse(points[j].at) + STEP_SEC * 1000 });
    i = j;
  }
  return runs;
}

function niceMax(n: number) {
  if (n <= 4) return 4;
  const step = Math.pow(10, Math.floor(Math.log10(n)));
  return Math.ceil(n / (step / 2)) * (step / 2);
}

function Chart({ points, t0, now, cursor, height }: { points: TelemetryPoint[]; t0: number; now: number; cursor: number | null; height: number }) {
  const theme = useTheme();
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const patternId = useId().replace(/:/g, "");
  const W = Math.max(280, width);
  const plotW = W - M.left - M.right;
  const plotH = height - M.top - M.bottom - POLL_H - POLL_GAP;
  const x = (ms: number) => M.left + ((ms - t0) / (DAY_SEC * 1000)) * plotW;
  const maxV = niceMax(Math.max(...points.map((p) => Math.max(p.storiesIn, p.errors)), 1));
  const y = (v: number) => M.top + plotH - (v / maxV) * plotH;
  const bw = Math.max(1, (STEP_SEC / DAY_SEC) * plotW);
  const pollY = M.top + plotH + POLL_GAP;
  const blinds = blindRuns(points);
  const brand = theme.palette.primary.main;
  const red = theme.palette.error.main;
  const dim = theme.palette.text.secondary;
  const line = theme.palette.divider;
  const narrow = W < 560;

  // area path for stories, stepped per bucket
  let area = "";
  let edge = "";
  points.forEach((p, i) => {
    const x0 = x(Date.parse(p.at));
    const yy = y(p.storiesIn);
    area += `${i ? "L" : "M"} ${x0.toFixed(1)} ${yy.toFixed(1)} L ${(x0 + bw).toFixed(1)} ${yy.toFixed(1)} `;
  });
  edge = area;
  if (points.length) {
    const last = x(Date.parse(points[points.length - 1].at)) + bw;
    area += `L ${last.toFixed(1)} ${y(0)} L ${x(Date.parse(points[0].at)).toFixed(1)} ${y(0)} Z`;
  }

  const hoverPoint = hover !== null ? points[hover] : null;
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const ms = t0 + ((e.clientX - r.left - M.left) / plotW) * DAY_SEC * 1000;
    const i = points.findIndex((p) => ms >= Date.parse(p.at) && ms < Date.parse(p.at) + STEP_SEC * 1000);
    setHover(i >= 0 ? i : null);
  };

  const totalIn = points.reduce((n, p) => n + p.storiesIn, 0);
  const totalErr = points.reduce((n, p) => n + p.errors, 0);
  const label = `Telemetry today: ${totalIn} stories in, ${totalErr} errors.${blinds.length ? ` Octopus did not poll ${blinds.map((b) => `${hmIst(b.from)} to ${hmIst(b.to)}`).join(", ")}.` : " Octopus polled throughout."}`;

  return (
    <Box ref={ref} sx={{ position: "relative", width: "100%" }}>
      <svg width={W} height={height} role="img" aria-label={label} onPointerMove={onMove} onPointerLeave={() => setHover(null)} style={{ display: "block", maxWidth: "100%", touchAction: "pan-y" }}>
        <defs>
          <pattern id={patternId} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="7" height="7" fill={red} fillOpacity={0.08} />
            <line x1="0" y1="0" x2="0" y2="7" stroke={red} strokeWidth="2" strokeOpacity={0.45} />
          </pattern>
          <linearGradient id={`${patternId}-a`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={brand} stopOpacity={0.45} />
            <stop offset="1" stopColor={brand} stopOpacity={0.04} />
          </linearGradient>
        </defs>

        {/* grid: three value lines, a line every 2 h */}
        {[0, maxV / 2, maxV].map((v) => (
          <g key={v}>
            <line x1={M.left} x2={W - M.right} y1={y(v)} y2={y(v)} stroke={line} strokeDasharray={v ? "2 4" : undefined} />
            <text x={M.left - 8} y={y(v) + 4} textAnchor="end" fill={dim} style={{ fontFamily: MONO_STACK, fontSize: 10 }}>
              {v}
            </text>
          </g>
        ))}
        {Array.from({ length: 13 }, (_, i) => i * 2).map((h) => {
          const xx = x(t0 + h * 3600_000);
          return (
            <g key={h}>
              <line x1={xx} x2={xx} y1={M.top} y2={pollY + POLL_H} stroke={line} strokeOpacity={h % 6 === 0 ? 1 : 0.5} />
              {narrow && h % 4 !== 0 ? null : (
                <text x={xx} y={height - 6} textAnchor="middle" fill={dim} style={{ fontFamily: MONO_STACK, fontSize: 10 }}>
                  {String(h % 24).padStart(2, "0")}
                </text>
              )}
            </g>
          );
        })}

        {/* blind spot: shaded across the plot and named */}
        {blinds.map((b, i) => (
          <g key={i}>
            <rect x={x(b.from)} y={M.top} width={Math.max(3, x(b.to) - x(b.from))} height={pollY + POLL_H - M.top} fill={`url(#${patternId})`} />
            <text x={x(b.from) + (x(b.to) - x(b.from)) / 2} y={M.top - 8} textAnchor="middle" fill={red} style={{ fontFamily: DISPLAY_STACK, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em" }}>
              {narrow ? "BLIND" : `OCTOPUS BLIND ${hmIst(b.from)}–${hmIst(b.to)}`}
            </text>
          </g>
        ))}

        {/* stories in: area; errors: bars */}
        <path d={area} fill={`url(#${patternId}-a)`} />
        <path d={edge} fill="none" stroke={brand} strokeWidth={1.5} />
        {points.map((p) =>
          p.errors > 0 ? <rect key={p.at} x={x(Date.parse(p.at)) + bw * 0.2} y={y(p.errors)} width={Math.max(1.5, bw * 0.6)} height={y(0) - y(p.errors)} fill={red} /> : null
        )}

        {/* Octopus polls strip */}
        <text x={M.left - 8} y={pollY + POLL_H - 1} textAnchor="end" fill={dim} style={{ fontFamily: DISPLAY_STACK, fontSize: 9, letterSpacing: "0.06em" }}>
          OCT
        </text>
        {points.map((p) => (p.feedPolls > 0 ? <rect key={p.at} x={x(Date.parse(p.at))} y={pollY} width={Math.max(1, bw - 0.5)} height={POLL_H} fill={dim} fillOpacity={0.25 + 0.6 * Math.min(1, p.feedPolls / 10)} /> : null))}

        {/* after the replay moment, the day is dimmed */}
        {cursor !== null ? <rect x={x(cursor)} y={M.top} width={Math.max(0, x(now) - x(cursor))} height={pollY + POLL_H - M.top} fill="var(--ops-screen)" fillOpacity={0.65} /> : null}

        {/* NOW cursor */}
        <line x1={x(now)} x2={x(now)} y1={M.top - 4} y2={pollY + POLL_H} stroke={theme.palette.text.primary} strokeDasharray="3 3" />
        <text x={Math.min(x(now) + 4, W - M.right - 40)} y={M.top + 10} fill={theme.palette.text.primary} style={{ fontFamily: DISPLAY_STACK, fontSize: 10, fontWeight: 700, letterSpacing: "0.08em" }}>
          NOW
        </text>

        {/* replay cursor */}
        {cursor !== null ? (
          <g>
            <line x1={x(cursor)} x2={x(cursor)} y1={M.top - 4} y2={pollY + POLL_H} stroke={brand} strokeWidth={2} />
            <rect x={x(cursor) - 22} y={M.top - 20} width={44} height={15} rx={2} fill={brand} />
            <text x={x(cursor)} y={M.top - 9} textAnchor="middle" fill={theme.palette.primary.contrastText} style={{ fontFamily: MONO_STACK, fontSize: 10.5, fontWeight: 600 }}>
              {hmIst(cursor)}
            </text>
          </g>
        ) : null}

        {/* hover marker */}
        {hoverPoint ? <rect x={x(Date.parse(hoverPoint.at))} y={M.top} width={bw} height={pollY + POLL_H - M.top} fill={theme.palette.text.primary} fillOpacity={0.08} /> : null}
      </svg>

      {hoverPoint ? (
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            top: 4,
            left: Math.min(Math.max(0, x(Date.parse(hoverPoint.at)) + 10), W - 150),
            width: 140,
            p: 1,
            bgcolor: "background.paper",
            border: 1,
            borderColor: "divider",
            borderRadius: "3px",
            fontFamily: MONO_STACK,
            fontSize: "0.75rem",
            lineHeight: 1.5,
            pointerEvents: "none",
          }}
        >
          <Box sx={{ fontWeight: 600 }}>
            {hmIst(hoverPoint.at)}–{hmIst(Date.parse(hoverPoint.at) + STEP_SEC * 1000)}
          </Box>
          <Box sx={{ color: "primary.main" }}>{hoverPoint.storiesIn} stories in</Box>
          <Box sx={{ color: hoverPoint.errors ? "error.main" : "text.secondary" }}>{hoverPoint.errors} errors</Box>
          <Box sx={{ color: hoverPoint.feedPolls ? "text.secondary" : "error.main" }}>{hoverPoint.feedPolls ? `${hoverPoint.feedPolls} Octopus polls` : "no Octopus poll"}</Box>
        </Box>
      ) : null}
    </Box>
  );
}

/** The chart with its legend; the cursor follows the replay moment, when there is one. */
export function TelemetryChart({ points, liveAsOf, replayAt, height = 260 }: { points: TelemetryPoint[]; liveAsOf: string; replayAt: string | null; height?: number }) {
  const now = Date.parse(liveAsOf);
  const t0 = istMidnight(now);
  return (
    <Box>
      <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", fontSize: "0.75rem", color: "text.secondary", mb: 0.5 }}>
        <Legend swatch="primary.main" text="Stories in" />
        <Legend swatch="error.main" text="Errors" />
        <Legend swatch="text.secondary" text="Octopus polls (OCT)" />
        <Typography variant="caption" color="text.secondary" sx={{ ml: { sm: "auto" } }}>
          10-minute buckets. Hover for a reading.
        </Typography>
      </Box>
      <Chart points={points} t0={t0} now={now} cursor={replayAt ? Date.parse(replayAt) : null} height={height} />
    </Box>
  );
}

export { blindRuns };

function Legend({ swatch, text }: { swatch: string; text: string }) {
  return (
    <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
      <Box component="span" sx={{ width: 10, height: 10, bgcolor: swatch, borderRadius: "1px" }} />
      {text}
    </Box>
  );
}
