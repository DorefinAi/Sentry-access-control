"use client";

// A gauge as an instrument knob.
// Continuous: the needle, sweep and readout ease toward the value every frame
//   (about 400 ms to settle). A gauge with `live` keeps moving between polls.
//   Writes go straight to the SVG through refs, so 60 fps never re-renders React.
// Interactive: the warn and danger marks are handles (role="slider"). Drag them
//   along the ring, or focus one and use arrows (Shift for x10), PageUp/PageDown,
//   Home/End, or the mouse wheel. Release commits through `onCommit`. Hovering the
//   dial reads out the value at that angle. The gauge's own value is read-only.
// Only the primary button (or touch / pen) drags, and a key press never moves a
//   mark the opposite way. Each gauge has its own scale and step: uptime reads
//   99-100 % in 0.1 steps.
// Reduced motion: no easing, the needle jumps to the value.
import { Box, Typography, useTheme } from "@mui/material";
import { KeyboardEvent, PointerEvent, useEffect, useRef, useState } from "react";
import type { Gauge, Health } from "@/types/control";
import { serverNow } from "@/lib/clock";
import { HealthLabel, healthColor } from "@/components/common/Health";
import { DISPLAY_STACK, MONO_STACK } from "@/providers/MuiProvider";
import { arcPath, pointerAngle, polar, useReducedMotion } from "./arc";

const SIZE = 176;
const C = SIZE / 2;
const START = 135;
const SWEEP = 270;
const R_TICK = C - 14;
const R_ZONE = C - 30;
const R_SWEEP = C - 38;

type Kind = "warnAt" | "dangerAt";
export type Thresholds = { warnAt?: number; dangerAt?: number };

interface Scale {
  min: number;
  max: number;
  step: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * The useful range and step of a gauge. A "lower is worse" percentage that lives
 * near the top (uptime) gets a zoomed scale, 99-100 % by default, with 0.1 steps;
 * the scale widens only when the value or a saved threshold sits below it.
 * Built from the server's values, never from a draft, so it holds still while dragging.
 */
export function scaleFor(g: Gauge): Scale {
  if (g.unit === "%" && (g.direction ?? "up") === "down" && g.max === 100) {
    const lo = Math.min(g.value, g.warnAt ?? 100, g.dangerAt ?? 100);
    const min = lo >= 99 ? 99 : Math.max(0, Math.floor(lo) - 1);
    return { min, max: 100, step: 100 - min <= 10 ? 0.1 : 1 };
  }
  if (["%", "min", "jobs", "s", ""].includes(g.unit) && g.max >= 20) return { min: 0, max: g.max, step: 1 };
  return { min: 0, max: g.max, step: Math.max(0.1, Math.round((g.max / 100) * 10) / 10) };
}

const fracOf = (v: number, s: Scale) => clamp(s.max > s.min ? (v - s.min) / (s.max - s.min) : 0, 0, 1);
const angleOf = (v: number, s: Scale) => START + SWEEP * fracOf(v, s);

/** Fraction of the sweep under a polar angle; the gap at the bottom snaps to the nearer end. */
function fracAt(deg: number) {
  const rel = (deg - START + 360) % 360;
  if (rel <= SWEEP) return rel / SWEEP;
  return rel > SWEEP + (360 - SWEEP) / 2 ? 0 : 1;
}

function format(g: Gauge, v: number, sc: Scale) {
  const decimals = Math.max(sc.step < 1 ? 1 : 0, g.value % 1 !== 0 && g.max <= 100 ? 1 : 0);
  const n = v.toFixed(decimals);
  if (g.unit === "%") return `${n}%`;
  return g.unit ? `${n} ${g.unit}` : n;
}

// A live gauge's value is a function of the board clock: (t - since) x rate, up to cap
function liveTarget(g: Gauge, now: number) {
  if (!g.live) return g.value;
  const v = Math.max(0, (now - Date.parse(g.live.since)) / 1000) * g.live.ratePerSec;
  return Math.min(g.live.cap ?? Number.POSITIVE_INFINITY, v, g.max);
}

/** Bands where things are bad. "up" (default): high is bad; "down": low is bad. */
function bands(direction: "up" | "down", t: Thresholds, max: number, min = 0) {
  const out: { from: number; to: number; level: "warn" | "danger" }[] = [];
  const { warnAt: w, dangerAt: d } = t;
  if (direction === "up") {
    if (w !== undefined) out.push({ from: w, to: d ?? max, level: "warn" });
    if (d !== undefined) out.push({ from: d, to: max, level: "danger" });
  } else {
    if (w !== undefined) out.push({ from: d ?? min, to: w, level: "warn" });
    if (d !== undefined) out.push({ from: min, to: d, level: "danger" });
  }
  return out;
}

function ThresholdHandle({
  g,
  kind,
  value,
  scale,
  editable,
  reason,
  svgRef,
  onMove,
  onCommit,
}: {
  g: Gauge;
  kind: Kind;
  value: number;
  scale: Scale;
  editable: boolean;
  reason: string;
  svgRef: React.RefObject<SVGSVGElement | null>;
  /** `dir` is the direction a key or wheel asked for; drags pass 0. */
  onMove: (v: number, dir: -1 | 0 | 1) => void;
  onCommit: () => void;
}) {
  const theme = useTheme();
  const ref = useRef<SVGGElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const { step, min, max } = scale;
  const color = kind === "dangerAt" ? theme.palette.error.main : theme.palette.warning.main;
  const name = `${g.label} ${kind === "dangerAt" ? "danger" : "warning"} threshold`;
  const [hx, hy] = polar(C, C, R_ZONE, angleOf(value, scale));
  const snap = (v: number) => clamp(Math.round(v / step) * step, min, max);

  // Keyboard and wheel changes commit once the person pauses
  const commitSoon = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(onCommit, 600);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // The wheel adjusts only a focused handle, so page scrolling is never hijacked
  const latest = useRef({ value, editable, onMove, commitSoon, snap, step });
  useEffect(() => {
    latest.current = { value, editable, onMove, commitSoon, snap, step };
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      const l = latest.current;
      if (document.activeElement !== el || !l.editable) return;
      e.preventDefault();
      const dir = e.deltaY < 0 ? 1 : -1;
      l.onMove(l.snap(l.value + dir * l.step * (e.shiftKey ? 10 : 1)), dir);
      l.commitSoon();
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);

  const onKey = (e: KeyboardEvent) => {
    if (!editable) return;
    const big = e.shiftKey ? 10 : 1;
    const moves: Record<string, number> = { ArrowRight: step * big, ArrowUp: step * big, ArrowLeft: -step * big, ArrowDown: -step * big, PageUp: step * 10, PageDown: -step * 10 };
    let next: number | null = null;
    if (e.key in moves) next = value + moves[e.key];
    if (e.key === "Home") next = min;
    if (e.key === "End") next = max;
    if (next === null) return;
    e.preventDefault();
    onMove(snap(next), next > value ? 1 : next < value ? -1 : 0);
    commitSoon();
  };

  const onDown = (e: PointerEvent<SVGGElement>) => {
    if (!editable) return;
    // Only the primary button (or a touch / pen contact) starts a drag
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onDrag = (e: PointerEvent<SVGGElement>) => {
    if (!dragging || !svgRef.current) return;
    e.stopPropagation();
    onMove(snap(min + fracAt(pointerAngle(e, svgRef.current)) * (max - min)), 0);
  };
  const onUp = (e: PointerEvent<SVGGElement>) => {
    if (!dragging) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
    onCommit();
  };

  return (
    <g
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label={name}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={`${format(g, value, scale)}${editable ? "" : `. ${reason}`}`}
      aria-disabled={!editable || undefined}
      onKeyDown={onKey}
      onPointerDown={onDown}
      onPointerMove={onDrag}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      className="knob-handle"
      style={{ cursor: editable ? (dragging ? "grabbing" : "grab") : "not-allowed", touchAction: "none", outline: "none" }}
    >
      <title>{editable ? `${name}: ${format(g, value, scale)}. Drag, or use the arrow keys.` : `${name}: ${format(g, value, scale)}. ${reason}`}</title>
      {/* generous invisible hit area: at least 44 px on a phone-sized dial */}
      <circle cx={hx} cy={hy} r={20} fill="transparent" />
      <circle className="knob-focus" cx={hx} cy={hy} r={11} fill="none" stroke="var(--focus-ring)" strokeWidth={2} opacity={0} />
      <circle cx={hx} cy={hy} r={dragging ? 8 : 6.5} fill={color} stroke="var(--ops-screen)" strokeWidth={2} />
    </g>
  );
}

export function Knob({
  g,
  editable,
  reason,
  onCommit,
}: {
  g: Gauge;
  editable: boolean;
  reason: string;
  /** Save new thresholds; resolve to an error message, or null when saved. */
  onCommit: (id: string, t: Thresholds) => Promise<string | null>;
}) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const svgRef = useRef<SVGSVGElement>(null);
  const needleRef = useRef<SVGGElement>(null);
  const sweepRef = useRef<SVGPathElement>(null);
  const textRef = useRef<SVGTextElement>(null);
  const shown = useRef(g.value);
  const [draft, setDraft] = useState<Thresholds | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hoverV, setHoverV] = useState<number | null>(null);
  // Debounced commits run later; they must read the newest draft, not the one from when they were scheduled
  const draftRef = useRef<Thresholds | null>(null);
  useEffect(() => {
    draftRef.current = draft;
  });

  const scale = scaleFor(g);
  const t: Thresholds = { warnAt: draft?.warnAt ?? g.warnAt, dangerAt: draft?.dangerAt ?? g.dangerAt };
  const direction = g.direction ?? "up";
  // Once the board reports the saved values, the draft has done its job
  if (draft && !saving && t.warnAt === g.warnAt && t.dangerAt === g.dangerAt && (draft.warnAt === undefined || draft.warnAt === g.warnAt) && (draft.dangerAt === undefined || draft.dangerAt === g.dangerAt)) setDraft(null);

  // Health as the dial sees it, so a dragged threshold recolours at once
  const h: Health = (() => {
    if (g.health === "unknown") return "unknown";
    const v = liveTarget(g, serverNow());
    const past = (x?: number) => x !== undefined && (direction === "up" ? v >= x : v <= x);
    return past(t.dangerAt) ? "down" : past(t.warnAt) ? "warn" : draft ? "ok" : g.health;
  })();
  const color = healthColor(theme, h);

  // Ease the needle, sweep and readout toward the (possibly moving) target
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const sc = scaleFor(g);
    const eps = Math.max((sc.max - sc.min) * 0.0004, 0.001);
    const paint = (v: number) => {
      const deg = -135 + SWEEP * fracOf(v, sc);
      needleRef.current?.setAttribute("transform", `rotate(${deg.toFixed(2)} ${C} ${C})`);
      sweepRef.current?.setAttribute("stroke-dasharray", `${(fracOf(v, sc) * 100).toFixed(2)} 100`);
      if (textRef.current) textRef.current.textContent = !g.live && Math.abs(v - g.value) < eps ? g.display : format(g, v, sc);
    };
    const tick = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      const target = liveTarget(g, serverNow());
      const cur = shown.current;
      const next = reduced || Math.abs(target - cur) < eps ? target : cur + (target - cur) * (1 - Math.exp(-dt / 110));
      shown.current = next;
      paint(next);
      if (g.live || next !== target) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [g, reduced]);

  const move = (kind: Kind) => (v: number, dir: -1 | 0 | 1) => {
    const s = scale.step;
    const current = t[kind];
    // Keep warning before danger in the direction things get worse
    let next = v;
    if (kind === "warnAt" && t.dangerAt !== undefined) next = direction === "up" ? Math.min(v, t.dangerAt - s) : Math.max(v, t.dangerAt + s);
    if (kind === "dangerAt" && t.warnAt !== undefined) next = direction === "up" ? Math.max(v, t.warnAt + s) : Math.min(v, t.warnAt - s);
    next = clamp(Math.round(next * 1000) / 1000, scale.min, scale.max);
    // A key asked for one direction: never go the other way, stay put instead
    if (current !== undefined && dir !== 0 && Math.sign(next - current) === -dir) next = current;
    setErr(null);
    setDraft((d) => ({ ...d, [kind]: next }));
  };

  const commit = (kind: Kind) => async () => {
    const v = draftRef.current?.[kind];
    if (v === undefined || v === g[kind]) return;
    setSaving(true);
    const message = await onCommit(g.id, { [kind]: v });
    setSaving(false);
    if (message) {
      setDraft(null); // back to the saved value
      setErr(message);
    }
  };

  const onHover = (e: PointerEvent<SVGSVGElement>) => {
    if (e.buttons) return; // a drag is under way
    const r = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const inside = Math.hypot(dx, dy) < (r.width / 2) * 0.98;
    setHoverV(inside ? scale.min + fracAt(pointerAngle(e, e.currentTarget)) * (scale.max - scale.min) : null);
  };

  const dim = theme.palette.text.secondary;
  const ticks = Array.from({ length: 51 }, (_, i) => i);

  return (
    <Box sx={{ textAlign: "center", minWidth: 0 }}>
      <Box
        component="svg"
        ref={svgRef}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        onPointerMove={onHover}
        onPointerLeave={() => setHoverV(null)}
        aria-label={`${g.label}: ${g.display}. ${g.hint}`}
        role="group"
        sx={{ width: "100%", maxWidth: { xs: SIZE, lg: 152 }, display: "block", mx: "auto", overflow: "visible", "& .knob-handle:focus-visible .knob-focus": { opacity: 1 } }}
      >
        <circle cx={C} cy={C} r={C - 2} fill="var(--ops-raised)" stroke="var(--ops-bezel)" strokeWidth={1.5} />
        <circle cx={C} cy={C} r={C - 9} fill="var(--ops-screen)" stroke="var(--ops-line)" />
        {ticks.map((i) => {
          const major = i % 5 === 0;
          const deg = START + (SWEEP * i) / 50;
          const [x1, y1] = polar(C, C, R_TICK, deg);
          const [x2, y2] = polar(C, C, R_TICK - (major ? 9 : 5), deg);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={dim} strokeOpacity={major ? 0.9 : 0.45} strokeWidth={major ? 1.4 : 0.8} />;
        })}
        {bands(direction, t, scale.max, scale.min).map((b, i) => (
          <path key={i} d={arcPath(C, C, R_ZONE, angleOf(b.from, scale), angleOf(b.to, scale))} fill="none" stroke={b.level === "danger" ? theme.palette.error.main : theme.palette.warning.main} strokeWidth={4} strokeOpacity={0.8} />
        ))}
        <path d={arcPath(C, C, R_SWEEP, START, START + SWEEP)} fill="none" stroke="var(--ops-line)" strokeWidth={3} />
        <path ref={sweepRef} d={arcPath(C, C, R_SWEEP, START, START + SWEEP)} fill="none" stroke={color} strokeWidth={3} pathLength={100} strokeDasharray="0 100" />
        <g ref={needleRef} transform={`rotate(-135 ${C} ${C})`}>
          <line x1={C} y1={C + 10} x2={C} y2={22} stroke={theme.palette.text.primary} strokeWidth={2} strokeLinecap="round" />
          <circle cx={C} cy={C} r={6} fill="var(--ops-bezel)" stroke={theme.palette.text.primary} strokeWidth={1.5} />
        </g>
        {/* the readout window sits in the dial's lower gap, clear of the needle's usual path */}
        <rect x={C - 34} y={C + 30} width={68} height={24} rx={2} fill="var(--ops-raised)" stroke="var(--ops-line)" />
        <text ref={textRef} x={C} y={C + 48} textAnchor="middle" fill={theme.palette.text.primary} style={{ fontFamily: DISPLAY_STACK, fontSize: 18, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
          {g.display}
        </text>
        {/* reading at the pointer's angle, in the gap at the bottom of the dial */}
        {hoverV !== null ? (
          <text x={C} y={C - 20} textAnchor="middle" fill={theme.palette.primary.main} style={{ fontFamily: MONO_STACK, fontSize: 11, fontWeight: 600 }}>
            {`AT ${format(g, Math.round(hoverV / scale.step) * scale.step, scale)}`}
          </text>
        ) : null}
        {(["warnAt", "dangerAt"] as Kind[]).map((k) =>
          t[k] !== undefined ? <ThresholdHandle key={k} g={g} kind={k} value={t[k]!} scale={scale} editable={editable && !saving} reason={reason} svgRef={svgRef} onMove={move(k)} onCommit={commit(k)} /> : null
        )}
      </Box>
      <Typography
        component="p"
        sx={{
          mt: 0.5,
          fontFamily: DISPLAY_STACK,
          fontWeight: 700,
          fontSize: "0.75rem",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "text.secondary",
          textShadow: (th) => (th.palette.mode === "dark" ? "0 1px 0 rgba(0,0,0,0.9), 0 -1px 0 rgba(255,255,255,0.05)" : "0 1px 0 #FFFFFF"),
        }}
      >
        {g.label}
      </Typography>
      <Box sx={{ mt: 0.25 }}>
        <HealthLabel health={h} size="caption" label={h === "ok" ? "Nominal" : undefined} />
      </Box>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.25, lineHeight: 1.35, px: 0.5 }}>
        {saving ? "Saving threshold…" : g.hint}
      </Typography>
      {err ? (
        <Typography role="alert" variant="caption" component="p" sx={{ color: "error.main", fontWeight: 600, mt: 0.25 }}>
          {err}
        </Typography>
      ) : null}
    </Box>
  );
}
