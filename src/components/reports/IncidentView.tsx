"use client";

import Link from "next/link";
import { Box, Button, Checkbox, Chip, IconButton, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from "@mui/material";
import { ArrowLeft, Bell, Download, Flag, MessageSquare, ScrollText, Trash } from "lucide-react";
import { useState } from "react";
import { getIncident, incidentExportUrl, patchIncident } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { invalidate } from "@/lib/invalidate";
import { INCIDENT_STATUS_LABELS, systemName } from "@/lib/labels";
import { clockIst, exactIst } from "@/lib/time";
import type { Incident, IncidentEvent, IncidentPatch, IncidentStatus } from "@/types/control";
import { SeverityChip } from "@/components/common/Health";
import { useCan } from "@/providers/SessionProvider";
import { EvidenceChips, PageHeader, Raw, RelTime, Section, Slug, Stat } from "@/components/common/Bits";
import { AsyncView, LoadingRows } from "@/components/common/AsyncView";
import { AiSummaryBox } from "@/components/common/AiSummaryBox";
import { IncidentStatusMark } from "./IncidentStatusMark";

const KIND_ICON = { alert: Bell, log: ScrollText, note: MessageSquare, status: Flag } as const;
const KIND_WORD = { alert: "Alert", log: "Log", note: "Note", status: "Status" } as const;

function Timeline({ events }: { events: IncidentEvent[] }) {
  return (
    <Box component="ol" sx={{ listStyle: "none", m: 0, p: 0 }}>
      {events.map((ev, i) => {
        const Icon = KIND_ICON[ev.kind];
        return (
          <Box component="li" key={i} sx={{ display: "grid", gridTemplateColumns: "20px 1fr", gap: 1.25, py: 1, "& + &": { borderTop: 1, borderColor: "divider" } }}>
            <Box sx={{ pt: "2px", color: "text.secondary" }}>
              <Icon size={16} aria-hidden />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: "flex", gap: 1 }}>
                <time dateTime={ev.at} title={exactIst(ev.at)}>
                  {clockIst(ev.at)}
                </time>
                <span>{KIND_WORD[ev.kind]}</span>
              </Typography>
              <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {ev.text}
              </Typography>
              {ev.evidence?.length ? (
                <Box sx={{ mt: 0.5 }}>
                  <EvidenceChips items={ev.evidence} />
                </Box>
              ) : null}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

/** A text area that saves on demand; shows the saved text until edited. */
function EditableText({ label, value, placeholder, onSave, readOnly }: { label: string; value: string; placeholder: string; onSave: (v: string) => Promise<boolean>; readOnly?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = draft !== null && draft !== value;
  const save = async () => {
    if (draft === null) return;
    setBusy(true);
    // On failure keep the draft so nothing typed is lost
    if (await onSave(draft)) setDraft(null);
    setBusy(false);
  };
  return (
    <Box>
      <TextField label={label} value={draft ?? value} onChange={(e) => setDraft(e.target.value)} placeholder={readOnly ? "Not written yet" : placeholder} multiline minRows={3} fullWidth size="small" slotProps={{ inputLabel: { shrink: true }, htmlInput: { readOnly } }} />
      <Box sx={{ display: "flex", gap: 1, mt: 1, alignItems: "center", minHeight: 36 }}>
        {dirty ? (
          <>
            <Button variant="contained" size="small" onClick={save} disabled={busy}>
              {busy ? "Saving…" : `Save ${label.toLowerCase()}`}
            </Button>
            <Button size="small" onClick={() => setDraft(null)} disabled={busy}>
              Undo changes
            </Button>
          </>
        ) : (
          <Typography variant="caption" color="text.secondary">
            {readOnly ? "Read only" : value ? "Saved" : "Not written yet"}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

function FollowUps({ items, onSave, readOnly }: { items: Incident["followUps"]; onSave: (next: Incident["followUps"]) => Promise<boolean>; readOnly?: boolean }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (next: Incident["followUps"]) => {
    setBusy(true);
    const ok = await onSave(next);
    setBusy(false);
    return ok;
  };
  return (
    <Box>
      {items.length ? (
        <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
          {items.map((f, i) => (
            <Box component="li" key={i} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <Checkbox
                checked={f.done}
                disabled={busy || readOnly}
                onChange={() => run(items.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))}
                slotProps={{ input: { "aria-label": f.text } }}
                size="small"
              />
              <Typography variant="body2" sx={{ flex: 1, minWidth: 0, textDecoration: f.done ? "line-through" : "none", color: f.done ? "text.secondary" : "text.primary" }}>
                {f.text}
              </Typography>
              {readOnly ? null : (
              <Tooltip title="Remove">
                <IconButton size="small" aria-label={`Remove "${f.text}"`} disabled={busy} onClick={() => run(items.filter((_, j) => j !== i))}>
                  <Trash size={14} />
                </IconButton>
              </Tooltip>
              )}
            </Box>
          ))}
        </Box>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          No follow-ups yet.
        </Typography>
      )}
      {readOnly ? null : (
      <Box
        component="form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!text.trim()) return;
          if (await run([...items, { text: text.trim(), done: false }])) setText("");
        }}
        sx={{ display: "flex", gap: 1, mt: 1 }}
      >
        <TextField size="small" fullWidth value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a follow-up" slotProps={{ htmlInput: { "aria-label": "New follow-up" } }} />
        <Button type="submit" variant="outlined" disabled={busy || !text.trim()} sx={{ flexShrink: 0 }}>
          Add
        </Button>
      </Box>
      )}
    </Box>
  );
}

function NoteForm({ onAdd }: { onAdd: (note: string) => Promise<boolean> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Box
      component="form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim()) return;
        setBusy(true);
        if (await onAdd(text.trim())) setText("");
        setBusy(false);
      }}
      sx={{ display: "flex", gap: 1, mt: 1.5 }}
    >
      <TextField size="small" fullWidth multiline maxRows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="What you found or did" slotProps={{ htmlInput: { "aria-label": "Add a note to the timeline" } }} />
      <Button type="submit" variant="outlined" disabled={busy || !text.trim()} sx={{ flexShrink: 0 }}>
        {busy ? "Adding…" : "Add note"}
      </Button>
    </Box>
  );
}

function IncidentBody({ inc, onPatch }: { inc: Incident; onPatch: (p: IncidentPatch) => Promise<boolean> }) {
  const edit = useCan("incident.edit");
  const readOnly = !edit.allowed;
  const [statusBusy, setStatusBusy] = useState(false);
  return (
    <>
      <PageHeader
        title={inc.title}
        subtitle={
          <Box component="span" sx={{ display: "inline-flex", gap: 1.5, flexWrap: "wrap", alignItems: "center" }}>
            <Raw>{inc.id}</Raw>
            <SeverityChip severity={inc.severity} />
            <IncidentStatusMark status={inc.status} />
            <span>
              Opened <RelTime iso={inc.openedAt} /> {inc.openedBy === "auto" ? "automatically" : "by hand"}
            </span>
            {inc.resolvedAt ? (
              <span>
                Resolved <RelTime iso={inc.resolvedAt} />
              </span>
            ) : null}
          </Box>
        }
        action={
          <Button component="a" href={incidentExportUrl(inc.id)} download={`${inc.id}.md`} variant="outlined" startIcon={<Download size={16} aria-hidden />}>
            Export .md
          </Button>
        }
      />

      <Box sx={{ display: "grid", gap: 2 }}>
        <Box sx={{ display: "flex", gap: 1.5, alignItems: "center", flexWrap: "wrap" }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }} id="status-l">
            Status
          </Typography>
          <Tooltip title={readOnly ? edit.reason : ""}>
          <Box component="span" tabIndex={readOnly ? 0 : -1} sx={{ display: "inline-flex", borderRadius: "6px" }}>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={inc.status}
            aria-labelledby="status-l"
            disabled={statusBusy || readOnly}
            onChange={async (_, v: IncidentStatus | null) => {
              if (!v || v === inc.status) return;
              setStatusBusy(true);
              await onPatch({ status: v });
              setStatusBusy(false);
            }}
            sx={{ "& .MuiToggleButton-root": { textTransform: "none", px: 1.5, fontWeight: 600 }, "& .MuiToggleButton-root:first-of-type": { borderRadius: "6px 0 0 6px" }, "& .MuiToggleButton-root:last-of-type": { borderRadius: "0 6px 6px 0" }, "& .Mui-selected.Mui-disabled": { color: "text.primary" } }}
          >
            {(Object.keys(INCIDENT_STATUS_LABELS) as IncidentStatus[]).map((s) => (
              <ToggleButton key={s} value={s}>
                {INCIDENT_STATUS_LABELS[s]}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          </Box>
          </Tooltip>
          <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
            {inc.systems.map((id) => (
              <Chip key={id} component={Link} href={`/systems/${id}`} clickable size="small" variant="outlined" label={systemName(id)} />
            ))}
          </Box>
        </Box>

        <Section title="Impact" id="impact">
          <Typography variant="body1" sx={{ mb: 1.5 }}>
            {inc.impact.summary}
          </Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 2 }}>
            <Stat label="Stories delayed" value={inc.impact.storiesDelayed} />
            <Stat label="X posts missed" value={inc.impact.postsMissed} />
            <Stat label="Minutes blind" value={inc.impact.minutesBlind} />
          </Box>
        </Section>

        <AiSummaryBox title="First draft from the AI" summary={inc.aiDraft} />

        <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, alignItems: "start" }}>
          <Section title="Cause and fix" id="cause">
            <Box sx={{ display: "grid", gap: 2 }}>
              <EditableText readOnly={readOnly} label="Root cause" value={inc.rootCause} placeholder="Why it happened, in plain words" onSave={(rootCause) => onPatch({ rootCause })} />
              <EditableText readOnly={readOnly} label="Fix" value={inc.fix} placeholder="What was done to fix it" onSave={(fix) => onPatch({ fix })} />
            </Box>
          </Section>
          <Box sx={{ display: "grid", gap: 2 }}>
            <Section title="Follow-ups" id="followups">
              <FollowUps readOnly={readOnly} items={inc.followUps} onSave={(followUps) => onPatch({ followUps })} />
            </Section>
            <Section title="Affected stories" id="slugs">
              {inc.affectedSlugs.length ? (
                <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: 0.5 }}>
                  {inc.affectedSlugs.map((s) => (
                    <li key={s}>
                      <Slug slug={s} />
                    </li>
                  ))}
                </Box>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No stories recorded as affected.
                </Typography>
              )}
              {inc.alertIds.length ? (
                <Box sx={{ mt: 1.5 }}>
                  <EvidenceChips label="Alerts" items={inc.alertIds.map((id) => ({ kind: "alert", id, label: id }))} />
                </Box>
              ) : null}
            </Section>
          </Box>
        </Box>

        <Section title="Timeline" id="timeline">
          {inc.timeline.length ? (
            <Timeline events={inc.timeline} />
          ) : (
            <Typography variant="body2" color="text.secondary">
              Nothing on the timeline yet.
            </Typography>
          )}
          {readOnly ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
              {edit.reason}
            </Typography>
          ) : (
            <NoteForm onAdd={(note) => onPatch({ note })} />
          )}
        </Section>
      </Box>
    </>
  );
}

export default function IncidentView({ id }: { id: string }) {
  const state = useApi(`incident:${id}`, (s) => getIncident(id, s));
  const [err, setErr] = useState<string | null>(null);

  // Never throws: a failed save shows the message above and returns false
  const onPatch = async (p: IncidentPatch): Promise<boolean> => {
    setErr(null);
    try {
      state.mutate(await patchIncident(id, p));
      invalidate("incidents", "overview", "daily:");
      return true;
    } catch (e) {
      setErr((e as Error).message);
      return false;
    }
  };

  return (
    <>
      <Button component={Link} href="/reports?tab=incidents" size="small" startIcon={<ArrowLeft size={14} aria-hidden />} sx={{ mb: 1, ml: -1 }}>
        Incidents
      </Button>
      {err ? (
        <Typography role="alert" variant="body2" sx={{ color: "error.main", mb: 1 }}>
          Could not save: {err}
        </Typography>
      ) : null}
      <AsyncView state={state} what={`incident ${id}`} loading={<LoadingRows rows={4} height={100} />}>
        {(inc) => <IncidentBody inc={inc} onPatch={onPatch} />}
      </AsyncView>
    </>
  );
}
