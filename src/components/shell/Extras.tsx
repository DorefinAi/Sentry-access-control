"use client";

// Shell extras: critical pop-ups and the keyboard shortcuts dialog.
import Link from "next/link";
import { Alert as MuiAlert, Box, Button, Dialog, DialogContent, DialogTitle, Snackbar, Typography } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { useSession } from "@/providers/SessionProvider";
import type { Notification } from "@/types/control";
import { MONO_STACK } from "@/providers/MuiProvider";

/** Pops up each new critical notification once, when the person wants pop-ups. */
export function CriticalToasts() {
  const { notifications, preferences } = useSession();
  const seen = useRef<Set<string> | null>(null);
  const [queue, setQueue] = useState<Notification[]>([]);
  const items = notifications.data?.items;
  const enabled = preferences.notify.critical;

  useEffect(() => {
    if (!items) return;
    // Everything present at first load counts as already seen
    if (seen.current === null) {
      seen.current = new Set(items.map((n) => n.id));
      return;
    }
    const fresh = items.filter((n) => !seen.current!.has(n.id));
    fresh.forEach((n) => seen.current!.add(n.id));
    const critical = fresh.filter((n) => n.severity === "critical" && !n.read);
    if (enabled && critical.length) setQueue((q) => [...q, ...critical]);
  }, [items, enabled]);

  const current = queue[0];
  return (
    <Snackbar open={!!current} anchorOrigin={{ vertical: "bottom", horizontal: "right" }} onClose={(_, why) => why !== "clickaway" && setQueue((q) => q.slice(1))} autoHideDuration={9000} sx={{ mb: 5 }}>
      {current ? (
        <MuiAlert
          severity="error"
          variant="filled"
          onClose={() => setQueue((q) => q.slice(1))}
          action={
            <Button color="inherit" size="small" component={Link} href="/notifications" onClick={() => setQueue((q) => q.slice(1))}>
              Open
            </Button>
          }
          sx={{ maxWidth: 420, alignItems: "center" }}
        >
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {current.title}
          </Typography>
        </MuiAlert>
      ) : undefined}
    </Snackbar>
  );
}

const SHORTCUTS: [string, string][] = [
  ["Ctrl+,  /  ⌘,", "Open Settings"],
  ["?", "Show these shortcuts"],
  ["Esc", "Close a panel, dialog or Settings"],
  ["Tab, Shift+Tab", "Move between controls"],
  ["Arrows on a gauge mark", "Move the warning or danger limit; Shift for 10 steps"],
  ["PageUp / PageDown", "Move a gauge mark 10 steps"],
  ["Arrows on the jog", "Replay 10 minutes back or forward; Shift for 1 hour"],
  ["Home / End on the jog", "Go to 00:00, or back to live"],
];

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 700 }}>Keyboard shortcuts</DialogTitle>
      <DialogContent>
        <Box component="dl" sx={{ m: 0, display: "grid", gridTemplateColumns: "minmax(140px, auto) 1fr", columnGap: 2, rowGap: 1.25 }}>
          {SHORTCUTS.map(([k, v]) => (
            <Box key={k} sx={{ display: "contents" }}>
              <Box component="dt" sx={{ fontFamily: MONO_STACK, fontSize: "0.8125rem", fontWeight: 600 }}>
                {k}
              </Box>
              <Box component="dd" sx={{ m: 0, fontSize: "0.875rem" }}>
                {v}
              </Box>
            </Box>
          ))}
        </Box>
      </DialogContent>
    </Dialog>
  );
}
