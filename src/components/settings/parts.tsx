"use client";

// Small pieces shared by the Settings tabs and the profile button.
import { Box, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { ROLE_LABELS, RoleId } from "@/lib/roles";
import { DISPLAY_STACK } from "@/providers/MuiProvider";

export function Initials({ text, size = 36 }: { text: string; size?: number }) {
  return (
    <Box
      aria-hidden
      sx={{
        width: size,
        height: size,
        borderRadius: "4px",
        border: 1,
        borderColor: "primary.main",
        color: "primary.main",
        bgcolor: "var(--ops-screen)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: DISPLAY_STACK,
        fontWeight: 700,
        fontSize: size * 0.38,
        letterSpacing: "0.04em",
        flexShrink: 0,
      }}
    >
      {text}
    </Box>
  );
}

export function RoleBadge({ role }: { role: RoleId }) {
  const strong = role !== "viewer";
  return (
    <Box
      component="span"
      sx={{
        px: 0.75,
        py: "1px",
        borderRadius: "2px",
        border: 1,
        borderColor: strong ? "primary.main" : "divider",
        color: strong ? "primary.main" : "text.secondary",
        fontFamily: DISPLAY_STACK,
        fontWeight: 700,
        fontSize: "0.6875rem",
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        lineHeight: 1.6,
        whiteSpace: "nowrap",
      }}
    >
      {ROLE_LABELS[role]}
    </Box>
  );
}

export function SettingsSection({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Box component="section" sx={{ display: "grid", gap: 1.25 }}>
      <Box>
        <Typography component="h3" sx={{ fontWeight: 600, fontSize: "0.9375rem" }}>
          {title}
        </Typography>
        {hint ? (
          <Typography variant="body2" color="text.secondary">
            {hint}
          </Typography>
        ) : null}
      </Box>
      {children}
    </Box>
  );
}

/** A plain result line under a form: saved, or what went wrong. */
export function Result({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return (
    <Typography role={msg.ok ? "status" : "alert"} variant="body2" sx={{ color: msg.ok ? "success.main" : "error.main", fontWeight: 500 }}>
      {msg.text}
    </Typography>
  );
}
