"use client";

// Overview: the mission summary on one screen. The band (status, clock, streak,
// shift), the knobs, the replay jog, the top fixes and a one-line health of each
// pipeline. Details live on Pipelines, Systems and Telemetry.
import Link from "next/link";
import { Box, Button, Typography } from "@mui/material";
import { ChevronRight } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { patchGauge } from "@/lib/api";
import { invalidate } from "@/lib/invalidate";
import { hmIst } from "@/lib/time";
import { useBoards } from "@/providers/OverviewProvider";
import { useCan } from "@/providers/SessionProvider";
import type { Overview, Pipeline } from "@/types/control";
import { HealthIcon, HealthLabel, SeverityChip } from "@/components/common/Health";
import { Panel } from "@/components/common/Panel";
import { EmptyNote } from "@/components/common/AsyncView";
import { Knob, Thresholds } from "@/components/knob/Knob";
import { JogWheel, Mark } from "@/components/knob/JogWheel";
import { FixList } from "@/components/status/FixList";
import { MissionHeader } from "@/components/status/Summary";
import { MonitorFrame, WallSkeleton } from "./MonitorFrame";
import { DISPLAY_STACK } from "@/providers/MuiProvider";

/** Outages today, as marks for the jog's timeline. */
export function outageMarks(o: Overview): Mark[] {
  const day = o.asOf.slice(0, 10);
  const seen = new Set<string>();
  const out: Mark[] = [];
  const add = (name: string, from: string, to: string | null) => {
    if (!from.startsWith(day) || seen.has(from)) return;
    seen.add(from);
    out.push({ from: Date.parse(from), to: to ? Date.parse(to) : Date.parse(o.asOf), label: `${name} ${hmIst(from)}–${to ? hmIst(to) : "now"}` });
  };
  for (const s of o.streaks) if (s.lastOutage) add(s.name.toUpperCase(), s.lastOutage.from, s.lastOutage.to);
  if (o.uptime.lastOutage) add("STACK", o.uptime.lastOutage.from, o.uptime.lastOutage.to);
  return out;
}

function PipelineLine({ p }: { p: Pipeline }) {
  return (
    <Box component={Link} href="/pipelines" sx={{ display: "block", color: "text.primary", textDecoration: "none", py: 1.25, "& + &": { borderTop: 1, borderColor: "divider" }, "&:hover .go": { color: "primary.main" } }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.75 }}>
        <Typography sx={{ fontFamily: DISPLAY_STACK, fontWeight: 600, fontSize: "0.8125rem", letterSpacing: "0.06em", textTransform: "uppercase", flex: 1, minWidth: 0 }}>{p.name}</Typography>
        <HealthLabel health={p.health} size="caption" />
        <Box className="go" sx={{ color: "text.secondary", display: "flex" }}>
          <ChevronRight size={16} aria-hidden />
        </Box>
      </Box>
      <Box component="ol" aria-label={`${p.name} stages`} sx={{ listStyle: "none", m: 0, p: 0, display: "flex", flexWrap: "wrap", alignItems: "center", rowGap: 0.5 }}>
        {p.stages.map((s, i) => (
          <Fragment key={s.id}>
            {i ? (
              <Box component="li" aria-hidden sx={{ color: "text.secondary", px: 0.5, display: "flex" }}>
                <ChevronRight size={12} />
              </Box>
            ) : null}
            <Box component="li" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, fontSize: "0.75rem", whiteSpace: "nowrap" }}>
              <HealthIcon health={s.health} size={12} />
              <span>{s.label}</span>
              <Box component="span" sx={{ fontFamily: DISPLAY_STACK, fontWeight: 600, color: s.health === "ok" || s.health === "unknown" ? "text.primary" : s.health === "down" ? "error.main" : "warning.main" }}>
                {s.count}
              </Box>
            </Box>
          </Fragment>
        ))}
      </Box>
    </Box>
  );
}

function TopFixes({ o }: { o: Overview }) {
  const [all, setAll] = useState(false);
  const ranked = o.fixes.toSorted((a, b) => a.rank - b.rank);
  if (!ranked.length) return <EmptyNote>Nothing to fix right now.</EmptyNote>;
  return (
    <>
      {all ? (
        <FixList fixes={ranked} />
      ) : (
        <Box component="ol" sx={{ listStyle: "none", m: 0, p: 0 }}>
          {ranked.slice(0, 3).map((f) => (
            <Box component="li" key={f.id} sx={{ display: "grid", gridTemplateColumns: "26px 1fr auto", gap: 1.25, alignItems: "start", py: 0.75, "& + &": { borderTop: 1, borderColor: "divider" } }}>
              <Box aria-hidden sx={{ width: 24, height: 24, border: 1, borderColor: "text.primary", borderRadius: "2px", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: DISPLAY_STACK, fontWeight: 700, fontSize: "0.8125rem" }}>
                {f.rank}
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.title}>
                  {f.title}
                </Typography>
                <Typography variant="caption" color="text.secondary" component="p" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {f.impact}
                </Typography>
              </Box>
              <SeverityChip severity={f.severity} />
            </Box>
          ))}
        </Box>
      )}
      <Button size="small" onClick={() => setAll(!all)} sx={{ mt: 0.25, minHeight: 28 }}>
        {all ? "Show the top 3" : `All ${ranked.length} fixes, with why and steps`}
      </Button>
    </>
  );
}

export default function OverviewView() {
  const { live, replayAt, setReplay } = useBoards();
  const can = useCan("gauge.edit");
  const { reload } = live;

  // The Overview watches closely: poll every 5 s while it is open and visible
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, 5000);
    return () => window.clearInterval(id);
  }, [reload]);

  const commit = async (id: string, t: Thresholds): Promise<string | null> => {
    try {
      await patchGauge(id, t);
      invalidate("overview", "alerts", "notifications");
      return null;
    } catch (e) {
      return `Not saved: ${(e as Error).message}`;
    }
  };

  return (
    <MonitorFrame title="Overview" header={false} skeleton={<WallSkeleton />}>
      {(o, liveBoard) => (
        <>
          <MissionHeader o={o} replay={!!replayAt} />
          <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1fr) 320px" }, alignItems: "stretch" }}>
            <Panel n={1} title="Readouts" id="readouts" bodySx={{ py: { xs: 1.5, sm: 1.5 } }}>
              {o.gauges.length ? (
                <Box component="ul" aria-label="Readouts" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", sm: "repeat(auto-fit, minmax(132px, 1fr))" }, gap: { xs: 2, sm: 2 } }}>
                  {o.gauges.map((g) => (
                    <li key={g.id}>
                      <Knob g={g} editable={can.allowed && !replayAt} reason={replayAt ? "Thresholds can only change on the live board." : can.reason} onCommit={commit} />
                    </li>
                  ))}
                </Box>
              ) : (
                <EmptyNote>No readouts.</EmptyNote>
              )}
            </Panel>
            <Panel n={2} title="Replay" id="replay">
              <JogWheel liveAsOf={liveBoard.asOf} replayAt={replayAt} marks={outageMarks(liveBoard)} onScrub={setReplay} />
            </Panel>
          </Box>
          <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1fr) minmax(0, 1fr)" }, alignItems: "start" }}>
            <Panel n={3} title="What to fix" id="fixes">
              <TopFixes o={o} />
            </Panel>
            <Panel n={4} title="Pipelines" id="pipelines" bodySx={{ py: 0.5 }}>
              {o.pipelines.map((p) => (
                <PipelineLine key={p.id} p={p} />
              ))}
            </Panel>
          </Box>
        </>
      )}
    </MonitorFrame>
  );
}
