import type { CodeChange } from "@/types/control";
import { CHANGES } from "@/data/changes";
import { badRequest } from "./http";
import { intParam, isSystemId } from "./validate";

export function listChanges(params: URLSearchParams): CodeChange[] {
  const system = params.get("system") || undefined;
  if (system && system !== "sentry" && !isSystemId(system)) {
    throw badRequest(`Unknown system: ${system}. Use a system id or "sentry".`);
  }
  const limit = intParam(params.get("limit"), "limit", 1, 200, 50);
  return CHANGES.filter((c) => !system || c.system === system).slice(0, limit);
}

// The newest change made at or before this time.
export function latestChange(atMs: number): CodeChange | null {
  return CHANGES.find((c) => Date.parse(c.at) <= atMs) ?? null;
}
