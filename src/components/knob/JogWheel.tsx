"use client";

// The replay jog wheel. Endless rotation: one full turn is 2 hours, clockwise
// goes forward. Clamped to 00:00..the board's frozen NOW (its asOf, never the
// wall clock) with a soft stop. A quick spin keeps
// coasting and slows down (inertia); reduced motion turns inertia off. While it
// turns, the board is fetched at most 4 times a second, and once more at rest.
// Keyboard: arrows 10 min, Shift+arrows 1 h, Home = 00:00, End = live.
import { Box, Button, Typography, useTheme } from "@mui/material";
import { Radio } from "lucide-react";
import { KeyboardEvent, PointerEvent, useEffect, useRef, useState } from "react";
import { hmIst, istMidnight } from "@/lib/time";
import { DISPLAY_STACK, MONO_STACK } from "@/providers/MuiProvider";
import { polar, pointerAngle, useReducedMotion } from "./arc";

const SIZE = 210;
const C = SIZE / 2;
const SEC_PER_DEG = 7200 / 360; // one turn = 2 h
const KEY_STEP = 600;
const THROTTLE_MS = 250;
const DAY = 86400;

// Timing for the throttle and the drag. Only handlers and animation frames call
// it, never render; keeping it out here makes that plain to the purity lint.
const clockMs = () => performance.now();

export interface Mark {
  from: number; // epoch ms
  to: number;
  label: string;
}

export function JogWheel({ liveAsOf, replayAt, marks, onScrub }: { liveAsOf: string; replayAt: string | null; marks: Mark[]; onScrub: (iso: string | null) => void }) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const now = Date.parse(liveAsOf);
  const t0 = istMidnight(now);
  const maxSec = Math.max(KEY_STEP, Math.floor((now - t0) / 1000));
  const committed = replayAt ? Math.min(maxSec, Math.max(0, Math.round((Date.parse(replayAt) - t0) / 1000))) : maxSec;

  // While the hand (or inertia) is on the wheel, `active` holds the position
  const [active, setActive] = useState<number | null>(null);
  const sec = active ?? committed;
  const pos = useRef(sec);
  const drag = useRef<{ angle: number; at: number; vel: number } | null>(null);
  const raf = useRef(0);
  const lastSent = useRef(0);
  const sendTimer = useRef<number | undefined>(undefined);

  const clamp = (s: number) => Math.max(0, Math.min(maxSec, s));
  const emit = (s: number) => onScrub(s >= maxSec ? null : new Date(t0 + Math.round(s) * 1000).toISOString());

  // At most one fetch per 250 ms while turning; the trailing call always lands
  const send = (s: number, final = false) => {
    window.clearTimeout(sendTimer.current);
    const wait = THROTTLE_MS - (clockMs() - lastSent.current);
    if (final || wait <= 0) {
      lastSent.current = clockMs();
      emit(s);
    } else sendTimer.current = window.setTimeout(() => send(pos.current, true), wait);
  };

  const setPos = (s: number) => {
    pos.current = clamp(s);
    setActive(pos.current);
  };

  const settle = () => {
    send(pos.current, true);
    setActive(null);
  };

  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      window.clearTimeout(sendTimer.current);
    },
    []
  );

  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    // Only the primary button (or a touch / pen contact) turns the wheel
    if (e.button !== 0) return;
    cancelAnimationFrame(raf.current);
    e.currentTarget.setPointerCapture(e.pointerId);
    pos.current = sec;
    drag.current = { angle: pointerAngle(e, e.currentTarget), at: clockMs(), vel: 0 };
    setActive(sec);
  };

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const a = pointerAngle(e, e.currentTarget);
    let delta = a - d.angle;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    const t = clockMs();
    const dt = Math.max(1, t - d.at);
    // Smoothed velocity in seconds of board time per ms of real time
    d.vel = d.vel * 0.6 + ((delta * SEC_PER_DEG) / dt) * 0.4;
    d.angle = a;
    d.at = t;
    setPos(pos.current + delta * SEC_PER_DEG);
    send(pos.current);
  };

  const onUp = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    // Coast after a quick spin, slowing down; stop at the ends
    let v = clockMs() - d.at > 80 ? 0 : d.vel;
    if (reduced || Math.abs(v) < 0.05) return settle();
    let last = clockMs();
    const coast = (t: number) => {
      const dt = Math.min(48, t - last);
      last = t;
      const next = clamp(pos.current + v * dt);
      const hitEnd = next === 0 || next === maxSec;
      setPos(next);
      send(next);
      v *= Math.exp(-dt / 420);
      if (hitEnd || Math.abs(v) < 0.02) return settle();
      raf.current = requestAnimationFrame(coast);
    };
    raf.current = requestAnimationFrame(coast);
  };

  const onKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 3600 : KEY_STEP;
    const map: Record<string, number> = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: 3600, PageDown: -3600 };
    let next: number | null = null;
    if (e.key in map) next = sec + map[e.key];
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = maxSec;
    if (next === null) return;
    e.preventDefault();
    pos.current = clamp(next);
    // Keys land on whole 10-minute marks so a replay is easy to repeat
    if (Math.abs(map[e.key] ?? 0) === KEY_STEP) pos.current = clamp(Math.round(pos.current / KEY_STEP) * KEY_STEP);
    emit(pos.current);
    setActive(null);
  };

  const rotation = sec / SEC_PER_DEG; // degrees the disc has turned since midnight
  const live = sec >= maxSec;
  const brand = theme.palette.primary.main;
  const dim = theme.palette.text.secondary;
  const knurl = Array.from({ length: 96 }, (_, i) => (i * 360) / 96);
  const [ix, iy] = polar(C, C, C - 30, rotation - 90);

  return (
    <Box sx={{ display: "grid", gap: 1.5, justifyItems: "center" }}>
      <Box
        component="svg"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="slider"
        tabIndex={0}
        aria-label="Replay jog wheel"
        aria-valuemin={0}
        aria-valuemax={maxSec}
        aria-valuenow={Math.round(sec)}
        aria-valuetext={live ? "Live" : `${hmIst(t0 + sec * 1000)} IST, not live`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onKeyDown={onKey}
        sx={{
          width: { xs: 190, sm: SIZE },
          display: "block",
          touchAction: "none",
          cursor: "grab",
          "&:active": { cursor: "grabbing" },
          userSelect: "none",
          borderRadius: "50%",
          "&:focus-visible": { outline: "2px solid var(--focus-ring)", outlineOffset: 4 },
        }}
      >
        {/* bezel with the fixed index pointer at twelve o'clock */}
        <circle cx={C} cy={C} r={C - 2} fill="var(--ops-raised)" stroke="var(--ops-bezel)" strokeWidth={1.5} />
        <path d={`M ${C - 6} 4 L ${C + 6} 4 L ${C} 14 Z`} fill={brand} />
        {/* the turning disc: knurled rim and an index mark */}
        <g transform={`rotate(${rotation.toFixed(2)} ${C} ${C})`}>
          <circle cx={C} cy={C} r={C - 16} fill="var(--ops-screen)" stroke="var(--ops-bezel)" strokeWidth={2} />
          {knurl.map((d) => {
            const [x1, y1] = polar(C, C, C - 17, d);
            const [x2, y2] = polar(C, C, C - 26, d);
            return <line key={d} x1={x1} y1={y1} x2={x2} y2={y2} stroke={dim} strokeOpacity={0.55} strokeWidth={1.2} />;
          })}
        </g>
        <circle cx={ix} cy={iy} r={5} fill={brand} />
        <circle cx={C} cy={C} r={C - 44} fill="var(--ops-raised)" stroke="var(--ops-line)" />
        <text x={C} y={C - 14} textAnchor="middle" fill={live ? theme.palette.success.main : brand} style={{ fontFamily: DISPLAY_STACK, fontSize: 11, fontWeight: 700, letterSpacing: "0.16em" }}>
          {live ? "LIVE" : "REPLAY"}
        </text>
        <text x={C} y={C + 14} textAnchor="middle" fill={theme.palette.text.primary} style={{ fontFamily: MONO_STACK, fontSize: 28, fontWeight: 500 }}>
          {hmIst(t0 + sec * 1000)}
        </text>
        <text x={C} y={C + 32} textAnchor="middle" fill={dim} style={{ fontFamily: DISPLAY_STACK, fontSize: 9.5, letterSpacing: "0.12em" }}>
          1 TURN = 2 H
        </text>
      </Box>
      <Timeline t0={t0} now={now} sec={sec} marks={marks} />
      <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
        <Typography variant="caption" color="text.secondary" sx={{ textAlign: "center" }}>
          Turn to replay today. Arrows: 10 min, Shift: 1 h, End: live.
        </Typography>
        {!live ? (
          <Button size="small" variant="outlined" startIcon={<Radio size={14} aria-hidden />} onClick={() => (setActive(null), onScrub(null))}>
            Back to live
          </Button>
        ) : null}
      </Box>
    </Box>
  );
}

/** A linear day under the wheel: position, the live moment, and outage marks. */
function Timeline({ t0, now, sec, marks }: { t0: number; now: number; sec: number; marks: Mark[] }) {
  const pct = (ms: number) => `${Math.max(0, Math.min(100, ((ms - t0) / (DAY * 1000)) * 100))}%`;
  return (
    <Box sx={{ width: "100%", maxWidth: 360 }} aria-hidden>
      <Box sx={{ position: "relative", height: 14, borderRadius: "2px", bgcolor: "var(--ops-screen)", border: 1, borderColor: "divider" }}>
        <Box sx={{ position: "absolute", left: 0, top: 0, bottom: 0, width: pct(now), bgcolor: "action.selected" }} />
        {marks.map((m, i) => (
          <Box key={i} title={m.label} sx={{ position: "absolute", top: 0, bottom: 0, left: pct(m.from), width: `max(3px, calc(${pct(m.to)} - ${pct(m.from)}))`, bgcolor: "error.main", opacity: 0.85 }} />
        ))}
        <Box sx={{ position: "absolute", top: -3, bottom: -3, left: pct(now), width: "1px", bgcolor: "text.primary" }} />
        <Box sx={{ position: "absolute", top: -4, bottom: -4, left: pct(t0 + sec * 1000), width: 3, ml: "-1px", bgcolor: "primary.main", borderRadius: "1px" }} />
      </Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", mt: 0.5, fontFamily: MONO_STACK, fontSize: "0.6875rem", color: "text.secondary" }}>
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </Box>
      {marks.length ? (
        <Typography variant="caption" sx={{ display: "block", textAlign: "center", color: "error.main", fontFamily: MONO_STACK, mt: 0.25 }}>
          {marks.map((m) => m.label).join("   ")}
        </Typography>
      ) : null}
    </Box>
  );
}
