"use client";

// A pipeline as a signal-flow diagram. Packets move along each link at a rate set
// by the real count upstream; at a stage that is holding work (amber or red with a
// count) they pile up at its input and the stage glows in its state colour.
// Left to right on wide screens, top to bottom on phones. Packets stand still
// under prefers-reduced-motion.
import Link from "next/link";
import { Box, Button, Chip, Typography, useTheme } from "@mui/material";
import { ScrollText } from "lucide-react";
import { Fragment, useState } from "react";
import type { Pipeline, PipelineStage } from "@/types/control";
import { HEALTH_LABELS, systemName } from "@/lib/labels";
import { HealthIcon, HealthLabel, healthColor } from "@/components/common/Health";
import { ConsoleLabel, Raw } from "@/components/common/Bits";
import { DISPLAY_STACK } from "@/providers/MuiProvider";

const holding = (s: PipelineStage) => s.health !== "ok" && s.health !== "unknown" && s.count > 0;

function Link_({ from, to }: { from: PipelineStage; to: PipelineStage }) {
  const theme = useTheme();
  const n = from.count > 0 ? Math.min(4, Math.max(1, Math.ceil(from.count / 12))) : 0;
  // More traffic, faster packets: 46 a day crosses in about 2.4 s, 3 in about 4.3 s
  const dur = Math.max(1.6, Math.min(5, 5.5 - Math.log2(from.count + 1) * 0.6));
  const pile = holding(to) ? Math.min(5, to.count) : 0;
  const brand = theme.palette.primary.main;
  const pileColor = healthColor(theme, to.health);
  return (
    <Box
      aria-hidden
      sx={{
        position: "relative",
        flex: { md: "1 1 24px" },
        minWidth: { md: 28 },
        height: { xs: 30, md: "auto" },
        alignSelf: "stretch",
        mx: { md: 0.5 },
        ml: { xs: 3, md: 0.5 },
        "--dur": `${dur}s`,
      }}
    >
      {/* the wire */}
      <Box sx={{ position: "absolute", bgcolor: "divider", left: { xs: 0, md: 0 }, right: { md: 0 }, top: { xs: 0, md: "50%" }, bottom: { xs: 0 }, width: { xs: 2, md: "auto" }, height: { md: 2 }, transform: { md: "translateY(-1px)" } }} />
      {Array.from({ length: n }, (_, i) => (
        <Box
          key={i}
          className="pkt"
          sx={{
            position: "absolute",
            width: 6,
            height: 6,
            borderRadius: "1px",
            bgcolor: brand,
            boxShadow: `0 0 6px ${brand}`,
            top: { xs: 0, md: "50%" },
            left: { xs: -2, md: 0 },
            mt: { md: "-3px" },
            animation: { xs: `pkt-y var(--dur) linear infinite`, md: `pkt-x var(--dur) linear infinite` },
            animationDelay: `${(-dur * i) / n}s`,
            // reduced motion: hold each packet still, spread along the wire
            "--still": `${((i + 0.5) / n) * 100}%`,
          }}
        />
      ))}
      {pile ? (
        <Box sx={{ position: "absolute", display: "flex", flexDirection: { xs: "row", md: "column-reverse" }, gap: "2px", right: { md: 2 }, top: { md: "50%" }, bottom: { xs: 2 }, left: { xs: -2, md: "auto" }, transform: { md: "translateY(-50%)" } }}>
          {Array.from({ length: pile }, (_, i) => (
            <Box key={i} sx={{ width: 6, height: 6, borderRadius: "1px", bgcolor: pileColor }} />
          ))}
        </Box>
      ) : null}
    </Box>
  );
}

function Node({ s, selected, onToggle, controls }: { s: PipelineStage; selected: boolean; onToggle: () => void; controls: string }) {
  const theme = useTheme();
  const color = healthColor(theme, s.health);
  const stuck = holding(s);
  const lit = s.health !== "unknown";
  return (
    <Box
      component="button"
      type="button"
      onClick={onToggle}
      aria-expanded={selected}
      aria-controls={controls}
      aria-label={`${s.label}: ${s.count} ${s.countLabel}, ${HEALTH_LABELS[s.health]}`}
      sx={{
        all: "unset",
        boxSizing: "border-box",
        cursor: "pointer",
        flex: { md: "0 1 150px" },
        minWidth: 0,
        display: "grid",
        gridTemplateColumns: { xs: "1fr auto", md: "1fr" },
        borderRadius: "3px",
        border: "1px solid var(--ops-bezel)",
        bgcolor: "var(--ops-raised)",
        overflow: "hidden",
        outline: selected ? `2px solid ${theme.palette.primary.main}` : "none",
        outlineOffset: 2,
        boxShadow: stuck ? `0 0 0 1px ${color}, 0 0 26px -2px ${color}` : "none",
        transition: "box-shadow 300ms, border-color 120ms",
        "&:hover": { borderColor: "primary.main" },
        "&:focus-visible": { outline: "2px solid var(--focus-ring)", outlineOffset: 2 },
      }}
    >
      {/* module head: status LED and designation */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, px: 1, py: 0.6, borderBottom: { md: "1px solid var(--ops-bezel)" }, bgcolor: { md: "var(--ops-screen)" }, minWidth: 0, gridColumn: 1 }}>
        <Box component="span" sx={{ display: "inline-flex", filter: lit ? `drop-shadow(0 0 4px ${color})` : "none" }}>
          <HealthIcon health={s.health} size={13} />
        </Box>
        <ConsoleLabel sx={{ color: "text.primary", fontSize: "0.6875rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.label}</ConsoleLabel>
      </Box>
      <Box sx={{ px: 1, pt: { xs: 0.6, md: 1 }, pb: { xs: 0.6, md: 1.1 }, display: "flex", flexDirection: { xs: "row-reverse", md: "column" }, alignItems: { xs: "baseline", md: "flex-start" }, gap: { xs: 1, md: 0 }, gridColumn: { xs: 2, md: 1 }, gridRow: { xs: 1, md: 2 } }}>
        <Typography component="span" sx={{ fontFamily: DISPLAY_STACK, fontSize: { xs: "1.25rem", md: "2rem" }, fontWeight: 600, lineHeight: 1, fontVariantNumeric: "tabular-nums", color: s.health === "ok" || s.health === "unknown" ? "text.primary" : color }}>
          {s.count}
        </Typography>
        <Typography component="span" variant="caption" color="text.secondary" sx={{ lineHeight: 1.3, mt: { md: 0.5 } }}>
          {s.countLabel}
        </Typography>
      </Box>
    </Box>
  );
}

/** Both pipelines, one diagram each. */
export function PipelineStrip({ pipeline }: { pipeline: Pipeline }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = pipeline.stages.find((s) => s.id === openId) ?? null;
  const panelId = `stage-panel-${pipeline.id}`;

  return (
    <Box component="section" aria-labelledby={`pl-${pipeline.id}`} sx={{ minWidth: 0, "& + &": { mt: 2.5, pt: 2.5, borderTop: 1, borderColor: "divider" } }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5, flexWrap: "wrap" }}>
        <ConsoleLabel component="h3" id={`pl-${pipeline.id}`} sx={{ flex: 1, minWidth: 0, color: "text.primary" }}>
          {pipeline.name}
        </ConsoleLabel>
        <HealthLabel health={pipeline.health} size="caption" />
      </Box>

      <Box sx={{ display: "flex", flexDirection: { xs: "column", md: "row" }, alignItems: { md: "stretch" } }}>
        {pipeline.stages.map((s, i) => (
          <Fragment key={s.id}>
            {i > 0 ? <Link_ from={pipeline.stages[i - 1]} to={s} /> : null}
            <Node s={s} selected={s.id === openId} onToggle={() => setOpenId(s.id === openId ? null : s.id)} controls={panelId} />
          </Fragment>
        ))}
      </Box>

      <Box id={panelId} aria-live="polite">
        {open ? (
          <Box sx={{ mt: 1.5, p: 1.5, borderRadius: "4px", border: 1, borderColor: "divider", bgcolor: "background.default" }}>
            <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, flexWrap: "wrap", mb: 0.5 }}>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                {open.label}
              </Typography>
              <HealthLabel health={open.health} size="caption" />
              <Raw>{open.id}</Raw>
            </Box>
            <Typography variant="body2" sx={{ mb: 1 }}>
              {open.note ?? "Nothing unusual at this stage."}
            </Typography>
            <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap", alignItems: "center" }}>
              {open.systems.map((id) => (
                <Chip key={id} component={Link} href={`/systems/${id}`} clickable size="small" variant="outlined" label={systemName(id)} />
              ))}
              {open.systems.length ? (
                <Button component={Link} href={`/logs?system=${open.systems.join(",")}`} size="small" startIcon={<ScrollText size={14} aria-hidden />}>
                  Logs for this stage
                </Button>
              ) : null}
            </Box>
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}
