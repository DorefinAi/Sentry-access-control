// Counts for a day, derived from the story list so every screen agrees.
// statsAt() cuts every story at a moment, which is what the replay board uses.
import { STORIES, type Story } from "./stories";
import { dateOf, minutesBetween, ms, NOW, TODAY } from "./time";
import { OCTOPUS_GAP, X_CAP } from "./world";

export interface DayStats {
  storiesIn: number;
  bySource: { portal: number; outlook: number; whatsapp: number };
  approved: number;
  rejected: number;
  waitingDesk: number;
  inFeed: number;
  collected: number;
  delayedByOctopus: number;
  ftpFailedFiles: number;
  uploading: number;
  ingested: number;
  skipped: number;
  drafts: number;
  renderFailed: number;
  waitingOperator: number;
  operatorRejected: number;
  xPosts: number;
  xRecalled: number;
  medianMinutesToFeed: number | null;
}

export function storiesOn(date: string): Story[] {
  return STORIES.filter((s) => dateOf(s.receivedAt) === date);
}

// A story as it stood at `at`: anything that happened later is not known yet.
export function storyAt(s: Story, at: string): Story | null {
  const t = ms(at);
  const done = (iso?: string) => !!iso && ms(iso) <= t;
  if (!done(s.receivedAt)) return null;
  const out: Story = { ...s };

  if (!done(s.deskAt)) {
    return { ...out, desk: "waiting", deskAt: undefined, deskBy: undefined, rejectReason: undefined, ftp: undefined, ftpAt: undefined, ftpAttempts: undefined, feedAt: undefined, collectedAt: undefined, digital: undefined, ingestAt: undefined, renderAt: undefined, renderAttempts: undefined, operatorAt: undefined, operator: undefined, postedAt: undefined, xPostId: undefined, recalledAt: undefined };
  }
  if (s.ftpAttempts) {
    out.ftpAttempts = s.ftpAttempts.filter(done);
    // Still retrying until the last attempt has happened.
    if (out.ftpAttempts.length < s.ftpAttempts.length) out.ftp = "uploading";
  }
  if (s.ftp === "done" && !done(s.ftpAt)) {
    out.ftp = "uploading";
    out.ftpAt = undefined;
  }
  if (!done(s.feedAt)) out.feedAt = undefined;
  if (!done(s.collectedAt)) out.collectedAt = undefined;
  if (!done(s.ingestAt)) {
    return { ...out, digital: undefined, ingestAt: undefined, renderAt: undefined, renderAttempts: undefined, operatorAt: undefined, operator: undefined, postedAt: undefined, xPostId: undefined, recalledAt: undefined };
  }
  if (s.renderAttempts) {
    out.renderAttempts = s.renderAttempts.filter(done);
    if (out.renderAttempts.length < s.renderAttempts.length) out.digital = undefined; // still rendering
  }
  if (s.renderAt && !done(s.renderAt)) {
    out.renderAt = undefined;
    out.digital = undefined;
  }
  if (out.digital && out.digital !== "skipped" && out.digital !== "render_failed") {
    if (!done(s.operatorAt)) {
      out.operatorAt = undefined;
      out.digital = "waiting_operator";
    }
    if (!done(s.postedAt)) {
      out.postedAt = undefined;
      if (out.digital !== "operator_rejected") out.digital = "waiting_operator";
    }
    if (s.recalledAt && !done(s.recalledAt)) {
      out.recalledAt = undefined;
      out.digital = "posted";
    }
  }
  return out;
}

export function storiesAt(at: string, date: string = TODAY): Story[] {
  return storiesOn(date)
    .map((s) => storyAt(s, at))
    .filter((s): s is Story => !!s);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function statsFor(list: Story[]): DayStats {
  const count = (fn: (s: Story) => boolean) => list.filter(fn).length;
  const gapFrom = ms(OCTOPUS_GAP.lastPollBefore);
  const gapTo = ms(OCTOPUS_GAP.resumedAt);
  return {
    storiesIn: list.length,
    bySource: {
      portal: count((s) => s.source === "portal"),
      outlook: count((s) => s.source === "outlook"),
      whatsapp: count((s) => s.source === "whatsapp"),
    },
    approved: count((s) => s.desk === "approved"),
    rejected: count((s) => s.desk === "rejected"),
    waitingDesk: count((s) => s.desk === "waiting"),
    inFeed: count((s) => !!s.feedAt),
    collected: count((s) => !!s.collectedAt),
    delayedByOctopus: count((s) => !!s.feedAt && ms(s.feedAt) > gapFrom && ms(s.feedAt) < gapTo),
    ftpFailedFiles: list.reduce((n, s) => n + (s.ftp === "failed" ? (s.oversize?.length ?? 0) : 0), 0),
    uploading: count((s) => s.ftp === "uploading"),
    ingested: count((s) => !!s.ingestAt),
    skipped: count((s) => s.digital === "skipped"),
    drafts: count((s) => !!s.ingestAt && s.digital !== "skipped"),
    renderFailed: count((s) => s.digital === "render_failed"),
    waitingOperator: count((s) => s.digital === "waiting_operator"),
    operatorRejected: count((s) => s.digital === "operator_rejected"),
    xPosts: count((s) => !!s.postedAt),
    xRecalled: count((s) => !!s.recalledAt),
    medianMinutesToFeed: median(list.filter((s) => s.feedAt).map((s) => minutesBetween(s.receivedAt, s.feedAt!))),
  };
}

export function dayStats(date: string = TODAY): DayStats {
  return statsFor(storiesOn(date));
}

export function statsAt(at: string): DayStats {
  return statsFor(storiesAt(at));
}

export interface XCap {
  limit: number;
  media: number;
  deletes: number;
  posts: number;
  used: number;
  pct: number;
}

// Writes so far: posts, their media uploads (in proportion), and deletes for recalls.
export function xCapAt(at: string = NOW): XCap {
  const all = dayStats(TODAY);
  const s = statsAt(at);
  const media = all.xPosts ? Math.round((X_CAP.media * s.xPosts) / all.xPosts) : 0;
  const deletes = Math.min(X_CAP.deletes, s.xRecalled);
  const used = s.xPosts + media + deletes;
  return { limit: X_CAP.limit, media, deletes, posts: s.xPosts, used, pct: Math.round((used / X_CAP.limit) * 100) };
}

export function xCap(): XCap {
  return xCapAt(NOW);
}

export function waitingMinutes(s: Story, now: string = NOW): number {
  return minutesBetween(s.receivedAt, now);
}
