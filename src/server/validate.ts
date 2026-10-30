// Input checks for query strings and bodies. Each throws a 400 with a plain message.
import type { LogLevel, Severity, SystemId } from "@/types/control";
import { SYSTEM_IDS } from "@/data/systems";
import { badRequest } from "./http";

export const LOG_LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];
export const SEVERITIES: Severity[] = ["critical", "warning", "info"];

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], name: string): T {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T;
  throw badRequest(`${name} must be one of: ${allowed.join(", ")}.`);
}

export function optionalOneOf<T extends string>(value: string | null, allowed: readonly T[], name: string): T | undefined {
  if (value === null || value === "") return undefined;
  return oneOf(value, allowed, name);
}

export function isSystemId(v: unknown): v is SystemId {
  return typeof v === "string" && (SYSTEM_IDS as string[]).includes(v);
}

export function systemList(value: unknown, name: string): SystemId[] {
  const items = typeof value === "string" ? value.split(",").map((s) => s.trim()).filter(Boolean) : value;
  if (!Array.isArray(items)) throw badRequest(`${name} must be a list of system ids.`);
  const bad = items.filter((s) => !isSystemId(s));
  if (bad.length) throw badRequest(`Unknown system: ${bad.join(", ")}. Known systems: ${SYSTEM_IDS.join(", ")}.`);
  return items as SystemId[];
}

export function text(value: unknown, name: string, max: number, { required = false } = {}): string | undefined {
  if (value === undefined || value === null) {
    if (required) throw badRequest(`${name} is required.`);
    return undefined;
  }
  if (typeof value !== "string") throw badRequest(`${name} must be text.`);
  const trimmed = value.trim();
  if (required && !trimmed) throw badRequest(`${name} cannot be empty.`);
  if (trimmed.length > max) throw badRequest(`${name} is too long (max ${max} characters).`);
  return trimmed;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function dateParam(value: string | null, fallback: string): string {
  if (value === null || value === "") return fallback;
  const d = new Date(`${value}T00:00:00Z`);
  if (!DATE_RE.test(value) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw badRequest("date must look like YYYY-MM-DD, for example 2026-10-27.");
  }
  return value;
}

// A full ISO time with an offset or Z, e.g. 2026-10-27T11:40:00+05:30.
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

// from/to take YYYY-MM-DD or a full ISO time. A bare date means the start of that day IST,
// or its end when it is the upper bound (to=2026-10-27 includes all of the 27th).
export function isoParam(value: string | null, name: string, edge: "start" | "end" = "start"): number | undefined {
  if (value === null || value === "") return undefined;
  if (DATE_RE.test(value)) {
    dateParam(value, value);
    return Date.parse(`${value}T${edge === "end" ? "23:59:59.999" : "00:00:00"}+05:30`);
  }
  const t = ISO_RE.test(value) ? Date.parse(value) : NaN;
  if (Number.isNaN(t)) throw badRequest(`${name} must be YYYY-MM-DD or a full ISO time, for example 2026-10-27T11:40:00+05:30.`);
  return t;
}

// Text that must stay on one line (titles, follow-ups): no newlines or other control characters.
export function singleLine(value: unknown, name: string, max: number, opts: { required?: boolean } = {}): string | undefined {
  const t = text(value, name, max, opts);
  if (t !== undefined && /[\u0000-\u001f\u007f]/.test(t)) throw badRequest(`${name} must be one line with no control characters.`);
  return t;
}

export function intParam(value: string | null, name: string, min: number, max: number, fallback: number): number {
  if (value === null || value === "") return fallback;
  if (!/^\d+$/.test(value)) throw badRequest(`${name} must be a whole number.`);
  const n = Number(value);
  if (n < min || n > max) throw badRequest(`${name} must be between ${min} and ${max}.`);
  return n;
}
