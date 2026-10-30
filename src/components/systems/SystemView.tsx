"use client";

import Link from "next/link";
import { Box, Button, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography, useTheme } from "@mui/material";
import { ArrowLeft, ScrollText } from "lucide-react";
import { getSystem } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { GROUP_LABELS } from "@/lib/labels";
import { duration } from "@/lib/time";
import type { SystemDetail } from "@/types/control";
import { HealthIcon, HealthLabel, healthColor } from "@/components/common/Health";
import { PageHeader, Raw, RelTime, Section } from "@/components/common/Bits";
import { AsyncView, EmptyNote } from "@/components/common/AsyncView";
import { LogList } from "@/components/logs/LogList";
import { AlertRows } from "@/components/alerts/AlertRows";

function Metrics({ s }: { s: SystemDetail }) {
  const theme = useTheme();
  const base: { label: string; value: string; health?: SystemDetail["health"]; raw?: string }[] = [
    { label: "Uptime, 24 h", value: s.uptimePct24h === null ? "not known" : `${s.uptimePct24h.toFixed(1)}%` },
    ...(s.version ? [{ label: "Version", value: s.version }] : []),
    ...s.metrics,
  ];
  return (
    <Box component="dl" sx={{ m: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 2 }}>
      {base.map((m) => (
        <Box key={m.label} sx={{ minWidth: 0 }}>
          <Typography component="dt" variant="body2" color="text.secondary">
            {m.label}
          </Typography>
          <Typography component="dd" sx={{ m: 0, fontSize: "1.125rem", fontWeight: 700, fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere", color: m.health && m.health !== "ok" ? healthColor(theme, m.health) : "text.primary" }}>
            {m.value}
            {m.health && m.health !== "ok" ? (
              <Box component="span" sx={{ ml: 0.75, verticalAlign: "-2px", display: "inline-flex" }}>
                <HealthIcon health={m.health} size={16} />
              </Box>
            ) : null}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

function Queues({ s }: { s: SystemDetail }) {
  if (!s.queues?.length) return null;
  return (
    <Section title="Queues" id="queues">
      <TableContainer>
        <Table size="small" aria-labelledby="queues-h">
          <TableHead>
            <TableRow>
              <TableCell>Queue</TableCell>
              <TableCell align="right">Waiting</TableCell>
              <TableCell align="right">Running</TableCell>
              <TableCell align="right">Failed (24 h)</TableCell>
              <TableCell align="right">Oldest waiting</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {s.queues.map((q) => (
              <TableRow key={q.name}>
                <TableCell>
                  <Raw sx={{ color: "text.primary", fontWeight: 600 }}>{q.name}</Raw>
                </TableCell>
                <TableCell align="right">{q.pending}</TableCell>
                <TableCell align="right">{q.running}</TableCell>
                <TableCell align="right" sx={{ color: q.failed ? "error.main" : undefined, fontWeight: q.failed ? 700 : undefined }}>
                  {q.failed}
                </TableCell>
                <TableCell align="right">{q.oldestPendingSec === null ? "none" : duration(q.oldestPendingSec)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Section>
  );
}

export default function SystemView({ id }: { id: string }) {
  const state = useApi(`system:${id}`, (sig) => getSystem(id, sig), { refreshMs: 30_000 });
  return (
    <>
      <Button component={Link} href="/" size="small" startIcon={<ArrowLeft size={14} aria-hidden />} sx={{ mb: 1, ml: -1 }}>
        Status
      </Button>
      <AsyncView state={state} what="this system">
        {(s) => (
          <>
            <PageHeader
              title={s.name}
              subtitle={
                <Box component="span" sx={{ display: "inline-flex", gap: 1.5, flexWrap: "wrap", alignItems: "center" }}>
                  <HealthLabel health={s.health} />
                  <span>{GROUP_LABELS[s.group]}</span>
                  <span>
                    Heartbeat <RelTime iso={s.lastHeartbeat} />
                  </span>
                  <Raw>{s.where}</Raw>
                </Box>
              }
              action={
                <Button component={Link} href={`/logs?system=${s.id}`} variant="outlined" startIcon={<ScrollText size={16} aria-hidden />}>
                  All logs
                </Button>
              }
            />
            <Typography variant="body1" sx={{ mb: 2 }}>
              {s.summary}
            </Typography>
            <Box sx={{ display: "grid", gap: 2 }}>
              {s.lastError ? (
                <Box role="note" sx={{ p: 1.5, border: 1, borderColor: "error.main", borderRadius: "6px" }}>
                  <Typography variant="body2" sx={{ fontWeight: 700, color: "error.main" }}>
                    Last error, <RelTime iso={s.lastError.at} />
                  </Typography>
                  <Raw sx={{ color: "text.primary", display: "block", mt: 0.5, whiteSpace: "pre-wrap" }}>{s.lastError.message}</Raw>
                </Box>
              ) : null}
              <Section title="Open alerts" id="sys-alerts">
                {s.openAlerts.length ? <AlertRows alerts={s.openAlerts} /> : <EmptyNote>No open alerts for this system.</EmptyNote>}
              </Section>
              <Section title="Numbers" id="metrics">
                <Metrics s={s} />
              </Section>
              <Queues s={s} />
              <Section title="Recent logs" id="sys-logs">
                {s.recentLogs.length ? <LogList entries={s.recentLogs} showSystem={false} /> : <EmptyNote>No recent log lines.</EmptyNote>}
              </Section>
            </Box>
          </>
        )}
      </AsyncView>
    </>
  );
}
