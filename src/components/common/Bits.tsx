"use client";

// Small display pieces used on every screen.
import Link from "next/link";
import { Box, Chip, Tooltip, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
import type { ReactNode } from "react";
import { useNow } from "@/hooks/useNow";
import { exactIst, relative } from "@/lib/time";
import { evidenceHref } from "@/lib/labels";
import type { Evidence } from "@/types/control";
import { DISPLAY_STACK, MONO_STACK } from "@/providers/MuiProvider";
import { Panel } from "./Panel";

export const cardSx = { border: 1, borderColor: "divider", borderRadius: "2px", bgcolor: "background.paper" } as const;

/** A console panel designation: small, upper case, in the display face. Labels only, never content. */
export function ConsoleLabel({ children, component = "span", id, sx }: { children: ReactNode; component?: "span" | "h2" | "h3" | "p"; id?: string; sx?: SxProps<Theme> }) {
  return (
    <Typography component={component} id={id} sx={{ fontFamily: DISPLAY_STACK, fontSize: "0.75rem", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "text.secondary", lineHeight: 1.3, ...sx }}>
      {children}
    </Typography>
  );
}

export function RelTime({ iso, prefix }: { iso: string | null | undefined; prefix?: string }) {
  const now = useNow();
  if (!iso) return <span>never</span>;
  return (
    <Tooltip title={exactIst(iso)}>
      <Box component="time" dateTime={iso} tabIndex={0} sx={{ whiteSpace: "nowrap", cursor: "help", textDecoration: "underline dotted", textDecorationColor: "currentColor", textUnderlineOffset: 3, textDecorationThickness: "1px" }}>
        {prefix}
        {relative(iso, now)}
      </Box>
    </Tooltip>
  );
}

/** Raw technical value, small and mono, for the reader who wants it. */
export function Raw({ children, sx }: { children: ReactNode; sx?: SxProps<Theme> }) {
  return (
    <Box component="code" sx={{ fontFamily: MONO_STACK, fontSize: "0.75rem", color: "text.secondary", overflowWrap: "anywhere", ...sx }}>
      {children}
    </Box>
  );
}

/** The slug is the thread through every system; it always looks the same. */
export function Slug({ slug, link = true }: { slug: string; link?: boolean }) {
  const sx = { fontFamily: MONO_STACK, fontWeight: 600, fontSize: "0.8125rem", color: "text.primary", overflowWrap: "anywhere" } as const;
  if (!link) return <Box component="span" sx={sx}>{slug}</Box>;
  return (
    <Box component={Link} href={`/trace/${encodeURIComponent(slug)}`} sx={{ ...sx, textDecoration: "underline", textDecorationColor: "transparent", "&:hover": { textDecorationColor: "currentColor" } }}>
      {slug}
    </Box>
  );
}

export function EvidenceChips({ items, label = "Evidence" }: { items: Evidence[] | undefined; label?: string }) {
  if (!items?.length) return null;
  return (
    <Box component="ul" aria-label={label} sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, listStyle: "none", p: 0, m: 0 }}>
      {items.map((e, i) => {
        const href = evidenceHref(e);
        const chipLabel = (
          <span>
            <Box component="span" sx={{ color: "text.secondary", mr: 0.5 }}>
              {e.kind}
            </Box>
            {e.label}
          </span>
        );
        const sx = { maxWidth: "100%", height: "auto", minHeight: 24, py: "2px", "& .MuiChip-label": { whiteSpace: "normal", overflowWrap: "anywhere" } } as const;
        // Index in the key: the same evidence can be cited twice
        return (
          <li key={`${e.kind}:${e.id}:${i}`}>
            {href ? <Chip component={Link} href={href} clickable size="small" variant="outlined" label={chipLabel} sx={sx} /> : <Chip size="small" variant="outlined" label={chipLabel} sx={sx} />}
          </li>
        );
      })}
    </Box>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <Box sx={{ display: "flex", alignItems: { xs: "flex-start", sm: "center" }, justifyContent: "space-between", gap: 2, mb: 2, flexWrap: "wrap" }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography component="h1" sx={{ fontFamily: DISPLAY_STACK, fontSize: "1.5rem", fontWeight: 600, lineHeight: 1.2, letterSpacing: "0.01em" }}>
          {title}
        </Typography>
        {subtitle ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            {subtitle}
          </Typography>
        ) : null}
      </Box>
      {action}
    </Box>
  );
}

/** A titled panel for ordinary pages; the summary wall numbers its panels instead. */
export function Section({ title, action, children, id, sx }: { title: string; action?: ReactNode; children: ReactNode; id?: string; sx?: SxProps<Theme> }) {
  return (
    <Panel title={title} action={action} id={id} sx={sx}>
      {children}
    </Panel>
  );
}

/** A labelled number. */
export function Stat({ label, value, raw }: { label: string; value: ReactNode; raw?: string }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography sx={{ fontFamily: MONO_STACK, fontSize: "1.375rem", fontWeight: 500, lineHeight: 1.2, fontVariantNumeric: "tabular-nums" }}>{value}</Typography>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      {raw ? <Raw>{raw}</Raw> : null}
    </Box>
  );
}
