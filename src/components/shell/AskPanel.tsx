"use client";

import { Box, Button, Chip, Drawer, IconButton, TextField, Tooltip, Typography, useMediaQuery, useTheme } from "@mui/material";
import { RotateCcw, Send, X } from "lucide-react";
import { KeyboardEvent, useEffect, useRef, useState } from "react";
import { useAsk } from "@/providers/AskProvider";
import { EvidenceChips, Raw } from "@/components/common/Bits";
import { Markdown } from "@/components/common/Markdown";
import { ErrorNote } from "@/components/common/AsyncView";

export const ASK_WIDTH = 400;

export default function AskPanel() {
  const { open, setOpen, turns, suggestions, sending, error, ask, retry, clear } = useAsk();
  const theme = useTheme();
  const wide = useMediaQuery(theme.breakpoints.up("md"));
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns.length, sending]);

  const submit = (text: string) => {
    if (sending || !text.trim()) return;
    ask(text);
    setDraft("");
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit(draft);
    }
  };

  // On a phone the panel covers the page, so following a link closes it
  const onLinkClick = (e: React.MouseEvent) => {
    if (!wide && (e.target as HTMLElement).closest("a")) setOpen(false);
  };

  // A closed persistent drawer still sits off-screen and widens the page, so unmount it
  if (!open) return null;

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={() => setOpen(false)}
      variant={wide ? "persistent" : "temporary"}
      slotProps={{
        paper: {
          component: "aside",
          "aria-label": "Ask the control centre",
          onKeyDown: (e: KeyboardEvent) => e.key === "Escape" && setOpen(false),
          sx: { width: { xs: "100%", md: ASK_WIDTH }, borderLeft: 1, borderColor: "divider", display: "flex", flexDirection: "column" },
        } as object,
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 2, height: 56, borderBottom: 1, borderColor: "divider", flexShrink: 0 }}>
        <Typography component="h2" sx={{ fontWeight: 700, fontSize: "1rem", flex: 1 }}>
          Ask
        </Typography>
        {turns.length ? (
          <Button size="small" onClick={clear} startIcon={<RotateCcw size={14} aria-hidden />}>
            New chat
          </Button>
        ) : null}
        <Tooltip title="Close (Esc)">
          <IconButton aria-label="Close Ask" onClick={() => setOpen(false)} sx={{ border: 1, borderColor: "divider", borderRadius: "6px", width: 40, height: 40 }}>
            <X size={18} />
          </IconButton>
        </Tooltip>
      </Box>

      <Box onClick={onLinkClick} aria-live="polite" sx={{ flex: 1, overflowY: "auto", px: 2, py: 2, display: "grid", alignContent: "start", gap: 2 }}>
        {!turns.length ? (
          <Typography variant="body2" color="text.secondary">
            Ask about anything the control centre watches. It answers from today&apos;s alerts, logs and traces, and links its evidence.
          </Typography>
        ) : null}
        {turns.map((t, i) =>
          t.message.role === "user" ? (
            <Box key={i} sx={{ justifySelf: "end", maxWidth: "88%", bgcolor: "action.hover", borderRadius: "6px", px: 1.5, py: 1 }}>
              <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {t.message.text}
              </Typography>
            </Box>
          ) : (
            <Box key={i} sx={{ display: "grid", gap: 1 }}>
              <Markdown text={t.message.text} />
              <EvidenceChips items={t.evidence} />
              {t.model ? <Raw>{t.model}</Raw> : null}
            </Box>
          )
        )}
        {sending ? (
          <Typography variant="body2" color="text.secondary" role="status">
            Looking through the data…
          </Typography>
        ) : null}
        {error ? <ErrorNote error={new Error(error)} what="an answer" onRetry={retry} /> : null}
        <div ref={endRef} />
      </Box>

      <Box sx={{ borderTop: 1, borderColor: "divider", p: 1.5, display: "grid", gap: 1, flexShrink: 0 }}>
        {suggestions.length ? (
          <Box component="ul" aria-label="Suggested questions" sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, listStyle: "none", m: 0, p: 0 }}>
            {suggestions.map((s) => (
              <li key={s}>
                <Chip label={s} size="small" variant="outlined" clickable disabled={sending} onClick={() => submit(s)} sx={{ height: "auto", minHeight: 26, "& .MuiChip-label": { whiteSpace: "normal" } }} />
              </li>
            ))}
          </Box>
        ) : null}
        <Box component="form" onSubmit={(e) => (e.preventDefault(), submit(draft))} sx={{ display: "flex", gap: 1, alignItems: "flex-end" }}>
          <TextField
            inputRef={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            placeholder="Ask a question"
            multiline
            maxRows={4}
            size="small"
            fullWidth
            slotProps={{ htmlInput: { "aria-label": "Your question" } }}
          />
          <IconButton type="submit" aria-label="Send" disabled={sending || !draft.trim()} sx={{ bgcolor: "primary.main", color: "primary.contrastText", borderRadius: "6px", width: 40, height: 40, "&:hover": { bgcolor: "primary.main", opacity: 0.85 }, "&.Mui-disabled": { bgcolor: "action.disabledBackground" } }}>
            <Send size={16} />
          </IconButton>
        </Box>
      </Box>
    </Drawer>
  );
}
