// Geometry and motion helpers shared by the gauge knobs and the replay jog wheel.
import { useEffect, useState } from "react";

/** Point on a circle; degrees are polar, clockwise from +x (SVG y points down). */
export function polar(cx: number, cy: number, r: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
}

export function arcPath(cx: number, cy: number, r: number, fromDeg: number, toDeg: number) {
  if (toDeg - fromDeg < 0.05) return "";
  const [x1, y1] = polar(cx, cy, r, fromDeg);
  const [x2, y2] = polar(cx, cy, r, toDeg);
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${toDeg - fromDeg > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

/** Polar angle (0..360) of a pointer event relative to an element's centre. */
export function pointerAngle(e: { clientX: number; clientY: number }, el: Element) {
  const r = el.getBoundingClientRect();
  const deg = (Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) / Math.PI;
  return (deg + 360) % 360;
}

export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Live prefers-reduced-motion. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read the user's setting after hydration
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}
