"use client";

import { Box, Checkbox, FormControlLabel, Switch, Typography } from "@mui/material";
import { useState } from "react";
import type { NotificationKind } from "@/types/control";
import { useSession } from "@/providers/SessionProvider";
import { Result, SettingsSection } from "./parts";

const KINDS: { kind: NotificationKind; label: string; hint: string }[] = [
  { kind: "alert_fired", label: "Alerts that fire", hint: "Something crossed a line and needs a look." },
  { kind: "alert_resolved", label: "Alerts that resolve", hint: "A problem cleared, by itself or by someone." },
  { kind: "incident_opened", label: "Incidents opened", hint: "Someone opened an incident, or one opened itself." },
  { kind: "incident_resolved", label: "Incidents resolved", hint: "An incident was closed." },
  { kind: "code_change", label: "Code changes", hint: "New code reached one of the systems." },
  { kind: "login_unusual", label: "Unusual sign-ins", hint: "A new IP, odd hours, or repeated failures." },
  { kind: "backup", label: "Backups", hint: "The nightly backup ran, or did not." },
  { kind: "report_ready", label: "Reports ready", hint: "The daily report is written." },
  { kind: "team_change", label: "Team and threshold changes", hint: "Accounts added or changed, gauge limits moved." },
];

export function NotificationsTab() {
  const { preferences, savePreferences } = useSession();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const kinds = preferences.notify.kinds;

  const save = async (patch: { kinds?: NotificationKind[]; critical?: boolean }) => {
    const err = await savePreferences({ notify: patch });
    setMsg(err ? { ok: false, text: `Not saved: ${err}` } : { ok: true, text: "Saved." });
  };
  const toggle = (k: NotificationKind) => save({ kinds: kinds.includes(k) ? kinds.filter((x) => x !== k) : [...kinds, k] });

  return (
    <Box sx={{ display: "grid", gap: 3 }}>
      <SettingsSection title="Show in the bell" hint="Unticked kinds still happen and still appear on their own screens; they just stay out of your bell.">
        <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: 0.25 }}>
          {KINDS.map((k) => (
            <Box component="li" key={k.kind} sx={{ borderBottom: 1, borderColor: "divider", py: 0.5 }}>
              <FormControlLabel
                control={<Checkbox size="small" checked={kinds.includes(k.kind)} onChange={() => toggle(k.kind)} />}
                label={
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {k.label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {k.hint}
                    </Typography>
                  </Box>
                }
                sx={{ alignItems: "flex-start", m: 0, "& .MuiCheckbox-root": { mt: -0.5 } }}
              />
            </Box>
          ))}
        </Box>
      </SettingsSection>
      <SettingsSection title="Pop-ups">
        <FormControlLabel
          control={<Switch checked={preferences.notify.critical} onChange={(e) => save({ critical: e.target.checked })} />}
          label={
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                Pop up critical notifications
              </Typography>
              <Typography variant="caption" color="text.secondary">
                A short message in the corner when something critical arrives, on any screen.
              </Typography>
            </Box>
          }
          sx={{ alignItems: "flex-start", m: 0 }}
        />
      </SettingsSection>
      <Result msg={msg} />
    </Box>
  );
}
