"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Box, Button, Chip, TextField, Typography } from "@mui/material";
import { Check, CheckCheck, FileText, RotateCcw } from "lucide-react";
import { useState } from "react";
import type { Alert, AlertPatch } from "@/types/control";
import { createIncident, patchAlert } from "@/lib/api";
import { invalidate } from "@/lib/invalidate";
import { systemName } from "@/lib/labels";
import { SeverityChip } from "@/components/common/Health";
import { GuardedButton } from "@/components/common/Guarded";
import { useCan } from "@/providers/SessionProvider";
import { EvidenceChips, Raw, RelTime } from "@/components/common/Bits";

const STATE_WORDS: Record<Alert["state"], string> = { open: "Open", acked: "Acknowledged", resolved: "Resolved" };

function Steps({ title, steps }: { title: string; steps: string[] }) {
  if (!steps.length) return null;
  return (
    <Box>
      <Typography component="h3" variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>
        {title}
      </Typography>
      <Box component="ol" sx={{ m: 0, pl: 2.5, "& li + li": { mt: 0.5 } }}>
        {steps.map((s, i) => (
          <Typography component="li" variant="body2" key={i}>
            {s}
          </Typography>
        ))}
      </Box>
    </Box>
  );
}

export function AlertDetail({ alert, onChange }: { alert: Alert; onChange: (a: Alert) => void }) {
  const router = useRouter();
  const noteAccess = useCan("alert.note");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const act = async (patch: AlertPatch) => {
    setBusy(patch.action);
    setErr(null);
    try {
      onChange(await patchAlert(alert.id, patch));
      // Badge, Status, system pages and incident timelines all show alert state
      invalidate("overview", "alerts", "system:", "incident:");
      if (patch.action === "note") setNote("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const openIncident = async () => {
    setBusy("incident");
    setErr(null);
    try {
      const inc = await createIncident({ title: alert.title, severity: alert.severity, systems: alert.systems, alertIds: [alert.id] });
      onChange({ ...alert, incidentId: inc.id });
      invalidate("overview", "alerts", "incidents");
      router.push(`/reports/incidents/${encodeURIComponent(inc.id)}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(null);
    }
  };

  return (
    <Box sx={{ display: "grid", gap: 2 }}>
      <Box>
        <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap", mb: 0.75 }}>
          <SeverityChip severity={alert.severity} />
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {STATE_WORDS[alert.state]}
          </Typography>
          <Raw>{alert.ruleId}</Raw>
        </Box>
        <Typography component="h2" sx={{ fontSize: "1.125rem", fontWeight: 700, lineHeight: 1.3 }}>
          {alert.title}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, display: "flex", gap: 1.5, flexWrap: "wrap" }}>
          <span>
            Fired <RelTime iso={alert.firedAt} />
          </span>
          <span>
            Last seen <RelTime iso={alert.lastSeenAt} />
          </span>
          {alert.ackedAt ? (
            <span>
              Acked <RelTime iso={alert.ackedAt} />
            </span>
          ) : null}
          {alert.resolvedAt ? (
            <span>
              Resolved <RelTime iso={alert.resolvedAt} />
            </span>
          ) : null}
        </Typography>
        <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap", mt: 1 }}>
          {alert.systems.map((id) => (
            <Chip key={id} component={Link} href={`/systems/${id}`} clickable size="small" variant="outlined" label={systemName(id)} />
          ))}
        </Box>
      </Box>

      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
        {alert.state === "open" ? (
          <GuardedButton need="alert.act" variant="contained" disabled={!!busy} onClick={() => act({ action: "ack" })} startIcon={<Check size={16} aria-hidden />}>
            {busy === "ack" ? "Acknowledging…" : "Acknowledge"}
          </GuardedButton>
        ) : null}
        {alert.state !== "resolved" ? (
          <GuardedButton need="alert.act" variant={alert.state === "open" ? "outlined" : "contained"} disabled={!!busy} onClick={() => act({ action: "resolve" })} startIcon={<CheckCheck size={16} aria-hidden />}>
            {busy === "resolve" ? "Resolving…" : "Resolve"}
          </GuardedButton>
        ) : (
          <GuardedButton need="alert.act" variant="outlined" disabled={!!busy} onClick={() => act({ action: "reopen" })} startIcon={<RotateCcw size={16} aria-hidden />}>
            {busy === "reopen" ? "Reopening…" : "Reopen"}
          </GuardedButton>
        )}
        {alert.incidentId ? (
          <Button component={Link} href={`/reports/incidents/${encodeURIComponent(alert.incidentId)}`} variant="outlined" startIcon={<FileText size={16} aria-hidden />}>
            Incident {alert.incidentId}
          </Button>
        ) : (
          <GuardedButton need="incident.create" variant="outlined" disabled={!!busy} onClick={openIncident} startIcon={<FileText size={16} aria-hidden />}>
            {busy === "incident" ? "Opening…" : "Open incident"}
          </GuardedButton>
        )}
      </Box>
      {err ? (
        <Typography role="alert" variant="body2" sx={{ color: "error.main" }}>
          {err}
        </Typography>
      ) : null}

      <Box>
        <Typography component="h3" variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>
          What this means
        </Typography>
        <Typography variant="body2">{alert.runbook.meaning}</Typography>
      </Box>
      <Steps title="Check first" steps={alert.runbook.checkFirst} />
      <Steps title="Fix" steps={alert.runbook.fix} />

      {alert.evidence.length ? (
        <Box>
          <Typography component="h3" variant="body2" sx={{ fontWeight: 700, mb: 0.75 }}>
            Evidence
          </Typography>
          <EvidenceChips items={alert.evidence} />
        </Box>
      ) : null}

      <Box component="form" onSubmit={(e) => (e.preventDefault(), note.trim() && act({ action: "note", note: note.trim() }))}>
        <Typography component="h3" variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>
          Note
        </Typography>
        {alert.noteHistory?.length ? (
          // Every note, oldest first, with who wrote it
          <Box component="ol" aria-label="Notes" sx={{ listStyle: "none", m: 0, mb: 1, p: 0, display: "grid", gap: 0.75 }}>
            {alert.noteHistory.map((n, i) => (
              <Box component="li" key={i} sx={{ p: 1, bgcolor: "action.hover", borderRadius: "4px" }}>
                <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                  {n.text}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {n.by ? <Raw sx={{ color: "text.primary", mr: 0.75 }}>{n.by}</Raw> : null}
                  <RelTime iso={n.at} />
                </Typography>
              </Box>
            ))}
          </Box>
        ) : alert.note ? (
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", mb: 1, p: 1, bgcolor: "action.hover", borderRadius: "4px" }}>
            {alert.note}
          </Typography>
        ) : null}
        <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
          <TextField
            value={note}
            onChange={(e) => setNote(e.target.value)}
            size="small"
            fullWidth
            multiline
            maxRows={4}
            disabled={!noteAccess.allowed}
            placeholder={noteAccess.allowed ? "What you found or did" : noteAccess.reason}
            slotProps={{ htmlInput: { "aria-label": "Add a note" } }}
          />
          <GuardedButton need="alert.note" type="submit" variant="outlined" disabled={!!busy || !note.trim()} sx={{ flexShrink: 0 }}>
            {busy === "note" ? "Saving…" : "Add note"}
          </GuardedButton>
        </Box>
      </Box>
    </Box>
  );
}
