// Code changes from the real git history of each repo (read-only `git log`), newest first.
// Repos are found under SENTRY_REPOS_ROOT (default: the folder above this app). A folder that is
// missing or not a git repo is skipped. Refreshed every 5 min by monitor.ts, and on demand when
// the list is older than that.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type { CodeChange, SystemId } from "@/types/control";
import { badRequest } from "./http";
import { nowMs } from "./time";
import { intParam, isSystemId } from "./validate";

const PER_REPO = 60;
const STALE_MS = 300_000;

export const REPOS: { dir: string; system: SystemId | "sentry" }[] = [
  { dir: "samvadia/backend", system: "samvadia-api" },
  { dir: "samvadia/frontend", system: "assignment-desk" },
  { dir: "samvadia/reporterportal", system: "reporter-portal" },
  { dir: "digital/backend", system: "socia-api" },
  { dir: "digital/frontend", system: "digital-desk" },
  { dir: "sentry", system: "sentry" },
];

const reposRoot = () => process.env.SENTRY_REPOS_ROOT?.trim() || path.resolve(process.cwd(), "..");

interface Cache {
  at: number;
  changes: CodeChange[];
  refreshing: Promise<void> | null;
}
const g = globalThis as typeof globalThis & { __sentryChanges?: Cache };
const cache = () => (g.__sentryChanges ??= { at: 0, changes: [], refreshing: null });

/** Parses `git log --name-only` output in the format gitLog() asks for. */
export function parseGitLog(out: string, repo: string, system: SystemId | "sentry"): CodeChange[] {
  return out
    .split("\x1e")
    .map((rec) => rec.trim())
    .filter(Boolean)
    .map((rec) => {
      const [head, ...rest] = rec.split("\n");
      const [sha, author, at, ...subject] = head.split("\x1f");
      const files = rest.map((l) => l.trim()).filter(Boolean);
      return {
        id: `${repo}@${sha.slice(0, 12)}`,
        system,
        repo,
        at,
        author,
        summary: subject.join("\x1f").slice(0, 200),
        ref: sha,
        files: files.slice(0, 10),
        source: "git" as const,
      };
    })
    .filter((c) => /^[0-9a-f]{7,40}$/.test(c.ref ?? "") && !Number.isNaN(Date.parse(c.at)));
}

function gitLog(dir: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", dir, "log", `-n${PER_REPO}`, "--date=iso-strict", "--pretty=format:%x1e%H%x1f%an%x1f%aI%x1f%s", "--name-only"],
      { timeout: 10_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => resolve(err ? null : stdout),
    );
  });
}

export async function refreshChanges(): Promise<void> {
  const c = cache();
  if (c.refreshing) return c.refreshing;
  c.refreshing = (async () => {
    const root = reposRoot();
    const all: CodeChange[] = [];
    for (const r of REPOS) {
      const dir = path.join(root, r.dir);
      if (!existsSync(path.join(dir, ".git"))) continue;
      const out = await gitLog(dir);
      if (out !== null) all.push(...parseGitLog(out, r.dir, r.system));
      else {
        // Keep what this repo had last time rather than dropping it from the list
        console.error(`[changes] git log failed in ${r.dir}; keeping its previous entries`);
        all.push(...c.changes.filter((x) => x.repo === r.dir));
      }
    }
    c.changes = all.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    c.at = nowMs();
  })().finally(() => {
    c.refreshing = null;
  });
  return c.refreshing;
}

export async function listChanges(params: URLSearchParams): Promise<CodeChange[]> {
  const system = params.get("system") || undefined;
  if (system && system !== "sentry" && !isSystemId(system)) {
    throw badRequest(`Unknown system: ${system}. Use a system id or "sentry".`);
  }
  const limit = intParam(params.get("limit"), "limit", 1, 200, 50);
  if (nowMs() - cache().at > STALE_MS) await refreshChanges();
  return cache()
    .changes.filter((c) => !system || c.system === system)
    .slice(0, limit);
}

/** The newest change made at or before this time (from the last refresh). */
export function latestChange(atMs: number): CodeChange | null {
  return cache().changes.find((c) => Date.parse(c.at) <= atMs) ?? null;
}
