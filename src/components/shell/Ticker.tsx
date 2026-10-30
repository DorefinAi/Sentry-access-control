"use client";

// The event ticker along the bottom of the console: the newest notifications,
// sliding right to left. Hover or keyboard focus pauses it; under reduced motion
// it stands still and scrolls by hand.
import Link from "next/link";
import { Box } from "@mui/material";
import { useSession } from "@/providers/SessionProvider";
import { hmIst } from "@/lib/time";
import { DISPLAY_STACK, MONO_STACK } from "@/providers/MuiProvider";
import type { Notification } from "@/types/control";

const TONE = { critical: "error.main", warning: "warning.main", info: "text.secondary" } as const;

function Items({ items, hidden }: { items: Notification[]; hidden?: boolean }) {
  return (
    <Box component="ul" aria-hidden={hidden || undefined} sx={{ listStyle: "none", m: 0, p: 0, display: "flex", flexShrink: 0 }}>
      {items.map((n) => (
        <Box component="li" key={n.id} sx={{ display: "flex", alignItems: "baseline", gap: 1, px: 2.5, whiteSpace: "nowrap", borderRight: 1, borderColor: "divider" }}>
          <Box component="time" dateTime={n.at} sx={{ fontFamily: MONO_STACK, fontSize: "0.75rem", color: TONE[n.severity] }}>
            {hmIst(n.at)}
          </Box>
          <Box component={Link} href="/notifications" tabIndex={hidden ? -1 : 0} sx={{ fontSize: "0.8125rem", color: "text.primary", textDecoration: "none", "&:hover": { textDecoration: "underline" } }}>
            {n.title}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

export function Ticker() {
  const { notifications } = useSession();
  const items = (notifications.data?.items ?? []).slice(0, 14);
  if (!items.length) return null;
  // About 6 s per item keeps every line readable as it passes
  const duration = Math.max(40, items.length * 6);
  return (
    <Box
      component="aside"
      aria-label="Latest events"
      sx={{
        position: "sticky",
        bottom: 0,
        zIndex: 4,
        height: 34,
        display: "flex",
        alignItems: "stretch",
        borderTop: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
        backgroundImage: "var(--ops-scan)",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", px: 1.5, borderRight: 1, borderColor: "divider", fontFamily: DISPLAY_STACK, fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.12em", color: "primary.main", flexShrink: 0 }}>
        EVENTS
      </Box>
      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          "&:hover .track, &:focus-within .track": { animationPlayState: "paused" },
          "@media (prefers-reduced-motion: reduce)": { overflowX: "auto", "& .track": { animation: "none !important" }, "& .dup": { display: "none" } },
        }}
      >
        <Box className="track" sx={{ display: "flex", width: "max-content", animation: `ticker ${duration}s linear infinite` }}>
          <Items items={items} />
          {/* the second copy makes the loop seamless; screen readers skip it */}
          <Box className="dup" sx={{ display: "flex" }}>
            <Items items={items} hidden />
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
