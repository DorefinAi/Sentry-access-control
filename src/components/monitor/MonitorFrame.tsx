"use client";

// Shared frame for the monitor screens (Overview, Pipelines, Systems, Telemetry):
// loading and error states, the replay banner, and the board to draw.
import { Box, Button, Skeleton, Typography } from "@mui/material";
import { Radio } from "lucide-react";
import type { ReactNode } from "react";
import { useBoards } from "@/providers/OverviewProvider";
import type { Overview } from "@/types/control";
import { hmIst } from "@/lib/time";
import { PageHeader } from "@/components/common/Bits";
import { ErrorNote, LoadingRows } from "@/components/common/AsyncView";
import { DISPLAY_STACK, MONO_STACK } from "@/providers/MuiProvider";

export function ReplayBanner() {
  const { replayAt, replay, setReplay } = useBoards();
  if (!replayAt) return null;
  const loading = !!replay && !replay.data && !replay.error;
  return (
    <Box
      role="status"
      sx={{
        position: "sticky",
        top: 64,
        zIndex: 6,
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        flexWrap: "wrap",
        px: 2,
        py: 1,
        border: 2,
        borderColor: "primary.main",
        borderRadius: "2px",
        bgcolor: "background.paper",
      }}
    >
      <Typography component="p" sx={{ fontFamily: DISPLAY_STACK, fontWeight: 700, letterSpacing: "0.12em", color: "primary.main" }}>
        REPLAY{" "}
        <Box component="span" sx={{ fontFamily: MONO_STACK, letterSpacing: 0 }}>
          {hmIst(replayAt)}
        </Box>
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        Not live. {loading ? "Loading that moment…" : "Every monitor screen shows how things stood then."}
      </Typography>
      <Button variant="contained" size="small" onClick={() => setReplay(null)} startIcon={<Radio size={14} aria-hidden />} sx={{ ml: "auto" }}>
        Back to live
      </Button>
    </Box>
  );
}

export function MonitorFrame({ title, subtitle, header, skeleton, children }: { title: string; subtitle?: string; header?: boolean; skeleton?: ReactNode; children: (board: Overview, live: Overview) => ReactNode }) {
  const { live, board, replayAt, replay } = useBoards();
  if (!live.data || !board) {
    return (
      <>
        <PageHeader title={title} subtitle={subtitle} />
        {live.error ? <ErrorNote error={live.error} what={title.toLowerCase()} onRetry={live.reload} /> : (skeleton ?? <LoadingRows rows={3} height={160} />)}
      </>
    );
  }
  return (
    <Box sx={{ display: "grid", gap: header === false ? 1.5 : 2 }}>
      {header === false ? null : <PageHeader title={title} subtitle={subtitle} />}
      <ReplayBanner />
      {replayAt && replay?.error ? <ErrorNote error={replay.error} what={`the board at ${hmIst(replayAt)}`} onRetry={replay.reload} /> : null}
      <Box sx={{ display: "grid", gap: header === false ? 1.5 : 2, opacity: replayAt && !replay?.data ? 0.55 : 1, transition: "opacity 200ms" }}>{children(board, live.data)}</Box>
    </Box>
  );
}

export function WallSkeleton() {
  return (
    <Box sx={{ display: "grid", gap: 2 }}>
      <Skeleton variant="rectangular" height={150} />
      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", lg: "2fr 1fr" } }}>
        <Skeleton variant="rectangular" height={300} />
        <Skeleton variant="rectangular" height={300} />
      </Box>
    </Box>
  );
}
