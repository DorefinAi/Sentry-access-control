// Every response that carries evidence goes through here: unknown kinds are dropped and
// repeats (same kind and id) are removed, keeping the first label.
import type { Evidence } from "@/types/control";

const KINDS: Evidence["kind"][] = ["alert", "log", "system", "trace", "incident", "login"];

export function cleanEvidence(list: Evidence[] | undefined): Evidence[] {
  const seen = new Set<string>();
  const out: Evidence[] = [];
  for (const e of list ?? []) {
    if (!e || !KINDS.includes(e.kind) || typeof e.id !== "string" || !e.id) continue;
    const key = `${e.kind}:${e.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: e.kind, id: e.id, label: typeof e.label === "string" && e.label ? e.label : e.id });
  }
  return out;
}
