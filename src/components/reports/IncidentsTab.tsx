"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel, ListItemText, MenuItem, Select, TextField, Typography } from "@mui/material";
import { Plus } from "lucide-react";
import { useState } from "react";
import { createIncident, getIncidents } from "@/lib/api";
import { invalidate } from "@/lib/invalidate";
import { useApi } from "@/hooks/useApi";
import { INCIDENT_STATUS_LABELS, SEVERITY_LABELS, SYSTEM_IDS, SYSTEM_NAMES, systemName } from "@/lib/labels";
import type { IncidentSummary, Severity, SystemId } from "@/types/control";
import { SeverityChip } from "@/components/common/Health";
import { GuardedButton } from "@/components/common/Guarded";
import { Raw, RelTime, cardSx } from "@/components/common/Bits";
import { AsyncView } from "@/components/common/AsyncView";
import { IncidentStatusMark } from "./IncidentStatusMark";

function NewIncidentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState<Severity>("warning");
  const [systems, setSystems] = useState<SystemId[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!title.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const inc = await createIncident({ title: title.trim(), severity, systems });
      invalidate("incidents", "overview");
      router.push(`/reports/incidents/${encodeURIComponent(inc.id)}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" slotProps={{ paper: { component: "form", onSubmit: (e: React.FormEvent) => (e.preventDefault(), submit()) } as object }}>
      <DialogTitle sx={{ fontWeight: 700, fontSize: "1.125rem" }}>New incident</DialogTitle>
      <DialogContent sx={{ display: "grid", gap: 2, pt: "8px !important" }}>
        <TextField label="What happened" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus size="small" placeholder="Octopus stopped collecting the feed" />
        <FormControl size="small">
          <InputLabel id="sev-l">Severity</InputLabel>
          <Select labelId="sev-l" label="Severity" value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
            {(Object.keys(SEVERITY_LABELS) as Severity[]).map((s) => (
              <MenuItem key={s} value={s}>
                {SEVERITY_LABELS[s]}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small">
          <InputLabel id="isys-l">Systems involved</InputLabel>
          <Select<SystemId[]> labelId="isys-l" label="Systems involved" multiple value={systems} onChange={(e) => setSystems(e.target.value as SystemId[])} renderValue={(v) => v.map((id) => SYSTEM_NAMES[id]).join(", ")} MenuProps={{ slotProps: { paper: { sx: { maxHeight: 340 } } } }}>
            {SYSTEM_IDS.map((id) => (
              <MenuItem key={id} value={id} dense>
                <Checkbox size="small" checked={systems.includes(id)} sx={{ p: 0.5, mr: 1 }} />
                <ListItemText primary={SYSTEM_NAMES[id]} />
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        {err ? (
          <Typography role="alert" variant="body2" sx={{ color: "error.main" }}>
            {err}
          </Typography>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="contained" disabled={busy || !title.trim()}>
          {busy ? "Opening…" : "Open incident"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function IncidentRow({ i }: { i: IncidentSummary }) {
  return (
    <Box
      component={Link}
      href={`/reports/incidents/${encodeURIComponent(i.id)}`}
      sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "110px 1fr auto" }, gap: { xs: 0.5, sm: 1.5 }, alignItems: "center", px: 1.5, py: 1.25, color: "text.primary", textDecoration: "none", "&:hover": { bgcolor: "action.hover" } }}
    >
      <Box sx={{ display: "flex", gap: 1, flexDirection: { sm: "column" }, alignItems: { xs: "center", sm: "flex-start" } }}>
        <IncidentStatusMark status={i.status} />
        <SeverityChip severity={i.severity} />
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {i.title}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {i.impactSummary}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "baseline" }}>
          <Raw>{i.id}</Raw>
          <span>{i.systems.map(systemName).join(", ")}</span>
          {i.affectedSlugs.length ? <span>{`${i.affectedSlugs.length} ${i.affectedSlugs.length === 1 ? "story" : "stories"} affected`}</span> : null}
        </Typography>
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
        opened <RelTime iso={i.openedAt} />
      </Typography>
    </Box>
  );
}

export function IncidentsTab() {
  const state = useApi("incidents", getIncidents, { refreshMs: 30_000 });
  const [creating, setCreating] = useState(false);
  return (
    <>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1.5, gap: 1, flexWrap: "wrap" }}>
        <Typography variant="body2" color="text.secondary">
          Open ones first. Each incident keeps its timeline, cause, fix and follow-ups.
        </Typography>
        <GuardedButton need="incident.create" variant="contained" onClick={() => setCreating(true)} startIcon={<Plus size={16} aria-hidden />}>
          New incident
        </GuardedButton>
      </Box>
      <AsyncView state={state} what="incidents" isEmpty={(d) => d.length === 0} empty="No incidents. Open one from an alert, or with New incident.">
        {(d) => {
          const order = { open: 0, monitoring: 1, resolved: 2 } as const;
          const sorted = d.toSorted((a, b) => order[a.status] - order[b.status] || b.openedAt.localeCompare(a.openedAt));
          return (
            <Box component="ul" aria-label={`Incidents, ${INCIDENT_STATUS_LABELS.open.toLowerCase()} first`} sx={{ ...cardSx, listStyle: "none", m: 0, p: 0, overflow: "hidden" }}>
              {sorted.map((i) => (
                <Box component="li" key={i.id} sx={{ "& + &": { borderTop: 1, borderColor: "divider" } }}>
                  <IncidentRow i={i} />
                </Box>
              ))}
            </Box>
          );
        }}
      </AsyncView>
      {creating ? <NewIncidentDialog open onClose={() => setCreating(false)} /> : null}
    </>
  );
}
