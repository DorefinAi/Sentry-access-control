"use client";

// The Ask panel's conversation. It sits above every page so the chat survives navigation.
import { createContext, ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";
import { chat } from "@/lib/api";
import type { ChatMessage, ChatRequest, Evidence } from "@/types/control";
import { SUGGESTED_QUESTIONS } from "@/types/control";

export interface Turn {
  message: ChatMessage;
  evidence?: Evidence[];
  model?: string;
}

interface AskState {
  open: boolean;
  turns: Turn[];
  suggestions: string[];
  sending: boolean;
  error: string | null;
}

interface AskActions {
  setOpen: (open: boolean) => void;
  ask: (text: string) => void;
  retry: () => void;
  clear: () => void;
}

const AskContext = createContext<(AskState & AskActions) | null>(null);

export function useAsk() {
  const ctx = useContext(AskContext);
  if (!ctx) throw new Error("useAsk must be used inside AskProvider");
  return ctx;
}

// What the assistant should know about where the person is looking
// The server answers from the data, not a long memory; recent turns are enough
const HISTORY_LIMIT = 20;

// A bad %-escape in the address must not break the chat
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function currentContext(): ChatRequest["context"] {
  const { pathname, search } = window.location;
  const parts = pathname.split("/").filter(Boolean);
  const params = new URLSearchParams(search);
  const ctx: NonNullable<ChatRequest["context"]> = { screen: parts[0] ?? "status" };
  if (parts[0] === "trace" && parts[1]) ctx.slug = safeDecode(parts[1]);
  if (parts[0] === "logs" && params.get("slug")) ctx.slug = params.get("slug")!;
  if (parts[0] === "reports" && parts[1] === "incidents" && parts[2]) ctx.incidentId = safeDecode(parts[2]);
  if (parts[0] === "alerts" && params.get("id")) ctx.alertId = params.get("id")!;
  if (parts[0] === "systems" && parts[1]) ctx.screen = `systems/${parts[1]}`;
  return ctx;
}

export default function AskProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([...SUGGESTED_QUESTIONS]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(async (history: Turn[]) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setSending(true);
    setError(null);
    try {
      const res = await chat({ messages: history.slice(-HISTORY_LIMIT).map((t) => t.message), context: currentContext() }, ctrl.signal);
      setTurns([...history, { message: res.message, evidence: res.evidence, model: res.model }]);
      setSuggestions(res.suggestions);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      if (abortRef.current === ctrl) setSending(false);
    }
  }, []);

  const ask = useCallback(
    (text: string) => {
      const q = text.trim();
      if (!q) return;
      const history = [...turns, { message: { role: "user" as const, text: q } }];
      setTurns(history);
      void send(history);
    },
    [turns, send]
  );

  const retry = useCallback(() => {
    if (turns.length && turns[turns.length - 1].message.role === "user") void send(turns);
  }, [turns, send]);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    setTurns([]);
    setSuggestions([...SUGGESTED_QUESTIONS]);
    setError(null);
    setSending(false);
  }, []);

  const value = useMemo(() => ({ open, turns, suggestions, sending, error, setOpen, ask, retry, clear }), [open, turns, suggestions, sending, error, ask, retry, clear]);

  return <AskContext.Provider value={value}>{children}</AskContext.Provider>;
}
