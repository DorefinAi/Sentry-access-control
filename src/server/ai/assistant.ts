// The "Ask" panel. It matches the question to an intent and answers from the same live server
// functions the screens use (no AI yet). A QwenAssistant (Ollama tool calling) can implement the
// same interface later.
import type { ChatMessage, ChatRequest, ChatResponse, Evidence } from "@/types/control";
import { listAlerts } from "../alerts";
import { cleanEvidence } from "../evidence";
import { listFixes } from "../fixes";
import { badRequest, HttpError } from "../http";
import { getIncident, listIncidents } from "../incidents";
import { loginReport } from "../logins";
import { dailyReport } from "../reports";
import { liveMoment } from "../moment";
import { hhmm, istDate, todayIst } from "../time";
import { getTrace } from "../trace";
import { isRecord, text } from "../validate";
import { STATIC_MODEL } from "./summary";
import { verifyNumbers, type Facts } from "./verifyNumbers";

export interface Assistant {
  reply(req: ChatRequest): Promise<ChatResponse>;
}

interface Answer {
  text: string;
  evidence: Evidence[];
  suggestions: string[];
  facts: Facts; // what the numbers in text are checked against
  unverified?: string[]; // set when the text is an AiSummary that was already checked
}

const SLUG_RE = /\b\d{6}_[A-Z0-9]+(?:_[A-Z0-9]+)+\b/i;
const TRACE_WORDS = /\b(where|kahan|kaha|slug|trace)\b/i;

type Topic = "octopus" | "ftp" | "x" | "logins" | "fix" | "broke" | "daily";

// Order matters: specific topics before the broad "what broke / today" ones.
const TOPICS: [Topic, RegExp][] = [
  ["octopus", /\boctopus\b/i],
  ["ftp", /\b(ftp|upload|uploads|ajmer)\b/i],
  ["x", /\b(x|twitter|tweets?|post(s|ed)?|cap)\b/i],
  ["logins", /\b(login|logins|logged|kaun|who|session)\b/i],
  ["fix", /\b(fix|pehle|first|priority|should i)\b/i],
  ["broke", /\b(broke|broken|toota|tuta|issue|issues|problem|wrong|alert|alerts|error|errors|fail|failed|failure|kya hua)\b/i],
  ["daily", /\b(daily|report|aaj|today|summary|din)\b/i],
];

type Intent = Topic | "trace" | "help";

// "Where" only means a trace when there is a slug to trace; otherwise topics win
// ("where is octopus at?"), and a bare "slug kahan hai" asks for the slug.
export function detectIntent(message: string, slugInContext?: string): { intent: Intent; slug?: string } {
  const slug = message.match(SLUG_RE)?.[0];
  if (slug) return { intent: "trace", slug: slug.toUpperCase() };
  const asksWhere = TRACE_WORDS.test(message);
  if (asksWhere && slugInContext) return { intent: "trace", slug: slugInContext };
  for (const [topic, re] of TOPICS) {
    if (re.test(message)) return { intent: topic };
  }
  return { intent: asksWhere ? "trace" : "help" };
}

const SUGGEST = {
  broke: "What broke today?",
  daily: "Daily report",
  logins: "Who logged in?",
  fix: "What should I fix first?",
  octopus: "Is Octopus polling?",
  ftp: "What is wrong with FTP?",
  x: "How is X doing?",
};

function suggestionsExcept(...skip: string[]): string[] {
  return Object.values(SUGGEST)
    .filter((s) => !skip.includes(s))
    .slice(0, 3);
}

function broke(): Answer {
  const live = listAlerts().filter((a) => a.state !== "resolved");
  const incidents = listIncidents().filter((i) => istDate(i.openedAt) === todayIst());
  const lines = live.length
    ? live.map((a) => `- **${a.severity}** ${a.title}${a.state === "acked" ? " (acked)" : ""}`)
    : ["- Nothing open right now."];
  const done = incidents.filter((i) => i.status === "resolved");
  return {
    text: [
      `**${live.length} open or acked ${live.length === 1 ? "alert" : "alerts"}:**`,
      ...lines,
      ...(done.length ? ["", `Already fixed today: ${done.map((i) => `${i.id} (${i.title})`).join("; ")}.`] : []),
    ].join("\n"),
    evidence: [...live.map((a) => ({ kind: "alert" as const, id: a.id, label: a.title })), ...incidents.map((i) => ({ kind: "incident" as const, id: i.id, label: i.id }))],
    suggestions: [SUGGEST.fix, SUGGEST.daily, SUGGEST.ftp],
    facts: { values: { live: live.length }, quotable: [...live.map((a) => a.title), ...done.flatMap((i) => [i.id, i.title])] },
  };
}

function daily(): Answer {
  const r = dailyReport(todayIst());
  return {
    text: `${r.narrative.text}\n\nThe full report is under Reports.`,
    evidence: r.narrative.evidence,
    suggestions: suggestionsExcept(SUGGEST.daily),
    facts: {},
    unverified: r.narrative.unverifiedNumbers ?? [],
  };
}

async function logins(): Promise<Answer> {
  const r = await loginReport(todayIst());
  const shown = r.unusual.slice(0, 5);
  const unusual = shown.map((e) => `- ${hhmm(e.at)} **${e.user}** on ${e.app}: ${e.result.replace("_", " ")} (${e.flags.join(", ").replace(/_/g, " ")}) from ${e.ip}`);
  return {
    text: [
      `**${r.totals.success} logins, ${r.totals.failed} failed** today across the apps; ${r.totals.uniqueUsers} people, ${r.totals.activeSessions} sessions active now.`,
      ...(unusual.length ? ["", "Worth a look:", ...unusual] : []),
    ].join("\n"),
    evidence: shown.map((e) => ({ kind: "login" as const, id: e.id, label: `${e.user} ${hhmm(e.at)}` })),
    suggestions: suggestionsExcept(SUGGEST.logins),
    facts: { values: { totals: r.totals }, quotable: shown.flatMap((e) => [hhmm(e.at), e.ip, e.user]) },
  };
}

function fix(): Answer {
  const fixes = listFixes().slice(0, 3);
  if (!fixes.length) return { text: "Nothing to fix right now.", evidence: [], suggestions: suggestionsExcept(SUGGEST.fix), facts: {} };
  return {
    text: ["**Do these in order:**", ...fixes.map((f) => `${f.rank}. **${f.title}**: ${f.impact}.`), "", fixes[0].why].join("\n"),
    evidence: fixes.flatMap((f) => (f.alertId ? [{ kind: "alert" as const, id: f.alertId, label: f.title }] : f.evidence.slice(0, 1))),
    suggestions: [SUGGEST.broke, SUGGEST.ftp, SUGGEST.daily],
    // The fix texts are built from data by fixes.ts; here they are repeated verbatim.
    facts: { values: { ranks: fixes.map((f) => f.rank) }, quotable: [...fixes.flatMap((f) => [f.title, f.impact]), fixes[0].why] },
  };
}

async function trace(slug?: string): Promise<Answer> {
  if (!slug) {
    return {
      text: "Which story? Give me its slug (the story's folder name, like DDMMYY_CITY_SUBJECT), or search on the Trace screen.",
      evidence: [],
      suggestions: [SUGGEST.broke, SUGGEST.fix, SUGGEST.daily],
      facts: {},
    };
  }
  let t;
  try {
    t = await getTrace(slug);
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      return { text: `I cannot find a story with slug \`${slug}\`. Try the search on the Trace screen.`, evidence: [], suggestions: suggestionsExcept(), facts: { quotable: [slug] } };
    }
    if (err instanceof HttpError && err.status === 503) {
      return { text: err.message, evidence: [], suggestions: suggestionsExcept(), facts: { quotable: [err.message] } };
    }
    throw err;
  }
  const done = t.steps.filter((s) => s.state === "done");
  const last = done.at(-1);
  const problem = t.steps.find((s) => s.state === "failed") ?? t.steps.find((s) => s.state === "waiting");
  const stateWord = { done: "done", on_track: "on track", stuck: "stuck", failed: "failed" }[t.state];
  const lines = [
    `**${t.slug}**: ${t.headline}`,
    `State: **${stateWord}**${t.stuckAt ? ` at ${t.stuckAt}` : ""}.`,
    ...(last ? [`- Last done: ${last.stage} at ${hhmm(last.at!)}${last.detail ? ` (${last.detail})` : ""}`] : []),
    ...(problem ? [`- ${problem.state === "failed" ? "Failed" : "Waiting"}: ${problem.stage}${problem.detail ? ` (${problem.detail})` : ""}`] : []),
  ];
  return {
    text: lines.join("\n"),
    evidence: [{ kind: "trace", id: t.slug, label: "Open the trace" }, ...(problem?.evidence ?? [])],
    suggestions: [SUGGEST.fix, SUGGEST.broke, SUGGEST.daily],
    facts: { quotable: [t.slug, t.headline, last?.at ? hhmm(last.at) : null, last?.detail, problem?.detail] },
  };
}

/** A Samvadia or Socia check as one plain line ("FTP: OK", "FTP failing: ..."), or why it is not known. */
function checkLine(source: "samvadia" | "socia", id: string): { text: string; ok: boolean | null } {
  const m = liveMoment();
  const summary = m.ops[source].summary;
  if (!summary) return { text: m.ops[source].problem ?? "No data.", ok: null };
  const c = summary.checks.find((x) => x.id === id);
  if (!c) return { text: `${source === "samvadia" ? "Samvadia" : "Socia"} does not report a ${id} check.`, ok: null };
  if (c.ok === null) return { text: `${c.label}: not checked yet.`, ok: null };
  const last = c.lastOkAt ? ` Last OK at ${hhmm(c.lastOkAt)}.` : "";
  return c.ok ? { text: `${c.label}: OK.${c.detail ? ` ${c.detail}.` : ""}${last}`, ok: true } : { text: `${c.label} failing${c.lastError ? `: ${c.lastError}` : ""}.${last}`, ok: false };
}

function octopus(): Answer {
  const m = liveMoment();
  const line = checkLine("samvadia", "octopus");
  const alerts = listAlerts().filter((a) => a.state !== "resolved" && a.systems.includes("octopus"));
  const latest = listIncidents().find((i) => i.systems.includes("octopus"));
  const inc = latest ? getIncident(latest.id) : null;
  const collected = m.ops.samvadia.summary?.flow.collected ?? null;
  const lines = [`**${line.ok === false ? "Octopus needs a look." : line.ok ? "Octopus is fetching the feed." : "Octopus status is not known."}** ${line.text}`];
  if (collected !== null) lines.push(`It has collected ${collected} stories today.`);
  if (alerts.length) lines.push(...alerts.map((a) => `- Open: ${a.title} (since ${hhmm(a.firedAt)})`));
  if (inc) lines.push(`${inc.status === "resolved" ? "Earlier" : "Open now"}: ${inc.id} (${inc.status}), ${inc.impact.summary}.`);
  return {
    text: lines.join("\n"),
    evidence: [{ kind: "system", id: "octopus", label: "Octopus" }, ...alerts.map((a) => ({ kind: "alert" as const, id: a.id, label: a.title })), ...(inc ? [{ kind: "incident" as const, id: inc.id, label: inc.id }] : [])],
    suggestions: suggestionsExcept(SUGGEST.octopus),
    facts: { values: { collected }, quotable: [line.text, ...alerts.flatMap((a) => [a.title, hhmm(a.firedAt)]), ...(inc ? [inc.id, inc.impact.summary] : [])] },
  };
}

function ftp(): Answer {
  const line = checkLine("samvadia", "ftp");
  const alert = listAlerts().find((a) => a.state !== "resolved" && a.systems.includes("ftp"));
  if (!alert) {
    return { text: `**${line.ok === false ? "FTP needs a look." : line.ok ? "FTP is fine." : "FTP status is not known."}** ${line.text}`, evidence: [{ kind: "system", id: "ftp", label: "FTP" }], suggestions: suggestionsExcept(SUGGEST.ftp), facts: { quotable: [line.text] } };
  }
  return {
    text: [`**${alert.title}.**`, alert.runbook.meaning, "", "Fix:", ...alert.runbook.fix.map((f) => `- ${f}`)].join("\n"),
    evidence: [{ kind: "alert", id: alert.id, label: alert.id }, ...alert.evidence],
    suggestions: [SUGGEST.fix, SUGGEST.broke, SUGGEST.daily],
    facts: { quotable: [alert.title, alert.runbook.meaning, ...alert.runbook.fix] },
  };
}

function x(): Answer {
  const m = liveMoment();
  const s = m.ops.socia.summary;
  if (!s) return { text: `**X: no numbers.** ${m.ops.socia.problem ?? "Socia is not connected."}`, evidence: [{ kind: "system", id: "x", label: "X" }], suggestions: suggestionsExcept(SUGGEST.x), facts: { quotable: [m.ops.socia.problem] } };
  const operator = s.stages.find((st) => st.id === "operator");
  const render = s.stages.find((st) => st.id === "render");
  return {
    text: [
      `**${s.flow.posts} posts marked on X today**, ${s.flow.recalled} recalled${s.phase === 1 ? " (phase 1: operators post by hand)" : ""}.`,
      `${operator ? `${operator.waiting} drafts wait for an operator. ` : ""}${render ? `${render.failed} cards failed to render today.` : ""}`.trim(),
    ]
      .filter(Boolean)
      .join("\n"),
    evidence: [{ kind: "system", id: "x", label: "X" }, { kind: "system", id: "socia-publish", label: "Socia publish" }],
    suggestions: suggestionsExcept(SUGGEST.x),
    facts: { values: { flow: s.flow, phase: s.phase, waiting: operator?.waiting, failed: render?.failed } },
  };
}

function help(): Answer {
  return {
    text: [
      "I can answer from today's data:",
      "- **What broke today?** (kya toota)",
      "- **Daily report** (aaj ka report)",
      "- **Who logged in?** (kaun aaya)",
      "- **What should I fix first?** (pehle kya karein)",
      "- **Where is slug …?** (slug kahan hai)",
      "- Octopus, FTP and X status",
    ].join("\n"),
    evidence: [],
    suggestions: [SUGGEST.broke, SUGGEST.fix, SUGGEST.daily],
    facts: {},
  };
}

const KEEP_MESSAGES = 20;
const MAX_TEXT = 2000;

// Long conversations are fine: only the last 20 messages are kept. The user's own messages must fit
// the 2000-character cap; the assistant's earlier answers are shortened instead of rejected.
export function parseChatRequest(body: unknown): ChatRequest {
  if (!isRecord(body) || !Array.isArray(body.messages) || !body.messages.length) {
    throw badRequest('Send {"messages": [{"role": "user", "text": "What broke today?"}]}.');
  }
  const offset = Math.max(0, body.messages.length - KEEP_MESSAGES);
  const messages = body.messages.slice(offset).map((m, n): ChatMessage => {
    const i = offset + n;
    if (!isRecord(m) || (m.role !== "user" && m.role !== "assistant")) throw badRequest(`messages[${i}].role must be user or assistant.`);
    if (m.role === "assistant") {
      if (typeof m.text !== "string") throw badRequest(`messages[${i}].text must be text.`);
      return { role: "assistant", text: m.text.slice(0, MAX_TEXT) };
    }
    return { role: "user", text: text(m.text, `messages[${i}].text`, MAX_TEXT, { required: true })! };
  });
  if (messages.at(-1)!.role !== "user") throw badRequest("The last message must be from the user.");
  let context: ChatRequest["context"];
  if (body.context !== undefined) {
    if (!isRecord(body.context)) throw badRequest("context must be an object.");
    context = {
      screen: text(body.context.screen, "context.screen", 100),
      slug: text(body.context.slug, "context.slug", 100),
      incidentId: text(body.context.incidentId, "context.incidentId", 20),
      alertId: text(body.context.alertId, "context.alertId", 20),
    };
  }
  return { messages, context };
}

export class StaticAssistant implements Assistant {
  async reply(req: ChatRequest): Promise<ChatResponse> {
    const question = req.messages.at(-1)!.text;
    const { intent, slug } = detectIntent(question, req.context?.slug);
    const answer: Answer =
      intent === "trace" ? await trace(slug)
      : intent === "octopus" ? octopus()
      : intent === "ftp" ? ftp()
      : intent === "x" ? x()
      : intent === "logins" ? await logins()
      : intent === "fix" ? fix()
      : intent === "broke" ? broke()
      : intent === "daily" ? daily()
      : help();
    return {
      message: { role: "assistant", text: answer.text },
      evidence: cleanEvidence(answer.evidence),
      suggestions: answer.suggestions,
      model: STATIC_MODEL,
      unverifiedNumbers: answer.unverified ?? verifyNumbers(answer.text, answer.facts),
    };
  }
}

export const assistant: Assistant = new StaticAssistant();
