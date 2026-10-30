"use client";

import { Box, Typography, useTheme } from "@mui/material";
import { ExternalLink, KeyRound } from "lucide-react";
import type { LauncherApp } from "@/types/control";
import { HealthLabel, healthColor } from "@/components/common/Health";
import { ConsoleLabel, Raw } from "@/components/common/Bits";
import { DISPLAY_STACK } from "@/providers/MuiProvider";

function Tile({ app, current }: { app: LauncherApp; current: boolean }) {
  const theme = useTheme();
  const color = healthColor(theme, app.health);
  return (
    <Box
      component="a"
      href={app.url}
      // Sentry itself opens in place; the other products open beside it
      target={current ? undefined : "_blank"}
      rel={current ? undefined : "noopener noreferrer"}
      sx={{
        display: "grid",
        gap: 1,
        alignContent: "start",
        p: 2,
        border: 1,
        borderColor: "divider",
        borderRadius: "6px",
        bgcolor: "background.paper",
        color: "text.primary",
        textDecoration: "none",
        position: "relative",
        boxShadow: `inset 0 2px 0 ${color}`,
        transition: "border-color 120ms",
        "&:hover": { borderColor: "primary.main" },
        "&:hover .open": { color: "primary.main" },
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <ConsoleLabel>{app.product}</ConsoleLabel>
        <Box sx={{ ml: "auto" }}>
          <HealthLabel health={app.health} size="caption" />
        </Box>
      </Box>
      <Typography sx={{ fontFamily: DISPLAY_STACK, fontSize: "1.25rem", fontWeight: 600, lineHeight: 1.2 }}>{app.name}</Typography>
      <Typography variant="body2" color="text.secondary">
        {app.description}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 500 }}>
        {app.detail}
      </Typography>
      <Box sx={{ display: "flex", gap: 0.75, alignItems: "flex-start", color: "text.secondary" }}>
        <KeyRound size={14} aria-hidden style={{ marginTop: 3, flexShrink: 0 }} />
        <Typography variant="caption">{app.signIn}</Typography>
      </Box>
      <Box className="open" sx={{ display: "flex", alignItems: "center", gap: 0.5, color: "text.secondary", fontSize: "0.8125rem", fontWeight: 600, mt: 0.5 }}>
        {current ? "Go to Sentry" : "Open in a new tab"}
        {current ? null : <ExternalLink size={14} aria-hidden />}
        <Raw sx={{ ml: "auto" }}>{app.url.replace(/^https?:\/\//, "")}</Raw>
      </Box>
    </Box>
  );
}

/** The four newsroom products, each with a live health light. */
export function LauncherGrid({ apps }: { apps: LauncherApp[] }) {
  return (
    <Box>
      <Box component="ul" aria-label="Apps" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: 1.5, gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 250px), 1fr))" }}>
        {apps.map((a) => (
          <li key={a.id} style={{ display: "grid" }}>
            <Tile app={a} current={a.id === "sentry"} />
          </li>
        ))}
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
        Each product keeps its own sign-in for now. Signing in here does not sign you in there; single sign-on is not built yet.
      </Typography>
    </Box>
  );
}
