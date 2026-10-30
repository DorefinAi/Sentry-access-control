"use client";

// The detail screens behind Overview. Each reads the shared board, so a replay
// started on any of them shows the same moment everywhere.
import { Box, Typography } from "@mui/material";
import Link from "next/link";
import { useBoards } from "@/providers/OverviewProvider";
import { useSession } from "@/providers/SessionProvider";
import { hmIst } from "@/lib/time";
import { Panel } from "@/components/common/Panel";
import { EmptyNote } from "@/components/common/AsyncView";
import { SeverityChip } from "@/components/common/Health";
import { EvidenceChips } from "@/components/common/Bits";
import { PipelineStrip } from "@/components/status/PipelineStrip";
import { FixList } from "@/components/status/FixList";
import { SystemsGrid } from "@/components/status/SystemsGrid";
import { StackUptimePanel } from "@/components/status/Summary";
import { TelemetryChart, blindRuns } from "@/components/status/TelemetryChart";
import { JogWheel } from "@/components/knob/JogWheel";
import { MonitorFrame } from "./MonitorFrame";
import { outageMarks } from "./OverviewView";
import { MONO_STACK } from "@/providers/MuiProvider";

export function PipelinesView() {
  return (
    <MonitorFrame title="Pipelines" subtitle="Each story moves left to right. Packets show the flow; a stage holding work glows and piles up. Tap a stage for its systems and logs.">
      {(o) => (
        <>
          {o.pipelines.map((p, i) => (
            <Panel key={p.id} n={i + 1} title={p.name} id={`pl-panel-${p.id}`}>
              <PipelineStrip pipeline={p} />
            </Panel>
          ))}
          <Panel n={o.pipelines.length + 1} title="What to fix" id="fixes">
            {o.fixes.length ? <FixList fixes={o.fixes} /> : <EmptyNote>Nothing to fix right now.</EmptyNote>}
          </Panel>
        </>
      )}
    </MonitorFrame>
  );
}

export function SystemsIndexView() {
  const { replayAt } = useBoards();
  return (
    <MonitorFrame title="Systems" subtitle="Every system with its current streak, 7-day uptime and one line on what it is doing. Open one for its numbers, queues and logs.">
      {(o) => (
        <>
          <StackUptimePanel n={1} u={o.uptime} asOf={o.asOf} replay={!!replayAt} />
          <Panel n={2} title="Telemetry grid" id="systems">
            {o.systems.length ? <SystemsGrid systems={o.systems} streaks={o.streaks} /> : <EmptyNote>No systems reported in.</EmptyNote>}
          </Panel>
        </>
      )}
    </MonitorFrame>
  );
}

export function TelemetryView() {
  const { replayAt, setReplay } = useBoards();
  const { notifications } = useSession();
  return (
    <MonitorFrame title="Telemetry" subtitle="Stories in, errors and Octopus polls for today, in 10-minute buckets. Turn the jog to replay any moment.">
      {(o, live) => {
        const blinds = blindRuns(live.telemetry);
        const until = Date.parse(o.asOf);
        const events = (notifications.data?.items ?? []).filter((n) => Date.parse(n.at) <= until).slice(0, 12);
        return (
          <>
            <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1fr) 300px" }, alignItems: "start" }}>
              <Panel n={1} title="Telemetry" id="telemetry">
                <TelemetryChart points={live.telemetry} liveAsOf={live.asOf} replayAt={replayAt} />
                {blinds.length ? (
                  <Typography variant="body2" sx={{ mt: 1.5 }}>
                    <Box component="span" sx={{ color: "error.main", fontWeight: 600 }}>
                      Blind spot:
                    </Box>{" "}
                    Octopus did not poll the feed {blinds.map((b) => `${hmIst(b.from)} to ${hmIst(b.to)}`).join(" and ")}. Stories filed then reached Octopus late.
                  </Typography>
                ) : null}
              </Panel>
              <Panel n={2} title="Replay" id="replay">
                <JogWheel liveAsOf={live.asOf} replayAt={replayAt} marks={outageMarks(live)} onScrub={setReplay} />
              </Panel>
            </Box>
            <Panel n={3} title={replayAt ? `Events up to ${hmIst(replayAt)}` : "Events"} id="events">
              {events.length ? (
                <Box component="ol" sx={{ listStyle: "none", m: 0, p: 0 }}>
                  {events.map((n) => (
                    <Box component="li" key={n.id} sx={{ display: "grid", gridTemplateColumns: { xs: "52px 1fr", sm: "60px 96px 1fr" }, gap: 1.5, alignItems: "baseline", py: 1, "& + &": { borderTop: 1, borderColor: "divider" } }}>
                      <Box component="time" dateTime={n.at} sx={{ fontFamily: MONO_STACK, fontSize: "0.8125rem" }}>
                        {hmIst(n.at)}
                      </Box>
                      <Box sx={{ display: { xs: "none", sm: "block" } }}>
                        <SeverityChip severity={n.severity} />
                      </Box>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                          {n.title}
                        </Typography>
                        {n.evidence.length ? (
                          <Box sx={{ mt: 0.5 }}>
                            <EvidenceChips items={n.evidence} />
                          </Box>
                        ) : null}
                      </Box>
                    </Box>
                  ))}
                </Box>
              ) : (
                <EmptyNote>No events {replayAt ? "before this moment" : "yet today"}.</EmptyNote>
              )}
              <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
                <Box component={Link} href="/notifications" sx={{ color: "primary.main" }}>
                  All notifications
                </Box>
              </Typography>
            </Panel>
          </>
        );
      }}
    </MonitorFrame>
  );
}
