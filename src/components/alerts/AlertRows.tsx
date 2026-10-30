"use client";

import Link from "next/link";
import { Box, Typography } from "@mui/material";
import { FileText } from "lucide-react";
import type { Alert } from "@/types/control";
import { systemName } from "@/lib/labels";
import { useNow } from "@/hooks/useNow";
import { exactIst, relative } from "@/lib/time";
import { SeverityChip } from "@/components/common/Health";

export function AlertRows({ alerts, selectedId }: { alerts: Alert[]; selectedId?: string | null }) {
  const now = useNow();
  return (
    <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0, borderTop: 1, borderColor: "divider" }}>
      {alerts.map((a) => (
        <li key={a.id}>
          <Box
            component={Link}
            href={`/alerts?state=${a.state}&id=${encodeURIComponent(a.id)}`}
            scroll={false}
            aria-current={a.id === selectedId ? "true" : undefined}
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr auto", sm: "112px 1fr auto" },
              gridTemplateAreas: { xs: '"title title" "sev time"', sm: '"sev title time"' },
              gap: { xs: 0.5, sm: 1.5 },
              alignItems: "center",
              px: 1,
              py: 1.25,
              borderBottom: 1,
              borderColor: "divider",
              color: "text.primary",
              textDecoration: "none",
              bgcolor: a.id === selectedId ? "action.selected" : undefined,
              "&:hover": { bgcolor: "action.hover" },
            }}
          >
            <Box sx={{ gridArea: "sev" }}>
              <SeverityChip severity={a.severity} />
            </Box>
            <Box sx={{ minWidth: 0, gridArea: "title" }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {a.title}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                <span>{a.systems.map(systemName).join(", ")}</span>
                {a.incidentId ? (
                  <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.25 }}>
                    <FileText size={12} aria-hidden /> {a.incidentId}
                  </Box>
                ) : null}
              </Typography>
            </Box>
            <Typography component="time" dateTime={a.firedAt} variant="caption" color="text.secondary" title={exactIst(a.firedAt)} sx={{ whiteSpace: "nowrap", gridArea: "time", justifySelf: "end" }}>
              {relative(a.firedAt, now)}
            </Typography>
          </Box>
        </li>
      ))}
    </Box>
  );
}
