"use client";

// The console's panel: a hairline frame with registration marks at the corners,
// a designation strip ("PANEL 02 · TELEMETRY"), and an optional inset screen.
// Depth comes from layered surfaces (ground, panel, screen), never drop shadows.
import { Box, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
import type { ReactNode } from "react";
import { DISPLAY_STACK, MONO_STACK } from "@/providers/MuiProvider";

const corner = (v: "top" | "bottom", h: "left" | "right") => ({
  content: '""',
  position: "absolute",
  width: 7,
  height: 7,
  [v]: -1,
  [h]: -1,
  [`border${v === "top" ? "Top" : "Bottom"}`]: "1.5px solid var(--ops-dim)",
  [`border${h === "left" ? "Left" : "Right"}`]: "1.5px solid var(--ops-dim)",
  opacity: 0.7,
  pointerEvents: "none",
});

/** Registration marks at the four corners of whatever contains them. */
export function CornerMarks() {
  return (
    <Box aria-hidden sx={{ position: "absolute", inset: 0, pointerEvents: "none", "&::before": corner("top", "left"), "&::after": corner("bottom", "right") }}>
      <Box sx={{ position: "absolute", inset: 0, "&::before": corner("top", "right"), "&::after": corner("bottom", "left") }} />
    </Box>
  );
}

/** An inset display surface: darker in the night room, with faint scanlines. */
export const screenSx = {
  bgcolor: "var(--ops-screen)",
  backgroundImage: "var(--ops-scan)",
  border: 1,
  borderColor: "divider",
  borderRadius: "4px",
} as const;

export function Panel({
  n,
  title,
  id,
  action,
  children,
  sx,
  bodySx,
}: {
  n?: number; // the panel number on the wall; omit on ordinary pages
  title: string;
  id?: string;
  action?: ReactNode;
  children: ReactNode;
  sx?: SxProps<Theme>;
  bodySx?: SxProps<Theme>;
}) {
  const headId = id ? `${id}-h` : undefined;
  return (
    <Box component="section" aria-labelledby={headId} sx={{ position: "relative", border: 1, borderColor: "divider", borderRadius: "2px", bgcolor: "background.paper", minWidth: 0, ...sx }}>
      <CornerMarks />
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: { xs: 1.5, sm: 2 }, minHeight: 34, borderBottom: 1, borderColor: "divider", flexWrap: "wrap" }}>
        <Typography component="h2" id={headId} sx={{ fontFamily: DISPLAY_STACK, fontSize: "0.75rem", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "text.secondary", flex: 1, minWidth: 0, py: 0.75 }}>
          {n !== undefined ? (
            <Box component="span" sx={{ fontFamily: MONO_STACK, fontWeight: 500, letterSpacing: "0.04em", mr: 1, color: "text.secondary", opacity: 0.75 }}>
              PANEL {String(n).padStart(2, "0")}
            </Box>
          ) : null}
          <Box component="span" sx={{ color: "text.primary" }}>
            {title}
          </Box>
        </Typography>
        {action}
      </Box>
      <Box sx={{ p: { xs: 1.5, sm: 2 }, ...bodySx }}>{children}</Box>
    </Box>
  );
}
