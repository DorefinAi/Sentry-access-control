"use client";

// Mission-control theme. One token table drives both modes: dark is the night ops
// room, light is the daylight ops room with the same structure. State colours
// (nominal / amber / red) are used only for state; brand phosphor only for data
// that moves (packets, traces, the replay cursor). Tokens are also exposed as
// --ops-* CSS variables so hand-drawn SVG instruments use the same values.
import React, { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";

type ThemeMode = "light" | "dark";
export type ThemeChoice = ThemeMode | "system";
export type Density = "comfortable" | "compact";

interface Appearance {
  mode: ThemeMode; // what is on screen
  theme: ThemeChoice; // what the person chose
  density: Density;
  setTheme: (t: ThemeChoice) => void;
  setDensity: (d: Density) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<Appearance>({ mode: "dark", theme: "dark", density: "comfortable", setTheme: () => {}, setDensity: () => {}, toggleTheme: () => {} });

export const useThemeMode = () => useContext(ThemeContext);

const CACHE_KEY = "sentry.appearance";

export const FONT_STACK = 'var(--font-ui), var(--font-devanagari), "Nirmala UI", system-ui, sans-serif';
export const DISPLAY_STACK = 'var(--font-display), var(--font-ui), system-ui, sans-serif';
export const MONO_STACK = 'var(--font-mono), ui-monospace, "Cascadia Mono", Consolas, monospace';

export const TOKENS = {
  dark: {
    ground: "#060A12",
    panel: "#0C1322",
    raised: "#121B2E",
    screen: "#070D18", // the inset display inside a panel
    bezel: "#22304D", // instrument rims and module frames
    line: "#1B2740",
    grid: "rgba(92, 200, 255, 0.035)",
    ink: "#DCE6F5",
    dim: "#8A9BB8",
    brand: "#5CC8FF",
    ok: "#3DDC97",
    warn: "#FFB020",
    red: "#FF5C61",
    onState: "#06101C",
  },
  light: {
    ground: "#E8EDF3",
    panel: "#FFFFFF",
    raised: "#F5F8FB",
    screen: "#F3F6FA",
    bezel: "#C3CEDC",
    line: "#D3DBE6",
    grid: "rgba(10, 111, 160, 0.05)",
    ink: "#0A1426",
    dim: "#4E5D77",
    brand: "#0A6FA0",
    ok: "#0B7A53",
    warn: "#B45309",
    red: "#C42B2B",
    onState: "#FFFFFF",
  },
} as const;

export type Tokens = (typeof TOKENS)[ThemeMode];

export default function MuiProvider({ children }: { children: ReactNode }) {
  // Dark is the ops-room default; the server's preferences replace this once loaded
  const [theme, setThemeState] = useState<ThemeChoice>("dark");
  const [density, setDensityState] = useState<Density>("comfortable");
  const [systemDark, setSystemDark] = useState(true);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- restore the cached appearance after hydration */
    try {
      // The local copy paints the right theme before the server answers
      const saved = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null") as { theme?: ThemeChoice; density?: Density } | null;
      if (saved?.theme === "light" || saved?.theme === "dark" || saved?.theme === "system") setThemeState(saved.theme);
      if (saved?.density === "compact" || saved?.density === "comfortable") setDensityState(saved.density);
    } catch {
      // Storage blocked; stay on the defaults
    }
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemDark(mq.matches);
    /* eslint-enable react-hooks/set-state-in-effect */
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const cache = (next: { theme: ThemeChoice; density: Density }) => {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(next));
    } catch {
      // Storage blocked; the choice lasts for this visit only
    }
  };
  const setTheme = (t: ThemeChoice) => {
    setThemeState(t);
    cache({ theme: t, density });
  };
  const setDensity = (d: Density) => {
    setDensityState(d);
    cache({ theme, density: d });
  };
  const mode: ThemeMode = theme === "system" ? (systemDark ? "dark" : "light") : theme;
  const toggleTheme = () => setTheme(mode === "light" ? "dark" : "light");

  const muiTheme = useMemo(() => {
    const t = TOKENS[mode];
    return createTheme({
      palette: {
        mode,
        primary: { main: t.brand, contrastText: t.onState },
        background: { default: t.ground, paper: t.panel },
        text: { primary: t.ink, secondary: t.dim },
        divider: t.line,
        warning: { main: t.warn, contrastText: t.onState },
        success: { main: t.ok, contrastText: t.onState },
        error: { main: t.red, contrastText: t.onState },
      },
      shape: { borderRadius: 6 },
      // Compact tightens every gap and padding by a quarter
      spacing: density === "compact" ? 6 : 8,
      typography: {
        fontFamily: FONT_STACK,
        fontSize: 13,
        body1: { fontSize: "0.875rem", lineHeight: 1.5 },
        body2: { fontSize: "0.8125rem", lineHeight: 1.5 },
        button: { fontSize: "0.8125rem", fontWeight: 600 },
      },
      components: {
        MuiCssBaseline: {
          styleOverrides: {
            ":root": {
              "--focus-ring": t.brand,
              "--ops-ground": t.ground,
              "--ops-panel": t.panel,
              "--ops-raised": t.raised,
              "--ops-screen": t.screen,
              "--ops-bezel": t.bezel,
              // Scanlines only in the night room; daylight screens stay clean
              "--ops-scan": mode === "dark" ? "repeating-linear-gradient(0deg, rgba(92, 200, 255, 0.025) 0px, rgba(92, 200, 255, 0.025) 1px, transparent 1px, transparent 3px)" : "none",
              "--ops-line": t.line,
              "--ops-grid": t.grid,
              "--ops-ink": t.ink,
              "--ops-dim": t.dim,
              "--ops-brand": t.brand,
              "--ops-ok": t.ok,
              "--ops-warn": t.warn,
              "--ops-red": t.red,
              colorScheme: mode,
            },
            body: {
              backgroundColor: t.ground,
              // A faint plotting grid, static; the console's paper
              backgroundImage: `linear-gradient(${t.grid} 1px, transparent 1px), linear-gradient(90deg, ${t.grid} 1px, transparent 1px)`,
              backgroundSize: "32px 32px",
              fontVariantNumeric: "tabular-nums",
            },
          },
        },
        MuiTypography: { styleOverrides: { root: { marginBottom: 0 } } },
        MuiButton: {
          defaultProps: { disableElevation: true },
          styleOverrides: {
            root: { borderRadius: 6, textTransform: "none", minHeight: 34, fontSize: "0.8125rem" },
            outlined: { borderColor: t.line, color: t.ink, "&:hover": { borderColor: t.brand, background: "transparent" } },
            text: { color: t.ink },
          },
        },
        MuiIconButton: { styleOverrides: { root: { color: t.ink } } },
        MuiInputBase: { styleOverrides: { root: { fontSize: "0.875rem" } } },
        MuiOutlinedInput: { styleOverrides: { root: { borderRadius: 6, backgroundColor: t.panel }, notchedOutline: { borderColor: t.line } } },
        MuiPaper: { styleOverrides: { root: { borderRadius: 6, backgroundImage: "none" } } },
        MuiDrawer: { styleOverrides: { paper: { borderRadius: 0, backgroundColor: t.panel } } },
        MuiPopover: { styleOverrides: { paper: { boxShadow: "0 8px 28px rgba(0, 0, 0, 0.35)", border: `1px solid ${t.line}` } } },
        MuiMenu: { styleOverrides: { paper: { boxShadow: "0 8px 28px rgba(0, 0, 0, 0.35)", borderRadius: 6 } } },
        MuiDialog: { styleOverrides: { paper: { boxShadow: "0 8px 28px rgba(0, 0, 0, 0.35)", border: `1px solid ${t.line}` } } },
        MuiTooltip: { styleOverrides: { tooltip: { fontSize: "0.75rem", backgroundColor: t.raised, color: t.ink, border: `1px solid ${t.line}` } } },
        MuiTab: { styleOverrides: { root: { textTransform: "none", fontWeight: 600, minHeight: 44, color: t.dim, "&.Mui-selected": { color: t.ink } } } },
        MuiTabs: { styleOverrides: { root: { minHeight: 44 }, indicator: { backgroundColor: t.brand, height: 2 } } },
        MuiChip: { styleOverrides: { root: { borderRadius: 4, fontWeight: 500 }, outlined: { borderColor: t.line } } },
        MuiTableCell: { styleOverrides: { root: { borderColor: t.line }, head: { color: t.dim, fontWeight: 600 } } },
        MuiSkeleton: { styleOverrides: { root: { backgroundColor: t.raised } } },
      },
    });
  }, [mode, density]);

  return (
    <ThemeContext.Provider value={{ mode, theme, density, setTheme, setDensity, toggleTheme }}>
      <ThemeProvider theme={muiTheme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ThemeContext.Provider>
  );
}
