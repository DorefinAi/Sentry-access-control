"use client";

// Instrument dials. Each gauge is a rim and face with a graduated tick ring,
// warn and danger zones, a needle that sweeps to its value (on first paint and
// whenever the value changes), the value in the display face and an engraved
// label. A state word under the dial means it never relies on colour.
import { Box, Typography, useTheme } from "@mui/material";
import type { Gauge } from "@/types/control";
import { HealthLabel, healthColor } from "@/components/common/Health";
import { DISPLAY_STACK } from "@/providers/MuiProvider";

const SIZE = 168;
const C = SIZE / 2;
const START = 135; // polar degrees, clockwise from +x: lower left
const SWEEP = 270;

function polar(deg: number, r: number) {
  const a = (deg * Math.PI) / 180;
  return [C + r * Math.cos(a), C + r * Math.sin(a)] as const;
}

function arc(fromDeg: number, toDeg: number, r: number) {
  if (toDeg - fromDeg < 0.01) return "";
  const [x1, y1] = polar(fromDeg, r);
  const [x2, y2] = polar(toDeg, r);
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${toDeg - fromDeg > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

const frac = (v: number, max: number) => (max > 0 ? Math.max(0, Math.min(1, v / max)) : 0);
const deg = (f: number) => START + SWEEP * f;

/** Warn and danger bands. When warnAt is below dangerAt, high is bad; otherwise low is bad. */
function zones(g: Gauge): { from: number; to: number; level: "warn" | "danger" }[] {
  const out: { from: number; to: number; level: "warn" | "danger" }[] = [];
  const w = g.warnAt !== undefined ? frac(g.warnAt, g.max) : null;
  const d = g.dangerAt !== undefined ? frac(g.dangerAt, g.max) : null;
  const highBad = w === null || d === null ? true : w <= d;
  if (highBad) {
    if (w !== null) out.push({ from: w, to: d ?? 1, level: "warn" });
    if (d !== null) out.push({ from: d, to: 1, level: "danger" });
  } else {
    if (w !== null) out.push({ from: d ?? 0, to: w, level: "warn" });
    if (d !== null) out.push({ from: 0, to: d, level: "danger" });
  }
  return out;
}

function Dial({ g }: { g: Gauge }) {
  const theme = useTheme();
  const color = healthColor(theme, g.health);
  const f = frac(g.value, g.max);
  const dim = theme.palette.text.secondary;
  const needleDeg = -135 + SWEEP * f; // 0deg points straight up

  return (
    <Box component="svg" viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden sx={{ width: "100%", maxWidth: SIZE, display: "block", mx: "auto" }}>
      {/* rim and face */}
      <circle cx={C} cy={C} r={C - 2} fill="var(--ops-raised)" stroke="var(--ops-bezel)" strokeWidth={1.5} />
      <circle cx={C} cy={C} r={C - 10} fill="var(--ops-screen)" stroke="var(--ops-line)" strokeWidth={1} />
      {/* graduated ring: minor every 2 %, major every 10 % */}
      {Array.from({ length: 51 }, (_, i) => {
        const major = i % 5 === 0;
        const [x1, y1] = polar(deg(i / 50), C - 14);
        const [x2, y2] = polar(deg(i / 50), C - (major ? 24 : 19));
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={dim} strokeOpacity={major ? 0.9 : 0.45} strokeWidth={major ? 1.4 : 0.8} />;
      })}
      {/* warn and danger zones */}
      {zones(g).map((z, i) => (
        <path key={i} d={arc(deg(z.from), deg(z.to), C - 29)} fill="none" stroke={z.level === "danger" ? theme.palette.error.main : theme.palette.warning.main} strokeWidth={4} strokeOpacity={0.85} />
      ))}
      {/* faint sweep in the state colour */}
      <path d={arc(START, START + SWEEP, C - 36)} fill="none" stroke="var(--ops-line)" strokeWidth={3} />
      <path
        d={arc(START, START + SWEEP, C - 36)}
        fill="none"
        stroke={color}
        strokeWidth={3}
        pathLength={100}
        strokeDasharray={`${(f * 100).toFixed(2)} 100`}
        style={{ transition: "stroke-dasharray 900ms cubic-bezier(.2,.8,.2,1), stroke 300ms" }}
      />
      {/* needle */}
      <g className="gauge-needle" style={{ transform: `rotate(${needleDeg.toFixed(2)}deg)`, transformOrigin: `${C}px ${C}px`, transition: "transform 900ms cubic-bezier(.2,.8,.2,1)" }}>
        <line x1={C} y1={C + 10} x2={C} y2={20} stroke={theme.palette.text.primary} strokeWidth={2} strokeLinecap="round" />
        <circle cx={C} cy={C} r={6} fill="var(--ops-bezel)" stroke={theme.palette.text.primary} strokeWidth={1.5} />
      </g>
      <text x={C} y={C + 36} textAnchor="middle" fill={theme.palette.text.primary} style={{ fontFamily: DISPLAY_STACK, fontSize: 21, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
        {g.display}
      </text>
    </Box>
  );
}

export function Gauges({ gauges }: { gauges: Gauge[] }) {
  return (
    <Box component="ul" aria-label="Readouts" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", sm: "repeat(auto-fit, minmax(140px, 1fr))" }, gap: { xs: 2, sm: 2.5 } }}>
      {gauges.map((g) => (
        <Box component="li" key={g.id} aria-label={`${g.label}: ${g.display}. ${g.hint}`} sx={{ minWidth: 0, textAlign: "center" }}>
          <Dial g={g} />
          {/* engraved plate */}
          <Typography
            component="p"
            sx={{
              mt: 0.75,
              fontFamily: DISPLAY_STACK,
              fontWeight: 700,
              fontSize: "0.75rem",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "text.secondary",
              textShadow: (t) => (t.palette.mode === "dark" ? "0 1px 0 rgba(0,0,0,0.9), 0 -1px 0 rgba(255,255,255,0.05)" : "0 1px 0 #FFFFFF"),
            }}
          >
            {g.label}
          </Typography>
          <Box sx={{ mt: 0.25 }}>
            <HealthLabel health={g.health} size="caption" label={g.health === "ok" ? "Nominal" : undefined} />
          </Box>
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.25, lineHeight: 1.35, px: 0.5 }}>
            {g.hint}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}
