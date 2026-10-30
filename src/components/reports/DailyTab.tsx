"use client";

import Link from "next/link";
import { Box, TextField, Typography, useTheme } from "@mui/material";
import { useState } from "react";
import { getDailyReport } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { useClockReady } from "@/hooks/useNow";
import { dayLabel, todayIst } from "@/lib/time";
import type { DailyReport, Health } from "@/types/control";
import { HealthIcon, healthColor } from "@/components/common/Health";
import { Raw, Section, Slug, Stat } from "@/components/common/Bits";
import { AsyncView, EmptyNote, LoadingRows } from "@/components/common/AsyncView";
import { AiSummaryBox } from "@/components/common/AiSummaryBox";
import { HourlyChart } from "./HourlyChart";
import { IncidentStatusMark } from "./IncidentStatusMark";

const uptimeHealth = (pct: number): Health => (pct >= 99.5 ? "ok" : pct >= 95 ? "warn" : "down");

function Flow({ f }: { f: DailyReport["flow"] }) {
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 2 }}>
      <Stat label="Stories in" value={f.storiesIn} raw={`portal ${f.bySource.portal}, outlook ${f.bySource.outlook}, whatsapp ${f.bySource.whatsapp}`} />
      <Stat label="Approved" value={f.approved} />
      <Stat label="Rejected" value={f.rejected} />
      <Stat label="In the feed" value={f.inFeed} />
      <Stat label="Collected by Octopus" value={f.collected} />
      <Stat label="Median time to feed" value={f.medianMinutesToFeed === null ? "–" : `${f.medianMinutesToFeed} min`} />
      <Stat label="Posted on X" value={f.xPosts} />
      <Stat label="Recalled from X" value={f.xRecalled} />
    </Box>
  );
}

function Uptime({ rows }: { rows: DailyReport["uptime"] }) {
  const theme = useTheme();
  const sorted = rows.toSorted((a, b) => a.pct - b.pct);
  return (
    <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: 0.75 }}>
      {sorted.map((u) => {
        const h = uptimeHealth(u.pct);
        return (
          <Box component="li" key={u.system} sx={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 72px", gap: 1, alignItems: "center" }}>
            <Box sx={{ minWidth: 0 }}>
              <Box sx={{ display: "flex", gap: 0.75, alignItems: "center" }}>
                <HealthIcon health={h} size={14} />
                <Box component={Link} href={`/systems/${u.system}`} sx={{ color: "text.primary", fontSize: "0.8125rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {u.name}
                </Box>
              </Box>
              <Box aria-hidden sx={{ mt: 0.5, height: 4, borderRadius: 2, bgcolor: "action.hover", overflow: "hidden" }}>
                <Box sx={{ height: "100%", width: `${Math.max(0, Math.min(100, u.pct))}%`, bgcolor: healthColor(theme, h) }} />
              </Box>
            </Box>
            <Typography variant="body2" sx={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600, color: h === "ok" ? "text.primary" : healthColor(theme, h) }}>
              {u.pct.toFixed(u.pct === 100 ? 0 : 2)}%
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}

function Report({ r }: { r: DailyReport }) {
  return (
    <Box sx={{ display: "grid", gap: 2 }}>
      <AiSummaryBox title={`${dayLabel(r.date)} in one paragraph`} summary={r.narrative} />
      <Section title="How stories moved" id="flow">
        <Flow f={r.flow} />
      </Section>
      <Section title="Stories and errors by hour" id="hourly">
        <HourlyChart hourly={r.hourly} />
      </Section>
      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, alignItems: "start" }}>
        <Section title="Uptime per system" id="uptime">
          {r.uptime.length ? <Uptime rows={r.uptime} /> : <EmptyNote>No uptime data for this day.</EmptyNote>}
        </Section>
        <Box sx={{ display: "grid", gap: 2 }}>
          <Section title="What failed" id="failures">
            {r.failures.length ? (
              <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
                {r.failures.toSorted((a, b) => b.count - a.count).map((f) => (
                  <Box component="li" key={f.label} sx={{ display: "flex", justifyContent: "space-between", py: 0.5, "& + &": { borderTop: 1, borderColor: "divider" } }}>
                    <Typography variant="body2">{f.label}</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", color: f.count ? "error.main" : "text.primary" }}>
                      {f.count}
                    </Typography>
                  </Box>
                ))}
              </Box>
            ) : (
              <EmptyNote>Nothing failed.</EmptyNote>
            )}
          </Section>
          <Section title="Slowest stories" id="slowest">
            {r.slowest.length ? (
              <Box component="ol" sx={{ m: 0, pl: 2.5 }}>
                {r.slowest.map((s) => (
                  <Box component="li" key={s.slug} sx={{ py: 0.5 }}>
                    <Slug slug={s.slug} />
                    <Typography variant="body2" color="text.secondary">
                      {s.minutes} min, held up at {s.stuckAt}
                    </Typography>
                  </Box>
                ))}
              </Box>
            ) : (
              <EmptyNote>No slow stories.</EmptyNote>
            )}
          </Section>
        </Box>
      </Box>
      <Section title="Incidents that day" id="day-incidents">
        {r.incidents.length ? (
          <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
            {r.incidents.map((i) => (
              <Box component="li" key={i.id} sx={{ py: 0.75, display: "flex", gap: 1.5, alignItems: "baseline", flexWrap: "wrap", "& + &": { borderTop: 1, borderColor: "divider" } }}>
                <IncidentStatusMark status={i.status} />
                <Box component={Link} href={`/reports/incidents/${encodeURIComponent(i.id)}`} sx={{ color: "text.primary", fontWeight: 600, fontSize: "0.8125rem" }}>
                  {i.title}
                </Box>
                <Raw>{i.id}</Raw>
              </Box>
            ))}
          </Box>
        ) : (
          <EmptyNote>No incidents that day.</EmptyNote>
        )}
      </Section>
    </Box>
  );
}

export function DailyTab() {
  // Default to the server's today once its clock is known
  const ready = useClockReady();
  const [picked, setDate] = useState<string | null>(null);
  // A cleared date box falls back to today rather than loading nothing
  const date = picked || (ready ? todayIst() : "");
  const state = useApi(date ? `daily:${date}` : null, (s) => getDailyReport(date, s));
  return (
    <>
      <Box sx={{ display: "flex", gap: 1.5, alignItems: "center", mb: 2, flexWrap: "wrap" }}>
        <TextField type="date" label="Day" size="small" value={date} onChange={(e) => setDate(e.target.value)} slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: ready ? todayIst() : undefined } }} />
        <Typography variant="body2" color="text.secondary">
          {date ? dayLabel(date) : "Pick a day"}
        </Typography>
      </Box>
      <AsyncView state={state} what={`the report for ${date}`} loading={<LoadingRows rows={3} height={120} />}>
        {(r) => <Report r={r} />}
      </AsyncView>
    </>
  );
}
