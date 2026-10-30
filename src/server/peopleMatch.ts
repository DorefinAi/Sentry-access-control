// Joins the two backends' people into one row per person (contract section 1). Pure: no I/O, so
// it is tested directly in people.test.ts.
//
// One person = one row when either holds (case-insensitive, trimmed):
//   1. Samvadia email == Socia email, or
//   2. Samvadia username == the local part of the Socia email (before "@").
// Email matches are made first across everyone, so a username match can never take a Socia
// account that someone else matches by email. A username that fits more than one remaining Socia
// account (same local part, different domains) is not matched; the near-match hints show it.
import type { HistoryEntry, NearMatch, OwnerUser, PersonRow } from "@/types/people";
import { byNewest, timeKey } from "@/lib/people";

export { timeKey };

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const localPart = (email: string | null) => {
  const e = norm(email);
  const at = e.lastIndexOf("@");
  return at > 0 ? e.slice(0, at) : "";
};

function row(samvadia: OwnerUser | null, socia: OwnerUser | null): PersonRow {
  const main = samvadia ?? socia!;
  return {
    key: `${samvadia ? `d-${samvadia.id}` : ""}${samvadia && socia ? "~" : ""}${socia ? `s-${socia.id}` : ""}`,
    name: samvadia?.name || socia?.name || main.id,
    username: samvadia?.username ?? null,
    email: samvadia?.email || socia?.email || null,
    samvadia,
    socia,
  };
}

export function matchPeople(samvadia: OwnerUser[], socia: OwnerUser[]): PersonRow[] {
  const pairOf = new Map<string, OwnerUser>(); // samvadia id -> socia user
  const taken = new Set<string>(); // socia ids already in a row

  const byEmail = new Map<string, OwnerUser[]>();
  for (const s of socia) {
    const e = norm(s.email);
    if (e) byEmail.set(e, [...(byEmail.get(e) ?? []), s]);
  }
  for (const d of samvadia) {
    const e = norm(d.email);
    const hit = e ? byEmail.get(e)?.find((s) => !taken.has(s.id)) : undefined;
    if (hit) {
      pairOf.set(d.id, hit);
      taken.add(hit.id);
    }
  }

  for (const d of samvadia) {
    if (pairOf.has(d.id)) continue;
    const u = norm(d.username);
    if (!u) continue;
    const fits = socia.filter((s) => !taken.has(s.id) && localPart(s.email) === u);
    if (fits.length === 1) {
      pairOf.set(d.id, fits[0]);
      taken.add(fits[0].id);
    }
  }

  const rows = [...samvadia.map((d) => row(d, pairOf.get(d.id) ?? null)), ...socia.filter((s) => !taken.has(s.id)).map((s) => row(null, s))];
  return rows.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || a.key.localeCompare(b.key));
}

// ─── Near matches ───────────────────────────────────────────────────────────

/** Lower case, letters and digits only, words sorted: "Sharma, Ravi K." -> "k ravi sharma". */
export function nameKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .sort()
    .join(" ");
}

function distance(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** 0..1, how alike two names are once case, punctuation and word order are ignored. */
export function nameSimilarity(a: string, b: string): number {
  const x = nameKey(a);
  const y = nameKey(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  return 1 - distance(x, y) / Math.max(x.length, y.length);
}

const NEAR = 0.8;
const MAX_HINTS_PER_ROW = 3;

/**
 * Hints for rows that did not join: an Assignment-desk-only row and a Socia-only row whose names
 * look alike, or whose sign-in names do (username vs email local part, minus dots and digits).
 */
export function nearMatches(rows: PersonRow[]): NearMatch[] {
  const desk = rows.filter((r) => r.samvadia && !r.socia);
  const soc = rows.filter((r) => r.socia && !r.samvadia);
  const out: (NearMatch & { score: number })[] = [];
  const loose = (s: string) => s.replace(/[^a-z]/g, "");
  for (const a of desk) {
    for (const b of soc) {
      const byName = nameSimilarity(a.samvadia!.name, b.socia!.name);
      const user = loose(norm(a.samvadia!.username));
      const local = loose(localPart(b.socia!.email));
      const byLogin = user.length >= 3 && user === local;
      if (byName >= NEAR) out.push({ a: a.key, b: b.key, why: byName === 1 ? "Same name" : "Very similar names", score: byName });
      else if (byLogin) out.push({ a: a.key, b: b.key, why: "Similar sign-in names", score: 0.79 });
    }
  }
  out.sort((x, y) => y.score - x.score);
  const used = new Map<string, number>();
  const kept: NearMatch[] = [];
  for (const { a, b, why } of out) {
    if ((used.get(a) ?? 0) >= MAX_HINTS_PER_ROW || (used.get(b) ?? 0) >= MAX_HINTS_PER_ROW) continue;
    used.set(a, (used.get(a) ?? 0) + 1);
    used.set(b, (used.get(b) ?? 0) + 1);
    kept.push({ a, b, why });
  }
  return kept;
}

// ─── History ────────────────────────────────────────────────────────────────

/** Both systems' entries, newest first, cut to `limit`; ties keep a stable order. */
export function mergeHistory(lists: HistoryEntry[][], limit: number): HistoryEntry[] {
  return lists.flat().toSorted(byNewest).slice(0, limit);
}
