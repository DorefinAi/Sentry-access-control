"use client";

import { Box, Button, TextField, Typography } from "@mui/material";
import { FormEvent, useState } from "react";
import { patchMe } from "@/lib/api";
import { clockOffset } from "@/lib/clock";
import { counter, exactIst } from "@/lib/time";
import { ROLE_LABELS } from "@/lib/roles";
import { useSecondClock } from "@/hooks/useNow";
import { useSession } from "@/providers/SessionProvider";
import { ConsoleLabel, EvidenceChips, Raw, RelTime } from "@/components/common/Bits";
import { ErrorNote, LoadingRows } from "@/components/common/AsyncView";
import { DISPLAY_STACK, MONO_STACK } from "@/providers/MuiProvider";
import { Initials, RoleBadge, SettingsSection } from "./parts";

function ShiftCounter({ since }: { since: string }) {
  const now = useSecondClock();
  // Sign-in times are real; the second clock runs on the server's (possibly frozen) time
  return <>{now ? counter((now - clockOffset() - Date.parse(since)) / 1000) : "--:--:--"}</>;
}

export function ProfileTab() {
  const { me, role } = useSession();
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const p = me.data;
  if (!p) return me.error ? <ErrorNote error={me.error} what="your profile" onRetry={me.reload} /> : <LoadingRows rows={4} />;

  const draft = name ?? p.name;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim() || draft.trim() === p.name) return;
    setBusy(true);
    setMsg(null);
    try {
      me.mutate(await patchMe({ name: draft.trim() }));
      setName(null);
      setMsg({ ok: true, text: "Name saved." });
    } catch (e2) {
      setMsg({ ok: false, text: (e2 as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const actions: [string, number][] = [
    ["Acked", p.actionsToday.acked],
    ["Resolved", p.actionsToday.resolved],
    ["Incidents", p.actionsToday.incidentsOpened],
    ["Notes", p.actionsToday.notes],
  ];

  return (
    <Box sx={{ display: "grid", gap: 3 }}>
      <Box sx={{ display: "flex", gap: 2, alignItems: "center" }}>
        <Initials text={p.initials} size={60} />
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontFamily: DISPLAY_STACK, fontWeight: 600, fontSize: "1.375rem", lineHeight: 1.2 }}>{p.name}</Typography>
          <Box sx={{ display: "flex", gap: 1, alignItems: "center", mt: 0.5, flexWrap: "wrap" }}>
            {role ? <RoleBadge role={role} /> : null}
            <Raw>{p.username}</Raw>
            <Typography variant="body2" color="text.secondary">
              {p.role}
            </Typography>
          </Box>
        </Box>
      </Box>

      <SettingsSection title="Display name" hint="How you appear to the team in notes and timelines.">
        <Box component="form" onSubmit={save} sx={{ display: "flex", gap: 1, alignItems: "flex-start", flexWrap: "wrap" }}>
          <TextField size="small" value={draft} onChange={(e) => setName(e.target.value)} slotProps={{ htmlInput: { "aria-label": "Display name", maxLength: 60 } }} sx={{ flex: "1 1 220px" }} />
          <Button type="submit" variant="contained" disabled={busy || !draft.trim() || draft.trim() === p.name}>
            {busy ? "Saving…" : "Save name"}
          </Button>
        </Box>
        {msg ? (
          <Typography role={msg.ok ? "status" : "alert"} variant="body2" sx={{ mt: 1, color: msg.ok ? "success.main" : "error.main" }}>
            {msg.text}
          </Typography>
        ) : null}
      </SettingsSection>

      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" } }}>
        <Box>
          <ConsoleLabel component="p">On shift</ConsoleLabel>
          <Typography sx={{ fontFamily: MONO_STACK, fontSize: "1.5rem", fontWeight: 500 }}>
            <ShiftCounter since={p.onShiftSince} />
          </Typography>
          <Typography variant="caption" color="text.secondary" title={exactIst(p.onShiftSince)}>
            signed in <RelTime iso={p.onShiftSince} />
          </Typography>
        </Box>
        <Box>
          <ConsoleLabel component="p">Last sign-in before this one</ConsoleLabel>
          {p.lastLogin ? (
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              <RelTime iso={p.lastLogin.at} /> from <Raw>{p.lastLogin.ip}</Raw>
            </Typography>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              This is your first sign-in.
            </Typography>
          )}
        </Box>
      </Box>

      <SettingsSection title="Today">
        <Box component="dl" sx={{ m: 0, display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 1 }}>
          {actions.map(([label, n]) => (
            <Box key={label} sx={{ border: 1, borderColor: "divider", borderRadius: "2px", p: 1.25, textAlign: "center", bgcolor: "var(--ops-screen)" }}>
              <Typography component="dd" sx={{ m: 0, fontFamily: DISPLAY_STACK, fontSize: "1.5rem", fontWeight: 600 }}>
                {n}
              </Typography>
              <Typography component="dt" variant="caption" color="text.secondary">
                {label}
              </Typography>
            </Box>
          ))}
        </Box>
      </SettingsSection>

      <SettingsSection title="Recent activity">
        {p.recent.length ? (
          <Box component="ol" sx={{ listStyle: "none", m: 0, p: 0 }}>
            {p.recent.map((r, i) => (
              <Box component="li" key={i} sx={{ display: "grid", gridTemplateColumns: "88px 1fr", gap: 1.5, py: 1, "& + &": { borderTop: 1, borderColor: "divider" } }}>
                <Typography variant="caption" color="text.secondary" sx={{ pt: "2px" }}>
                  <RelTime iso={r.at} />
                </Typography>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2">{r.text}</Typography>
                  {r.evidence?.length ? (
                    <Box sx={{ mt: 0.5 }}>
                      <EvidenceChips items={r.evidence} />
                    </Box>
                  ) : null}
                </Box>
              </Box>
            ))}
          </Box>
        ) : (
          <Typography variant="body2" color="text.secondary">
            Nothing done yet this shift.
          </Typography>
        )}
      </SettingsSection>
      <Typography variant="caption" color="text.secondary">
        Role: {role ? ROLE_LABELS[role] : "unknown"}. Ask an admin to change it.
      </Typography>
    </Box>
  );
}
