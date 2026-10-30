"use client";

import Link from "next/link";
import { Box, Typography, useTheme } from "@mui/material";
import { ChevronRight } from "lucide-react";
import { memo, useState } from "react";
import type { LogEntry, LogLevel } from "@/types/control";
import { LEVEL_LABELS, systemName } from "@/lib/labels";
import { clockIst, exactIst } from "@/lib/time";
import { healthColor } from "@/components/common/Health";
import { Slug } from "@/components/common/Bits";
import { MONO_STACK } from "@/providers/MuiProvider";

export function LevelChip({ level }: { level: LogLevel }) {
  const theme = useTheme();
  const color = level === "error" ? healthColor(theme, "down") : level === "warn" ? healthColor(theme, "warn") : theme.palette.text.secondary;
  const solid = level === "error";
  return (
    <Box
      component="span"
      sx={{
        display: "inline-block",
        width: 58,
        textAlign: "center",
        fontFamily: MONO_STACK,
        fontSize: "0.6875rem",
        fontWeight: 600,
        lineHeight: "18px",
        borderRadius: "6px",
        border: 1,
        borderColor: level === "debug" ? "divider" : color,
        color: solid ? theme.palette.error.contrastText : color,
        bgcolor: solid ? color : "transparent",
        flexShrink: 0,
      }}
    >
      {LEVEL_LABELS[level].toLowerCase()}
    </Box>
  );
}

const linkSx = { color: "text.primary", fontFamily: MONO_STACK, fontWeight: 600 } as const;

const LogRow = memo(function LogRow({ e, defaultOpen, showSystem }: { e: LogEntry; defaultOpen: boolean; showSystem: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const fields = Object.entries(e.fields ?? {});
  const detailId = `log-${e.id}`;
  return (
    <Box component="li" id={`row-${e.id}`} sx={{ borderBottom: 1, borderColor: "divider", bgcolor: defaultOpen ? "action.selected" : undefined }}>
      <Box
        component="button"
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={detailId}
        sx={{
          all: "unset",
          boxSizing: "border-box",
          width: "100%",
          cursor: "pointer",
          display: "grid",
          gridTemplateColumns: { xs: "auto auto 1fr", md: showSystem ? "14px 64px 58px 130px 1fr" : "14px 64px 58px 1fr" },
          columnGap: 1,
          rowGap: 0.25,
          alignItems: "baseline",
          px: 1,
          py: 0.75,
          fontFamily: MONO_STACK,
          fontSize: "0.75rem",
          lineHeight: 1.5,
          "&:hover": { bgcolor: "action.hover" },
          "&:focus-visible": { outline: "2px solid var(--focus-ring)", outlineOffset: -2 },
        }}
      >
        <Box component="span" aria-hidden sx={{ display: { xs: "none", md: "inline-flex" }, alignSelf: "center", color: "text.secondary", transform: open ? "rotate(90deg)" : "none", transition: "transform 120ms" }}>
          <ChevronRight size={14} />
        </Box>
        <Box component="time" dateTime={e.at} title={exactIst(e.at)} sx={{ color: "text.secondary", whiteSpace: "nowrap" }}>
          {clockIst(e.at)}
        </Box>
        <LevelChip level={e.level} />
        {showSystem ? (
          <Box component="span" sx={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
            {systemName(e.system)}
          </Box>
        ) : null}
        <Box component="span" sx={{ gridColumn: { xs: "1 / -1", md: "auto" }, overflowWrap: "anywhere", whiteSpace: open ? "pre-wrap" : { xs: "normal", md: "nowrap" }, overflow: open ? "visible" : "hidden", textOverflow: "ellipsis", minWidth: 0 }}>
          {e.message}
        </Box>
      </Box>
      {open ? (
        <Box id={detailId} sx={{ px: { xs: 1, md: 4.5 }, pb: 1.25, pt: 0.25, fontFamily: MONO_STACK, fontSize: "0.75rem", display: "grid", gridTemplateColumns: "minmax(80px, max-content) 1fr", columnGap: 2, rowGap: 0.25 }}>
          <Typography component="span" sx={{ font: "inherit", color: "text.secondary" }}>at</Typography>
          <span>{exactIst(e.at)}</span>
          <Typography component="span" sx={{ font: "inherit", color: "text.secondary" }}>system</Typography>
          <Box component={Link} href={`/systems/${e.system}`} sx={linkSx}>
            {e.system}
          </Box>
          {e.logger ? (
            <>
              <Typography component="span" sx={{ font: "inherit", color: "text.secondary" }}>logger</Typography>
              <span>{e.logger}</span>
            </>
          ) : null}
          {e.slug ? (
            <>
              <Typography component="span" sx={{ font: "inherit", color: "text.secondary" }}>slug</Typography>
              <span>
                <Slug slug={e.slug} />
              </span>
            </>
          ) : null}
          {e.itemId ? (
            <>
              <Typography component="span" sx={{ font: "inherit", color: "text.secondary" }}>item</Typography>
              <Box component={Link} href={`/trace?q=${encodeURIComponent(e.itemId)}`} sx={linkSx}>
                {e.itemId}
              </Box>
            </>
          ) : null}
          {fields.map(([k, v]) => (
            <Box key={k} sx={{ display: "contents" }}>
              <Typography component="span" sx={{ font: "inherit", color: "text.secondary", overflowWrap: "anywhere" }}>{k}</Typography>
              <span style={{ overflowWrap: "anywhere" }}>{v === null ? "null" : String(v)}</span>
            </Box>
          ))}
          <Typography component="span" sx={{ font: "inherit", color: "text.secondary" }}>id</Typography>
          <span style={{ overflowWrap: "anywhere" }}>{e.id}</span>
        </Box>
      ) : null}
    </Box>
  );
});

export function LogList({ entries, focusId, showSystem = true }: { entries: LogEntry[]; focusId?: string | null; showSystem?: boolean }) {
  return (
    <Box component="ul" aria-label="Log entries" sx={{ listStyle: "none", m: 0, p: 0, borderTop: 1, borderColor: "divider" }}>
      {entries.map((e) => (
        <LogRow key={e.id} e={e} defaultOpen={e.id === focusId} showSystem={showSystem} />
      ))}
    </Box>
  );
}
