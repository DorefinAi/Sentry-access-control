"use client";

import { Box, FormControl, MenuItem, Select, Typography } from "@mui/material";
import { useState } from "react";
import type { LandingPage, Preferences } from "@/types/control";
import { useSession } from "@/providers/SessionProvider";
import { TOKENS } from "@/providers/MuiProvider";
import { Result, SettingsSection } from "./parts";

const LANDING: { value: LandingPage; label: string }[] = [
  { value: "/", label: "Overview" },
  { value: "/pipelines", label: "Pipelines" },
  { value: "/alerts", label: "Alerts" },
  { value: "/logs", label: "Logs" },
];

/** A tiny picture of the console in one theme: header, rail, a panel and a dial. */
function Preview({ mode }: { mode: "dark" | "light" }) {
  const t = TOKENS[mode];
  return (
    <Box aria-hidden component="svg" viewBox="0 0 120 72" sx={{ width: "100%", display: "block", borderRadius: "3px" }}>
      <rect width="120" height="72" fill={t.ground} />
      <rect width="120" height="10" fill={t.panel} />
      <rect x="0" y="10" width="22" height="62" fill={t.panel} />
      <rect x="28" y="16" width="86" height="22" fill={t.panel} stroke={t.line} />
      <rect x="28" y="16" width="86" height="2" fill={t.warn} />
      <rect x="28" y="44" width="40" height="24" fill={t.panel} stroke={t.line} />
      <circle cx="48" cy="56" r="8" fill={t.screen} stroke={t.bezel} />
      <rect x="74" y="44" width="40" height="24" fill={t.panel} stroke={t.line} />
      <path d="M78 62 L86 56 L94 59 L102 50 L110 53" fill="none" stroke={t.brand} strokeWidth="1.5" />
      <rect x="4" y="15" width="14" height="2" fill={t.dim} />
      <rect x="4" y="21" width="14" height="2" fill={t.brand} />
      <rect x="4" y="27" width="14" height="2" fill={t.dim} />
    </Box>
  );
}

function ChoiceCard({ selected, label, hint, onClick, children }: { selected: boolean; label: string; hint: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Box
      component="button"
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      sx={{
        all: "unset",
        boxSizing: "border-box",
        cursor: "pointer",
        display: "grid",
        gap: 1,
        p: 1,
        borderRadius: "4px",
        border: 2,
        borderColor: selected ? "primary.main" : "divider",
        bgcolor: "background.paper",
        "&:hover": { borderColor: selected ? "primary.main" : "text.secondary" },
        "&:focus-visible": { outline: "2px solid var(--focus-ring)", outlineOffset: 2 },
      }}
    >
      {children}
      <Box>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {label} {selected ? <Box component="span" sx={{ color: "primary.main", fontWeight: 500 }}>(in use)</Box> : null}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {hint}
        </Typography>
      </Box>
    </Box>
  );
}

export function AppearanceTab() {
  const { preferences, savePreferences } = useSession();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = async (patch: Partial<Preferences>) => {
    const err = await savePreferences(patch);
    setMsg(err ? { ok: false, text: `Not saved: ${err}` } : { ok: true, text: "Saved." });
  };

  return (
    <Box sx={{ display: "grid", gap: 3 }}>
      <SettingsSection title="Theme" hint="The night ops room, the daylight ops room, or whatever this computer uses.">
        <Box role="radiogroup" aria-label="Theme" sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr 1fr", sm: "repeat(3, 1fr)" } }}>
          <ChoiceCard selected={preferences.theme === "dark"} label="Dark" hint="Night ops room" onClick={() => save({ theme: "dark" })}>
            <Preview mode="dark" />
          </ChoiceCard>
          <ChoiceCard selected={preferences.theme === "light"} label="Light" hint="Daylight ops room" onClick={() => save({ theme: "light" })}>
            <Preview mode="light" />
          </ChoiceCard>
          <ChoiceCard selected={preferences.theme === "system"} label="System" hint="Follows this computer" onClick={() => save({ theme: "system" })}>
            <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderRadius: "3px", overflow: "hidden" }}>
              <Box sx={{ overflow: "hidden" }}>
                <Preview mode="dark" />
              </Box>
              <Box sx={{ overflow: "hidden", direction: "rtl" }}>
                <Preview mode="light" />
              </Box>
            </Box>
          </ChoiceCard>
        </Box>
      </SettingsSection>

      <SettingsSection title="Density" hint="Compact fits more on a screen; comfortable is easier on a long shift.">
        <Box role="radiogroup" aria-label="Density" sx={{ display: "grid", gap: 1.5, gridTemplateColumns: "1fr 1fr", maxWidth: 420 }}>
          {(["comfortable", "compact"] as const).map((d) => (
            <ChoiceCard key={d} selected={preferences.density === d} label={d === "compact" ? "Compact" : "Comfortable"} hint={d === "compact" ? "Tighter spacing" : "The default spacing"} onClick={() => save({ density: d })}>
              <Box aria-hidden sx={{ display: "grid", gap: d === "compact" ? "3px" : "6px", py: 0.5 }}>
                {[0, 1, 2, 3].map((i) => (
                  <Box key={i} sx={{ height: 6, borderRadius: "1px", bgcolor: i === 1 ? "primary.main" : "divider", width: `${90 - i * 12}%` }} />
                ))}
              </Box>
            </ChoiceCard>
          ))}
        </Box>
      </SettingsSection>

      <SettingsSection title="Start on" hint="The screen Sentry opens after you sign in.">
        <FormControl size="small" sx={{ maxWidth: 260 }}>
          <Select value={preferences.defaultLanding} onChange={(e) => save({ defaultLanding: e.target.value as LandingPage })} inputProps={{ "aria-label": "Start on" }}>
            {LANDING.map((l) => (
              <MenuItem key={l.value} value={l.value}>
                {l.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </SettingsSection>
      <Result msg={msg} />
    </Box>
  );
}
