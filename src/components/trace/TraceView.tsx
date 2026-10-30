"use client";

import Link from "next/link";
import { Box, Button, Typography, useTheme } from "@mui/material";
import { CircleCheck, CircleDashed, CircleMinus, CircleX, ScrollText } from "lucide-react";
import { getTrace } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { SOURCE_LABELS, STEP_LABELS, systemName, traceBanner } from "@/lib/labels";
import { clockIst, exactIst } from "@/lib/time";
import type { Health, Trace, TraceStep } from "@/types/control";
import { HealthIcon, healthColor } from "@/components/common/Health";
import { EvidenceChips, Raw, Slug, cardSx } from "@/components/common/Bits";
import { AsyncView, LoadingRows } from "@/components/common/AsyncView";
import { TraceSearch } from "./TraceSearch";

const TRACE_HEALTH: Record<Trace["state"], Health> = { done: "ok", on_track: "ok", stuck: "warn", failed: "down" };

function Banner({ t }: { t: Trace }) {
  const theme = useTheme();
  const h = TRACE_HEALTH[t.state];
  const color = healthColor(theme, h);
  return (
    <Box role="status" sx={{ display: "flex", gap: 1.5, alignItems: "center", p: { xs: 1.5, sm: 2 }, borderRadius: "6px", border: 2, borderColor: color }}>
      <HealthIcon health={h} size={28} title="" />
      <Box sx={{ minWidth: 0 }}>
        <Typography component="p" sx={{ fontSize: { xs: "1.25rem", sm: "1.5rem" }, fontWeight: 700, lineHeight: 1.2, color }}>
          {traceBanner(t)}
        </Typography>
        <Raw>{t.state}</Raw>
      </Box>
    </Box>
  );
}

const STEP_ICON = { done: CircleCheck, waiting: CircleDashed, failed: CircleX, skipped: CircleMinus } as const;

// `stopped` marks the one step the story is held at; later waiting steps were never reached
function Step({ s, last, stopped, afterStop }: { s: TraceStep; last: boolean; stopped: boolean; afterStop: boolean }) {
  const theme = useTheme();
  const Icon = STEP_ICON[s.state];
  const color =
    s.state === "done" ? theme.palette.success.main : s.state === "failed" ? theme.palette.error.main : stopped && s.state === "waiting" ? theme.palette.warning.main : theme.palette.text.secondary;
  return (
    <Box component="li" sx={{ display: "grid", gridTemplateColumns: { xs: "24px 1fr", sm: "72px 24px 1fr" }, columnGap: 1.5 }}>
      <Box component={s.at ? "time" : "span"} dateTime={s.at ?? undefined} title={s.at ? exactIst(s.at) : undefined} sx={{ display: { xs: "none", sm: "block" }, textAlign: "right", pt: "2px", fontFamily: "var(--font-mono), monospace", fontSize: "0.75rem", color: "text.secondary" }}>
        {s.at ? clockIst(s.at) : "–"}
      </Box>
      <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <Box sx={{ color, display: "flex", bgcolor: "background.paper" }}>
          <Icon size={20} aria-hidden strokeWidth={2.25} />
        </Box>
        {!last ? <Box aria-hidden sx={{ flex: 1, width: "2px", bgcolor: s.state === "done" ? "success.main" : "divider", my: 0.5, minHeight: 16 }} /> : null}
      </Box>
      <Box sx={{ pb: last ? 0 : 2.5, minWidth: 0 }}>
        <Box sx={{ display: "flex", gap: 1, alignItems: "baseline", flexWrap: "wrap" }}>
          <Typography variant="body1" sx={{ fontWeight: 600 }}>
            {s.stage}
          </Typography>
          <Typography variant="caption" sx={{ fontWeight: 600, color }}>
            {stopped && s.state === "waiting" ? "Stopped here" : afterStop && s.state === "waiting" ? "Not reached" : STEP_LABELS[s.state]}
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          <Box component="time" dateTime={s.at ?? undefined} sx={{ display: { sm: "none" }, fontFamily: "var(--font-mono), monospace" }}>
            {s.at ? clockIst(s.at) : "not yet"}
          </Box>
          <Box component={Link} href={`/systems/${s.system}`} sx={{ color: "inherit" }}>
            {systemName(s.system)}
          </Box>
        </Typography>
        {s.detail ? (
          <Typography variant="body2" sx={{ mt: 0.25, overflowWrap: "anywhere" }}>
            {s.detail}
          </Typography>
        ) : null}
        {s.evidence?.length ? (
          <Box sx={{ mt: 0.75 }}>
            <EvidenceChips items={s.evidence} />
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}

export default function TraceView({ slug }: { slug: string }) {
  const state = useApi(`trace:${slug}`, (s) => getTrace(slug, s), { refreshMs: 30_000 });
  return (
    <Box sx={{ display: "grid", gap: 2 }}>
      <TraceSearch />
      <AsyncView state={state} what={`the trace for ${slug}`} loading={<LoadingRows rows={5} height={56} />}>
        {(t) => {
          const stuck = t.state === "stuck" || t.state === "failed";
          // The first step that is not done or skipped is where the story stopped
          const stopAt = stuck ? t.steps.findIndex((s) => s.state === "waiting" || s.state === "failed") : -1;
          return (
            <>
              <Box>
                <Typography component="h1" sx={{ fontSize: { xs: "1.125rem", sm: "1.375rem" }, fontWeight: 700, lineHeight: 1.3 }}>
                  {t.headline}
                </Typography>
                <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", alignItems: "baseline", mt: 0.5 }}>
                  <Slug slug={t.slug} link={false} />
                  <Typography variant="body2" color="text.secondary">
                    {[t.reporter, t.city, t.source ? `via ${SOURCE_LABELS[t.source]}` : null].filter(Boolean).join(", ")}
                  </Typography>
                  <Button component={Link} href={`/logs?slug=${encodeURIComponent(t.slug)}&range=all`} size="small" startIcon={<ScrollText size={14} aria-hidden />}>
                    Logs for this slug
                  </Button>
                </Box>
              </Box>
              <Banner t={t} />
              <Box component="section" aria-label="Timeline" sx={{ ...cardSx, p: { xs: 1.5, sm: 2.5 } }}>
                {t.steps.length ? (
                  <Box component="ol" sx={{ listStyle: "none", m: 0, p: 0 }}>
                    {t.steps.map((s, i) => (
                      <Step key={i} s={s} last={i === t.steps.length - 1} stopped={i === stopAt} afterStop={stopAt >= 0 && i > stopAt} />
                    ))}
                  </Box>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    No steps recorded for this story yet.
                  </Typography>
                )}
              </Box>
            </>
          );
        }}
      </AsyncView>
    </Box>
  );
}
