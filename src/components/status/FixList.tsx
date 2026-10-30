"use client";

import Link from "next/link";
import { Box, Button, Collapse, Typography } from "@mui/material";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import type { Fix } from "@/types/control";
import { SeverityChip } from "@/components/common/Health";
import { EvidenceChips } from "@/components/common/Bits";

// Read by screen readers, not shown
const visuallyHidden = { position: "absolute", width: "1px", height: "1px", margin: "-1px", padding: 0, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0 } as const;

function FixItem({ fix, defaultOpen }: { fix: Fix; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = `fix-${fix.id}`;
  return (
    <Box component="li" sx={{ display: "flex", gap: 1.5, py: 1.5, "& + &": { borderTop: 1, borderColor: "divider" } }}>
      <Box aria-hidden sx={{ width: 28, height: 28, flexShrink: 0, borderRadius: "4px", border: 1, borderColor: "text.primary", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "0.875rem" }}>
        {fix.rank}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start", flexWrap: "wrap" }}>
          <Typography component="h3" variant="body1" sx={{ fontWeight: 600, flex: 1, minWidth: 180 }}>
            <Box component="span" sx={visuallyHidden}>
              {`Fix ${fix.rank}: `}
            </Box>
            {fix.title}
          </Typography>
          <SeverityChip severity={fix.severity} />
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
          {fix.impact}
        </Typography>
        <Button size="small" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls={bodyId} endIcon={<ChevronDown size={14} aria-hidden style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 150ms" }} />} sx={{ mt: 0.5, ml: -1 }}>
          {open ? "Hide why and steps" : "Why, and what to do"}
        </Button>
        <Collapse in={open} id={bodyId}>
          <Box sx={{ pt: 1, display: "grid", gap: 1.25, minWidth: 0, overflowWrap: "anywhere" }}>
            <Typography variant="body2">{fix.why}</Typography>
            <Box component="ol" sx={{ m: 0, pl: 2.5, "& li + li": { mt: 0.5 } }}>
              {fix.steps.map((s, i) => (
                <Typography component="li" variant="body2" key={i}>
                  {s}
                </Typography>
              ))}
            </Box>
            <EvidenceChips items={fix.evidence} />
            {fix.alertId ? (
              <Box>
                <Button component={Link} href={`/alerts?id=${encodeURIComponent(fix.alertId)}`} size="small" variant="outlined">
                  Open the alert
                </Button>
              </Box>
            ) : null}
          </Box>
        </Collapse>
      </Box>
    </Box>
  );
}

export function FixList({ fixes }: { fixes: Fix[] }) {
  const ranked = fixes.toSorted((a, b) => a.rank - b.rank);
  return (
    <Box component="ol" sx={{ listStyle: "none", m: 0, p: 0, mt: -1.5 }}>
      {ranked.map((f, i) => (
        <FixItem key={f.id} fix={f} defaultOpen={i === 0} />
      ))}
    </Box>
  );
}
