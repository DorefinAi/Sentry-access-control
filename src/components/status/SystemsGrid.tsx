"use client";

import Link from "next/link";
import { Box, Typography, useTheme } from "@mui/material";
import type { System, SystemGroup, UptimeStreak } from "@/types/control";
import { GROUP_LABELS, GROUP_ORDER, HEALTH_LABELS } from "@/lib/labels";
import { HealthIcon, healthColor } from "@/components/common/Health";
import { ConsoleLabel } from "@/components/common/Bits";
import { useNow } from "@/hooks/useNow";
import { exactIst, hmIst, relative, streak } from "@/lib/time";
import { MONO_STACK } from "@/providers/MuiProvider";

function StreakText({ st }: { st: UptimeStreak | undefined }) {
  if (!st) return null;
  // A system with no current streak is down (or never reported): say so in words
  if (st.streakSec <= 0)
    return (
      <Box component="span" sx={{ color: "error.main" }}>
        DOWN{st.lastOutage ? ` since ${hmIst(st.lastOutage.from)}` : ""}
      </Box>
    );
  return <>UP {streak(st.streakSec)}</>;
}

function SystemTile({ s, st, now }: { s: System; st: UptimeStreak | undefined; now: number }) {
  const theme = useTheme();
  const color = healthColor(theme, s.health);
  return (
    <Box
      component={Link}
      href={`/systems/${s.id}`}
      aria-label={`${s.name}, ${HEALTH_LABELS[s.health]}. ${s.summary}`}
      sx={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        columnGap: 1,
        rowGap: 0.25,
        alignItems: "baseline",
        p: 1.25,
        border: 1,
        borderColor: "divider",
        borderRadius: "4px",
        bgcolor: "background.default",
        color: "text.primary",
        textDecoration: "none",
        minWidth: 0,
        boxShadow: s.health === "ok" ? "none" : `inset 3px 0 0 ${color}`,
        "&:hover": { borderColor: "primary.main" },
      }}
    >
      <Box sx={{ alignSelf: "center" }}>
        <HealthIcon health={s.health} size={15} />
      </Box>
      <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {s.name}
      </Typography>
      <Box component="span" sx={{ fontFamily: MONO_STACK, fontSize: "0.75rem", whiteSpace: "nowrap" }}>
        <StreakText st={st} />
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ gridColumn: "2 / 3", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }} title={s.summary}>
        {s.summary}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ fontFamily: MONO_STACK, whiteSpace: "nowrap", textAlign: "right" }} title={s.lastHeartbeat ? `Heartbeat ${exactIst(s.lastHeartbeat)}` : "No heartbeat yet"}>
        {st ? `${st.uptimePct7d.toFixed(st.uptimePct7d >= 99.95 ? 0 : 1)}% 7d` : s.lastHeartbeat ? relative(s.lastHeartbeat, now) : "no beat"}
      </Typography>
    </Box>
  );
}

export function SystemsGrid({ systems, streaks = [] }: { systems: System[]; streaks?: UptimeStreak[] }) {
  const now = useNow();
  const byId = new Map(streaks.map((s) => [s.system, s]));
  const byGroup = new Map<SystemGroup, System[]>();
  for (const s of systems) byGroup.set(s.group, [...(byGroup.get(s.group) ?? []), s]);
  return (
    <Box sx={{ display: "grid", gap: 2 }}>
      {GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => (
        <Box key={g} component="section" aria-label={GROUP_LABELS[g]}>
          <ConsoleLabel component="h3" sx={{ mb: 0.75, fontSize: "0.6875rem" }}>
            {GROUP_LABELS[g]}
          </ConsoleLabel>
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 270px), 1fr))", gap: 1 }}>
            {byGroup.get(g)!.map((s) => (
              <SystemTile key={s.id} s={s} st={byId.get(s.id)} now={now} />
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  );
}
