"use client";

import { Box, Typography } from "@mui/material";
import { CircleCheck, CircleDashed } from "lucide-react";
import { getBuildLog } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import type { BuildLogEntry } from "@/types/control";
import { RelTime, cardSx } from "@/components/common/Bits";
import { AsyncView } from "@/components/common/AsyncView";

function List({ items, done }: { items: string[]; done: boolean }) {
  const Icon = done ? CircleCheck : CircleDashed;
  return (
    <Box>
      <Typography component="h3" variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>
        {done ? "Watched for real" : "Still cannot see"}
      </Typography>
      {items.length ? (
        <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: 0.5 }}>
          {items.map((t) => (
            <Box component="li" key={t} sx={{ display: "flex", gap: 0.75, alignItems: "flex-start" }}>
              <Box sx={{ color: done ? "success.main" : "text.secondary", display: "flex", pt: "2px", flexShrink: 0 }}>
                <Icon size={14} aria-hidden />
              </Box>
              <Typography variant="body2">{t}</Typography>
            </Box>
          ))}
        </Box>
      ) : (
        <Typography variant="body2" color="text.secondary">
          Nothing yet.
        </Typography>
      )}
    </Box>
  );
}

function Entry({ e }: { e: BuildLogEntry }) {
  return (
    <Box component="li" sx={{ ...cardSx, p: { xs: 1.5, sm: 2 } }}>
      <Box sx={{ display: "flex", gap: 1.5, alignItems: "baseline", flexWrap: "wrap", mb: 1.5 }}>
        <Typography component="h2" sx={{ fontWeight: 700, fontSize: "0.9375rem", flex: 1, minWidth: 0 }}>
          {e.title}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          <RelTime iso={e.at} />
        </Typography>
      </Box>
      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" } }}>
        <List items={e.connected} done />
        <List items={e.missing} done={false} />
      </Box>
    </Box>
  );
}

export function BuildLogTab() {
  const state = useApi("build-log", getBuildLog);
  return (
    <>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        What each phase connected, and what is still dark. Read the latest phase before trusting a green light.
      </Typography>
      <AsyncView state={state} what="the build log" isEmpty={(d) => d.length === 0} empty="No phases logged yet.">
        {(d) => (
          <Box component="ol" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: 2 }}>
            {d.toSorted((a, b) => b.at.localeCompare(a.at)).map((e) => (
              <Entry key={`${e.phase}-${e.at}`} e={e} />
            ))}
          </Box>
        )}
      </AsyncView>
    </>
  );
}
