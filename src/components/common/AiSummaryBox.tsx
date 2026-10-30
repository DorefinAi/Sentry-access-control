"use client";

import { Box, Typography } from "@mui/material";
import { Sparkles, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import type { AiSummary } from "@/types/control";
import { EvidenceChips, Raw, RelTime, cardSx } from "./Bits";
import { Markdown } from "./Markdown";

/** AI text is always marked as AI, names its model, and flags numbers it could not ground. */
export function AiSummaryBox({ title, summary, action }: { title: string; summary: AiSummary; action?: ReactNode }) {
  return (
    <Box component="section" aria-label={title} sx={{ ...cardSx, p: { xs: 1.5, sm: 2 }, minWidth: 0 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1, flexWrap: "wrap" }}>
        <Sparkles size={16} aria-hidden />
        <Typography component="h2" sx={{ fontSize: "0.9375rem", fontWeight: 600, flex: 1, minWidth: 0 }}>
          {title}
        </Typography>
        {action}
      </Box>
      <Markdown text={summary.text} size="body1" />
      {summary.unverifiedNumbers?.length ? (
        <Box role="note" sx={{ mt: 1.5, display: "flex", gap: 1, alignItems: "flex-start", color: "warning.main", border: 1, borderColor: "warning.main", borderRadius: "4px", p: 1 }}>
          <TriangleAlert size={16} aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
          <Typography variant="body2" sx={{ color: "inherit" }}>
            <strong>Check these numbers:</strong> {summary.unverifiedNumbers.join(", ")} {summary.unverifiedNumbers.length === 1 ? "is" : "are"} not in the data the model was given.
          </Typography>
        </Box>
      ) : null}
      {summary.evidence.length ? (
        <Box sx={{ mt: 1.5 }}>
          <EvidenceChips items={summary.evidence} />
        </Box>
      ) : null}
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1.25, display: "flex", gap: 1, flexWrap: "wrap", alignItems: "baseline" }}>
        <span>
          Written by <Raw>{summary.model}</Raw>
        </span>
        <span>
          <RelTime iso={summary.generatedAt} />
        </span>
      </Typography>
    </Box>
  );
}
