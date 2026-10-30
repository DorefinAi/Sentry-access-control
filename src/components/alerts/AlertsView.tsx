"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Box, Drawer, IconButton, Tab, Tabs, Tooltip, Typography } from "@mui/material";
import { X } from "lucide-react";
import { getAlerts } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import type { Alert, AlertState } from "@/types/control";
import { PageHeader, cardSx } from "@/components/common/Bits";
import { AsyncView, ErrorNote, LoadingRows } from "@/components/common/AsyncView";
import { AlertRows } from "./AlertRows";
import { AlertDetail } from "./AlertDetail";

const TABS: { state: AlertState; label: string; empty: string }[] = [
  { state: "open", label: "Open", empty: "No open alerts. Nothing needs you right now." },
  { state: "acked", label: "Acknowledged", empty: "Nothing acknowledged and still in progress." },
  { state: "resolved", label: "Resolved", empty: "Nothing resolved yet today." },
];

const SEV_ORDER = { critical: 0, warning: 1, info: 2 } as const;
const byUrgency = (a: Alert, b: Alert) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || b.firedAt.localeCompare(a.firedAt);

export default function AlertsView() {
  const router = useRouter();
  const params = useSearchParams();
  const tabParam = params.get("state");
  const tab: AlertState = tabParam === "acked" || tabParam === "resolved" ? tabParam : "open";
  const selectedId = params.get("id");

  // All states at once so every tab can show its count
  const state = useApi("alerts:all", (s) => getAlerts(undefined, s), { refreshMs: 30_000 });
  const alerts = state.data ?? [];
  const selected = alerts.find((a) => a.id === selectedId) ?? null;

  const counts = { open: 0, acked: 0, resolved: 0 };
  for (const a of alerts) counts[a.state]++;

  const go = (q: { state?: AlertState; id?: string | null }) => {
    const s = new URLSearchParams();
    s.set("state", q.state ?? tab);
    if (q.id) s.set("id", q.id);
    router.replace(`/alerts?${s.toString()}`, { scroll: false });
  };

  const replaceAlert = (next: Alert) => state.mutate((prev) => (prev ?? []).map((a) => (a.id === next.id ? next : a)));
  const current = TABS.find((t) => t.state === tab)!;

  return (
    <>
      <PageHeader title="Alerts" subtitle="Acknowledge what you are looking at, resolve it when it is fixed." />
      <Box sx={{ ...cardSx, overflow: "hidden" }}>
        <Tabs value={tab} onChange={(_, v: AlertState) => go({ state: v, id: null })} variant="scrollable" allowScrollButtonsMobile aria-label="Alert state" sx={{ borderBottom: 1, borderColor: "divider", px: 1 }}>
          {TABS.map((t) => (
            <Tab
              key={t.state}
              value={t.state}
              label={
                <Box component="span" sx={{ display: "inline-flex", gap: 0.75, alignItems: "center" }}>
                  {t.label}
                  <Box component="span" sx={{ fontVariantNumeric: "tabular-nums", px: 0.75, borderRadius: "4px", bgcolor: t.state === "open" && counts.open ? "error.main" : "action.selected", color: t.state === "open" && counts.open ? "error.contrastText" : "text.primary", fontSize: "0.75rem", lineHeight: "18px" }}>
                    {state.data ? counts[t.state] : "–"}
                  </Box>
                </Box>
              }
            />
          ))}
        </Tabs>
        <Box sx={{ p: { xs: 1, sm: 1.5 } }} role="tabpanel" aria-label={current.label}>
          <AsyncView state={state} what="alerts" loading={<LoadingRows rows={4} height={52} />} isEmpty={(d) => !d.some((a) => a.state === tab)} empty={current.empty}>
            {(d) => <AlertRows alerts={d.filter((a) => a.state === tab).toSorted(byUrgency)} selectedId={selectedId} />}
          </AsyncView>
        </Box>
      </Box>

      <Drawer anchor="right" open={!!selectedId} onClose={() => go({ id: null })} slotProps={{ paper: { sx: { width: { xs: "100%", sm: 520 }, p: { xs: 2, sm: 3 } } } }}>
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Alert {selectedId}
          </Typography>
          <Tooltip title="Close (Esc)">
            <IconButton aria-label="Close alert" onClick={() => go({ id: null })} sx={{ border: 1, borderColor: "divider", borderRadius: "6px", width: 40, height: 40 }}>
              <X size={18} />
            </IconButton>
          </Tooltip>
        </Box>
        {selected ? (
          <AlertDetail key={selected.id} alert={selected} onChange={replaceAlert} />
        ) : state.error ? (
          <ErrorNote error={state.error} onRetry={state.reload} what="this alert" />
        ) : state.data ? (
          <Typography variant="body2">No alert with id {selectedId}. It may have been cleared.</Typography>
        ) : (
          <LoadingRows rows={5} />
        )}
      </Drawer>
    </>
  );
}
