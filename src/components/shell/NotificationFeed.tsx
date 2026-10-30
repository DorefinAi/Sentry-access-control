"use client";

import Link from "next/link";
import { Box, Button, Typography } from "@mui/material";
import { CheckCheck } from "lucide-react";
import type { Notification } from "@/types/control";
import { useSession } from "@/providers/SessionProvider";
import { NOTIFICATION_KIND_LABELS } from "@/lib/labels";
import { SeverityChip } from "@/components/common/Health";
import { ConsoleLabel, EvidenceChips, RelTime } from "@/components/common/Bits";
import { EmptyNote, ErrorNote, LoadingRows } from "@/components/common/AsyncView";

function Item({ n, onRead }: { n: Notification; onRead: (id: string) => void }) {
  return (
    <Box
      component="li"
      // Following any link inside counts as reading it
      onClickCapture={(e) => {
        if (!n.read && (e.target as HTMLElement).closest("a")) onRead(n.id);
      }}
      sx={{ position: "relative", py: 1.25, pl: 2, pr: 1, "& + &": { borderTop: 1, borderColor: "divider" } }}
    >
      {/* Unread marker: a brand bar plus the word, so it reads without colour */}
      {!n.read ? <Box aria-hidden sx={{ position: "absolute", left: 0, top: 12, bottom: 12, width: 3, borderRadius: 2, bgcolor: "primary.main" }} /> : null}
      <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap", mb: 0.25 }}>
        <SeverityChip severity={n.severity} />
        <ConsoleLabel>{NOTIFICATION_KIND_LABELS[n.kind] ?? n.kind}</ConsoleLabel>
        <Typography variant="caption" color="text.secondary" sx={{ ml: "auto" }}>
          <RelTime iso={n.at} />
        </Typography>
      </Box>
      <Typography variant="body2" sx={{ fontWeight: n.read ? 400 : 600 }}>
        {!n.read ? <Box component="span" sx={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>Unread: </Box> : null}
        {n.title}
      </Typography>
      {n.body ? (
        <Typography variant="body2" color="text.secondary">
          {n.body}
        </Typography>
      ) : null}
      <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap", mt: 0.75 }}>
        <EvidenceChips items={n.evidence} />
        {!n.read ? (
          <Button size="small" onClick={() => onRead(n.id)} sx={{ minHeight: 26, ml: "auto" }}>
            Mark read
          </Button>
        ) : null}
      </Box>
    </Box>
  );
}

/** The notification list with its own mark-all action. `limit` trims it for the header panel. */
export function NotificationFeed({ limit, onNavigate }: { limit?: number; onNavigate?: () => void }) {
  const { notifications, markRead, markAllRead } = useSession();
  const { data, error, reload } = notifications;
  if (!data) return error ? <ErrorNote error={error} what="notifications" onRetry={reload} /> : <LoadingRows rows={4} height={64} />;
  const items = limit ? data.items.slice(0, limit) : data.items;
  return (
    <Box onClick={(e) => (e.target as HTMLElement).closest("a") && onNavigate?.()}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }} aria-live="polite">
          {data.unread ? `${data.unread} unread` : "All read"}
        </Typography>
        <Button size="small" variant="outlined" disabled={!data.unread} onClick={markAllRead} startIcon={<CheckCheck size={14} aria-hidden />}>
          Mark all read
        </Button>
      </Box>
      {items.length ? (
        <Box component="ul" aria-label="Notifications" sx={{ listStyle: "none", m: 0, p: 0 }}>
          {items.map((n) => (
            <Item key={n.id} n={n} onRead={(id) => markRead([id])} />
          ))}
        </Box>
      ) : (
        <EmptyNote>Nothing yet. Alerts, incidents, code changes and unusual sign-ins land here.</EmptyNote>
      )}
      {limit && data.items.length > limit ? (
        <Box sx={{ mt: 1.5 }}>
          <Button component={Link} href="/notifications" size="small" variant="outlined" fullWidth>
            See all {data.items.length}
          </Button>
        </Box>
      ) : null}
    </Box>
  );
}
