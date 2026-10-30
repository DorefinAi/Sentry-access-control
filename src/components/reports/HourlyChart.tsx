"use client";

// Stories in vs errors per hour, as plain SVG. Ink bars are stories, red bars are
// errors; the legend names both so the colours are not the only cue.
import { Box, Typography, useTheme } from "@mui/material";
import type { DailyReport } from "@/types/control";

const W = 720;
const H = 200;
const PAD = { top: 12, right: 8, bottom: 24, left: 32 };

function niceMax(n: number) {
  if (n <= 5) return 5;
  const step = Math.pow(10, Math.floor(Math.log10(n)));
  return Math.ceil(n / step) * step;
}

export function HourlyChart({ hourly }: { hourly: DailyReport["hourly"] }) {
  const theme = useTheme();
  const byHour = new Map(hourly.map((h) => [h.hour, h]));
  const hours = Array.from({ length: 24 }, (_, h) => byHour.get(h) ?? { hour: h, storiesIn: 0, errors: 0 });
  const max = niceMax(Math.max(1, ...hours.map((h) => Math.max(h.storiesIn, h.errors))));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const slot = innerW / 24;
  const bar = Math.max(2, Math.floor(slot / 2 - 2));
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const ink = theme.palette.text.primary;
  const err = theme.palette.error.main;
  const muted = theme.palette.text.secondary;
  const grid = theme.palette.divider;
  const peak = hours.reduce((a, b) => (b.storiesIn > a.storiesIn ? b : a), hours[0]);
  const totalErr = hours.reduce((n, h) => n + h.errors, 0);
  const hh = (h: number) => String(h).padStart(2, "0");

  return (
    <Box>
      <Box sx={{ display: "flex", gap: 2, mb: 1, flexWrap: "wrap" }}>
        <Typography variant="caption" sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}>
          <Box component="span" sx={{ width: 10, height: 10, bgcolor: ink, borderRadius: "2px" }} /> Stories in
        </Typography>
        <Typography variant="caption" sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}>
          <Box component="span" sx={{ width: 10, height: 10, bgcolor: err, borderRadius: "2px" }} /> Errors
        </Typography>
      </Box>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Stories and errors by hour. Busiest hour ${hh(peak.hour)}:00 with ${peak.storiesIn} stories. ${totalErr} errors in the day.`} style={{ display: "block", height: "auto" }}>
        {[0, max / 2, max].map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke={grid} strokeWidth={1} />
            <text x={PAD.left - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill={muted}>
              {v}
            </text>
          </g>
        ))}
        {hours.map((h) => {
          const x0 = PAD.left + h.hour * slot + (slot - bar * 2 - 2) / 2;
          return (
            <g key={h.hour}>
              <title>{`${hh(h.hour)}:00 to ${hh(h.hour)}:59: ${h.storiesIn} stories, ${h.errors} errors`}</title>
              <rect x={x0} y={y(h.storiesIn)} width={bar} height={Math.max(0, y(0) - y(h.storiesIn))} fill={ink} rx={1} />
              <rect x={x0 + bar + 2} y={y(h.errors)} width={bar} height={Math.max(0, y(0) - y(h.errors))} fill={err} rx={1} />
              {h.hour % 3 === 0 ? (
                <text x={PAD.left + h.hour * slot + slot / 2} y={H - 6} textAnchor="middle" fontSize={11} fill={muted}>
                  {hh(h.hour)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <Box component="details" sx={{ mt: 1, "& summary": { cursor: "pointer", fontSize: "0.8125rem", color: "text.secondary" } }}>
        <summary>Show the numbers</summary>
        <Box sx={{ overflowX: "auto" }}>
          <Box component="table" sx={{ borderCollapse: "collapse", fontSize: "0.75rem", mt: 1, "& th, & td": { px: 1, py: 0.25, textAlign: "right", borderBottom: 1, borderColor: "divider" } }}>
            <thead>
              <tr>
                <th scope="col">Hour</th>
                <th scope="col">Stories in</th>
                <th scope="col">Errors</th>
              </tr>
            </thead>
            <tbody>
              {hours.map((h) => (
                <tr key={h.hour}>
                  <th scope="row">{hh(h.hour)}:00</th>
                  <td>{h.storiesIn}</td>
                  <td>{h.errors}</td>
                </tr>
              ))}
            </tbody>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
