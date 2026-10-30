"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Box, InputAdornment, TextField, Typography } from "@mui/material";
import { Search } from "lucide-react";
import { KeyboardEvent, useId, useState } from "react";
import { searchTrace } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { useDebounced } from "@/hooks/useDebounced";
import { useNow } from "@/hooks/useNow";
import { exactIst, relative } from "@/lib/time";
import { Slug, cardSx } from "@/components/common/Bits";
import { ErrorNote, LoadingRows } from "@/components/common/AsyncView";
import { MONO_STACK } from "@/providers/MuiProvider";

/** One box: type a slug or part of a headline, pick a hit. Enter opens the top hit or the typed slug. */
export function TraceSearch({ initial = "", autoFocus }: { initial?: string; autoFocus?: boolean }) {
  const router = useRouter();
  const now = useNow();
  const [q, setQ] = useState(initial);
  const term = useDebounced(q.trim(), 200);
  const hits = useApi(term.length >= 2 ? `trace-search:${term}` : null, (s) => searchTrace(term, s));
  const listId = useId();

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const top = hits.data?.[0]?.slug ?? q.trim();
    if (top) router.push(`/trace/${encodeURIComponent(top)}`);
  };

  return (
    <Box>
      <TextField
        fullWidth
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKey}
        autoFocus={autoFocus}
        placeholder="Slug or words from the headline"
        slotProps={{
          htmlInput: { "aria-label": "Find a story by slug or headline", "aria-controls": listId, spellCheck: false, style: { fontFamily: MONO_STACK, fontWeight: 600 } },
          input: { startAdornment: <InputAdornment position="start"><Search size={18} aria-hidden /></InputAdornment> },
        }}
        sx={{ "& .MuiOutlinedInput-root": { bgcolor: "background.paper" } }}
      />
      <Box id={listId} aria-live="polite" sx={{ mt: term.length >= 2 ? 1 : 0 }}>
        {term.length < 2 ? null : hits.error ? (
          <ErrorNote error={hits.error} what="matches" onRetry={hits.reload} />
        ) : !hits.data ? (
          <LoadingRows rows={2} height={48} />
        ) : hits.data.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ px: 0.5 }}>
            No story matches “{term}”. Check the slug, or try a word from the headline.
          </Typography>
        ) : (
          <Box component="ul" aria-label="Matching stories" sx={{ ...cardSx, listStyle: "none", m: 0, p: 0, overflow: "hidden" }}>
            {hits.data.map((h) => (
              <Box component="li" key={h.slug} sx={{ "& + &": { borderTop: 1, borderColor: "divider" } }}>
                <Box component={Link} href={`/trace/${encodeURIComponent(h.slug)}`} sx={{ display: "block", px: 1.5, py: 1, color: "text.primary", textDecoration: "none", "&:hover": { bgcolor: "action.hover" } }}>
                  <Box sx={{ display: "flex", gap: 1, justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap" }}>
                    <Slug slug={h.slug} link={false} />
                    <Typography variant="caption" color="text.secondary" title={exactIst(h.receivedAt)}>
                      received {relative(h.receivedAt, now)}
                    </Typography>
                  </Box>
                  <Typography variant="body2">{h.headline}</Typography>
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
}
