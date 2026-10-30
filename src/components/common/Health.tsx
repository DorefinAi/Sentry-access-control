"use client";

// Health and severity always carry an icon shape and a word, so they read without colour.
import { Box, Chip, Theme, useTheme } from "@mui/material";
import { CircleCheck, CircleQuestionMark, CircleX, Info, TriangleAlert } from "lucide-react";
import type { Health, Severity } from "@/types/control";
import { HEALTH_LABELS, SEVERITY_LABELS } from "@/lib/labels";

export function healthColor(theme: Theme, h: Health): string {
  switch (h) {
    case "ok":
      return theme.palette.success.main;
    case "warn":
      return theme.palette.warning.main;
    case "down":
      return theme.palette.error.main;
    default:
      return theme.palette.text.secondary;
  }
}

const ICONS = { ok: CircleCheck, warn: TriangleAlert, down: CircleX, unknown: CircleQuestionMark } as const;

export function HealthIcon({ health, size = 16, title }: { health: Health; size?: number; title?: string }) {
  const theme = useTheme();
  const Icon = ICONS[health];
  return (
    <Box component="span" role="img" aria-label={title ?? HEALTH_LABELS[health]} sx={{ display: "inline-flex", color: healthColor(theme, health), flexShrink: 0 }}>
      <Icon size={size} aria-hidden strokeWidth={2.25} />
    </Box>
  );
}

export function HealthLabel({ health, label, size = "body2" }: { health: Health; label?: string; size?: "body2" | "caption" }) {
  const theme = useTheme();
  return (
    <Box
      component="span"
      sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, color: healthColor(theme, health), fontWeight: 600, fontSize: size === "caption" ? "0.75rem" : "0.8125rem", whiteSpace: "nowrap" }}
    >
      <HealthIcon health={health} size={size === "caption" ? 14 : 16} title="" />
      {label ?? HEALTH_LABELS[health]}
    </Box>
  );
}

const SEV_HEALTH: Record<Severity, Health> = { critical: "down", warning: "warn", info: "unknown" };

export function SeverityChip({ severity }: { severity: Severity }) {
  const theme = useTheme();
  const Icon = severity === "info" ? Info : ICONS[SEV_HEALTH[severity]];
  const color = healthColor(theme, SEV_HEALTH[severity]);
  const solid = severity === "critical";
  return (
    <Chip
      size="small"
      icon={<Icon size={14} aria-hidden />}
      label={SEVERITY_LABELS[severity]}
      variant={solid ? "filled" : "outlined"}
      sx={{
        height: 22,
        fontSize: "0.75rem",
        fontWeight: 600,
        color: solid ? theme.palette.error.contrastText : color,
        bgcolor: solid ? color : "transparent",
        borderColor: color,
        "& .MuiChip-icon": { color: "inherit", ml: "6px" },
      }}
    />
  );
}
