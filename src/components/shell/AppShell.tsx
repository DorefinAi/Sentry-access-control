"use client";

// The console shell: a grouped sidebar (collapsible to an icon rail on desktop,
// a drawer on phones) with the profile menu pinned at its foot; a clean header
// (brand, IST clock, bell, launcher, Ask); the event ticker along the bottom; and
// the hosts for Settings, the Ask panel, pop-ups and shortcuts.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Box, Button, Drawer, IconButton, Tooltip, Typography } from "@mui/material";
import {
  Activity,
  Bell,
  ChevronsLeft,
  ChevronsRight,
  FileText,
  GitBranch,
  LayoutGrid,
  Menu,
  MessageCircle,
  Gauge as GaugeIcon,
  Route,
  ScrollText,
  Server,
  UsersRound,
  Waypoints,
  X,
} from "lucide-react";
import { ComponentType, ReactNode, Suspense, useEffect, useState } from "react";
import { DISPLAY_STACK, MONO_STACK } from "@/providers/MuiProvider";
import { useAsk } from "@/providers/AskProvider";
import { useOverview } from "@/providers/OverviewProvider";
import { useSession } from "@/providers/SessionProvider";
import { useSecondClock } from "@/hooks/useNow";
import { useApi } from "@/hooks/useApi";
import { getLauncher } from "@/lib/api";
import { hmsIst } from "@/lib/time";
import { AsyncView } from "@/components/common/AsyncView";
import { LauncherGrid } from "@/components/launcher/LauncherGrid";
import SettingsModal, { useOpenSettings } from "@/components/settings/SettingsModal";
import AskPanel, { ASK_WIDTH } from "./AskPanel";
import { NotificationFeed } from "./NotificationFeed";
import { ProfileMenu } from "./ProfileMenu";
import { Ticker } from "./Ticker";
import { CriticalToasts, ShortcutsDialog } from "./Extras";

const WIDE = 224;
const RAIL = 64;
const RAIL_KEY = "sentry.navRail";

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number; "aria-hidden"?: boolean }>;
  match: (p: string) => boolean;
  badge?: "alerts";
  ownerOnly?: boolean; // hidden from everyone but owners (the server refuses them too)
}

const GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Monitor",
    items: [
      { href: "/", label: "Overview", icon: GaugeIcon, match: (p) => p === "/" },
      { href: "/pipelines", label: "Pipelines", icon: Waypoints, match: (p) => p.startsWith("/pipelines") },
      { href: "/systems", label: "Systems", icon: Server, match: (p) => p.startsWith("/systems") },
      { href: "/telemetry", label: "Telemetry", icon: Activity, match: (p) => p.startsWith("/telemetry") },
    ],
  },
  {
    label: "Investigate",
    items: [
      { href: "/alerts", label: "Alerts", icon: Bell, match: (p) => p.startsWith("/alerts"), badge: "alerts" },
      { href: "/logs", label: "Logs", icon: ScrollText, match: (p) => p.startsWith("/logs") },
      { href: "/trace", label: "Trace", icon: Route, match: (p) => p.startsWith("/trace") },
      { href: "/changes", label: "Changes", icon: GitBranch, match: (p) => p.startsWith("/changes") },
    ],
  },
  {
    label: "Record",
    items: [{ href: "/reports", label: "Reports", icon: FileText, match: (p) => p.startsWith("/reports") || p.startsWith("/notifications") }],
  },
  {
    label: "Owners",
    items: [{ href: "/people", label: "People", icon: UsersRound, match: (p) => p.startsWith("/people"), ownerOnly: true }],
  },
];

const iconBtnSx = { border: 1, borderColor: "divider", borderRadius: "4px", width: 38, height: 38, color: "text.primary", "&:hover": { borderColor: "primary.main", bgcolor: "transparent" } } as const;

function BrandMark() {
  return (
    <Box component={Link} href="/" aria-label="Sentry, overview" sx={{ display: "flex", alignItems: "center", gap: 1, color: "text.primary", textDecoration: "none", flexShrink: 0 }}>
      <Box component="svg" viewBox="0 0 32 32" aria-hidden sx={{ width: 22, height: 22, color: "primary.main" }}>
        <rect x="1" y="1" width="30" height="30" rx="6" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M5 17h5l3-7 5 13 3-6h6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </Box>
      <Typography component="span" sx={{ fontFamily: DISPLAY_STACK, fontWeight: 700, fontSize: "1rem", letterSpacing: "0.14em" }}>
        SENTRY
      </Typography>
    </Box>
  );
}

function Clock() {
  const now = useSecondClock();
  return (
    <Box sx={{ display: "flex", alignItems: "baseline", gap: 0.75, fontFamily: MONO_STACK }}>
      <Box component="time" aria-label="Time in India" sx={{ fontSize: { xs: "0.9375rem", sm: "1.0625rem" }, fontWeight: 500, letterSpacing: "0.02em" }}>
        {now ? hmsIst(now) : "--:--:--"}
      </Box>
      <Box component="span" sx={{ fontSize: "0.6875rem", color: "text.secondary", fontFamily: DISPLAY_STACK, letterSpacing: "0.08em" }}>
        IST
      </Box>
    </Box>
  );
}

function Nav({ rail, openAlerts, onNavigate }: { rail: boolean; openAlerts: number; onNavigate?: () => void }) {
  const pathname = usePathname();
  const owner = useSession().role === "owner";
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => owner || !i.ownerOnly) })).filter((g) => g.items.length);
  return (
    <Box component="nav" aria-label="Main" sx={{ px: 1, py: 1.5, display: "grid", gap: 1.5 }}>
      {groups.map((g) => (
        <Box key={g.label}>
          {rail ? (
            <Box aria-hidden sx={{ height: 1, bgcolor: "divider", mx: 1, mb: 1 }} />
          ) : (
            <Typography component="p" id={`nav-${g.label}`} sx={{ px: 1.5, mb: 0.5, fontFamily: DISPLAY_STACK, fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "text.secondary", opacity: 0.8 }}>
              {g.label}
            </Typography>
          )}
          <Box component="ul" aria-labelledby={rail ? undefined : `nav-${g.label}`} aria-label={rail ? g.label : undefined} sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: 0.25 }}>
            {g.items.map(({ href, label, icon: Icon, match, badge }) => {
              const active = match(pathname);
              const count = badge === "alerts" ? openAlerts : 0;
              const link = (
                <Box
                  component={Link}
                  href={href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  aria-label={rail ? `${label}${count ? `, ${count} open` : ""}` : undefined}
                  sx={{
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: rail ? "center" : "flex-start",
                    gap: 1.25,
                    px: rail ? 0 : 1.5,
                    minHeight: 38,
                    borderRadius: "4px",
                    color: active ? "text.primary" : "text.secondary",
                    textDecoration: "none",
                    fontFamily: DISPLAY_STACK,
                    fontWeight: 600,
                    fontSize: "0.875rem",
                    letterSpacing: "0.03em",
                    bgcolor: active ? "action.selected" : "transparent",
                    "&::before": active ? { content: '""', position: "absolute", left: 0, top: 8, bottom: 8, width: 3, borderRadius: 2, bgcolor: "primary.main" } : undefined,
                    "&:hover": { color: "text.primary", bgcolor: active ? "action.selected" : "action.hover" },
                    "&:focus-visible": { outline: "2px solid var(--focus-ring)", outlineOffset: -2 },
                  }}
                >
                  <Icon size={18} aria-hidden strokeWidth={active ? 2.3 : 1.9} />
                  {rail ? null : <span style={{ flex: 1 }}>{label}</span>}
                  {count > 0 ? (
                    <Box
                      component="span"
                      aria-label={rail ? undefined : `${count} open`}
                      sx={{
                        position: rail ? "absolute" : "static",
                        top: 3,
                        right: 6,
                        minWidth: rail ? 16 : 22,
                        height: rail ? 16 : 20,
                        px: 0.5,
                        borderRadius: "3px",
                        bgcolor: "error.main",
                        color: "error.contrastText",
                        fontFamily: MONO_STACK,
                        fontSize: rail ? "0.625rem" : "0.75rem",
                        fontWeight: 600,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {count}
                    </Box>
                  ) : null}
                </Box>
              );
              return (
                <li key={href}>
                  {rail ? (
                    <Tooltip title={label} placement="right">
                      {link}
                    </Tooltip>
                  ) : (
                    link
                  )}
                </li>
              );
            })}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

function AppsPanel() {
  const apps = useApi("launcher", getLauncher, { refreshMs: 30_000 });
  return (
    <AsyncView state={apps} what="the apps" isEmpty={(d) => d.length === 0} empty="No apps listed.">
      {(d) => <LauncherGrid apps={d} />}
    </AsyncView>
  );
}

type Panel = "notifications" | "apps" | null;
const PANEL_TITLES: Record<Exclude<Panel, null>, string> = { notifications: "Notifications", apps: "Launcher" };

/** Ctrl/⌘+, opens Settings; "?" opens the shortcuts. Lives inside Suspense with Settings. */
function GlobalKeys({ onShortcuts }: { onShortcuts: () => void }) {
  const openSettings = useOpenSettings();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName));
      if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        openSettings("profile");
      } else if (e.key === "?" && !typing && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        onShortcuts();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openSettings, onShortcuts]);
  return null;
}

export default function AppShell({ children }: { children: ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  const [rail, setRail] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [shortcuts, setShortcuts] = useState(false);
  const ask = useAsk();
  const openAlerts = useOverview().data?.counts.openAlerts ?? 0;
  const { notifications } = useSession();
  const unread = notifications.data?.unread ?? 0;

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restore the remembered rail after hydration
      setRail(localStorage.getItem(RAIL_KEY) === "1");
    } catch {
      // Storage blocked; start expanded
    }
  }, []);
  const toggleRail = () => {
    setRail((r) => {
      try {
        localStorage.setItem(RAIL_KEY, r ? "0" : "1");
      } catch {
        // Storage blocked; the choice lasts for this visit only
      }
      return !r;
    });
  };
  const sideW = rail ? RAIL : WIDE;

  return (
    <Box sx={{ minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <Box component="a" href="#main" sx={{ position: "absolute", left: -9999, top: 8, zIndex: 2000, bgcolor: "background.paper", px: 2, py: 1, borderRadius: "4px", "&:focus": { left: 8 } }}>
        Skip to content
      </Box>

      <Box
        component="header"
        sx={{ position: "sticky", top: 0, zIndex: (t) => t.zIndex.appBar, height: 56, display: "flex", alignItems: "center", gap: { xs: 0.75, sm: 1.25 }, px: { xs: 1.5, md: 2 }, bgcolor: "background.paper", borderBottom: 1, borderColor: "divider" }}
      >
        <IconButton aria-label="Open menu" onClick={() => setNavOpen(true)} sx={{ ...iconBtnSx, display: { md: "none" } }}>
          <Menu size={18} />
        </IconButton>
        <Box sx={{ display: { xs: "none", sm: "block" }, width: { md: sideW - 16 }, transition: "width 160ms" }}>
          <BrandMark />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Clock />
        </Box>
        <Tooltip title="Notifications">
          <IconButton aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} onClick={() => setPanel("notifications")} sx={{ ...iconBtnSx, position: "relative" }}>
            <Bell size={17} />
            {unread ? (
              <Box component="span" aria-hidden sx={{ position: "absolute", top: -6, right: -6, minWidth: 18, height: 18, px: 0.5, borderRadius: "3px", bgcolor: "primary.main", color: "primary.contrastText", fontFamily: MONO_STACK, fontSize: "0.6875rem", fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {unread > 99 ? "99+" : unread}
              </Box>
            ) : null}
          </IconButton>
        </Tooltip>
        <Tooltip title="Launcher">
          <IconButton aria-label="Launcher" onClick={() => setPanel("apps")} sx={iconBtnSx}>
            <LayoutGrid size={17} />
          </IconButton>
        </Tooltip>
        <Button variant="contained" onClick={() => ask.setOpen(!ask.open)} aria-expanded={ask.open} aria-label="Ask" sx={{ height: 38, minWidth: { xs: 38, sm: 64 }, px: { xs: 0, sm: 1.5 } }}>
          <MessageCircle size={16} aria-hidden />
          <Box component="span" sx={{ display: { xs: "none", sm: "inline" }, ml: 0.75 }}>
            Ask
          </Box>
        </Button>
      </Box>

      <Box sx={{ display: "flex", flex: 1 }}>
        {/* CSS decides which nav shows, so the first paint matches the screen size */}
        <Box
          sx={{
            display: { xs: "none", md: "flex" },
            flexDirection: "column",
            width: sideW,
            flexShrink: 0,
            borderRight: 1,
            borderColor: "divider",
            bgcolor: "background.paper",
            position: "sticky",
            top: 56,
            height: "calc(100dvh - 56px)",
            transition: "width 160ms",
            overflowX: "hidden",
          }}
        >
          <Box sx={{ flex: 1, overflowY: "auto" }}>
            <Nav rail={rail} openAlerts={openAlerts} />
          </Box>
          <Box sx={{ p: 1, display: "grid", gap: 1, borderTop: 1, borderColor: "divider" }}>
            <Tooltip title={rail ? "Expand the sidebar" : ""} placement="right">
              <Button size="small" onClick={toggleRail} aria-label={rail ? "Expand the sidebar" : "Collapse the sidebar to icons"} sx={{ justifyContent: rail ? "center" : "flex-start", color: "text.secondary", minWidth: 0, px: rail ? 0 : 1.5 }}>
                {rail ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
                {rail ? null : <Box component="span" sx={{ ml: 1 }}>Collapse</Box>}
              </Button>
            </Tooltip>
            <ProfileMenu collapsed={rail} onLauncher={() => setPanel("apps")} onShortcuts={() => setShortcuts(true)} />
          </Box>
        </Box>
        <Drawer open={navOpen} onClose={() => setNavOpen(false)} sx={{ display: { md: "none" } }} slotProps={{ paper: { sx: { width: 272, display: "flex", flexDirection: "column" } } }}>
          <Box sx={{ height: 56, display: "flex", alignItems: "center", px: 2, borderBottom: 1, borderColor: "divider" }}>
            <BrandMark />
          </Box>
          <Box sx={{ flex: 1, overflowY: "auto" }}>
            <Nav rail={false} openAlerts={openAlerts} onNavigate={() => setNavOpen(false)} />
          </Box>
          <Box sx={{ p: 1, borderTop: 1, borderColor: "divider" }} onClick={() => setNavOpen(false)}>
            <ProfileMenu collapsed={false} onLauncher={() => setPanel("apps")} onShortcuts={() => setShortcuts(true)} />
          </Box>
        </Drawer>

        <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", mr: { md: ask.open ? `${ASK_WIDTH}px` : 0 } }}>
          <Box component="main" id="main" tabIndex={-1} sx={{ flex: 1, minWidth: 0, px: { xs: 2, sm: 3 }, pt: { xs: 2, sm: 3 }, pb: { xs: 2, sm: 2 }, outline: "none" }}>
            <Box sx={{ maxWidth: 1440, mx: "auto" }}>{children}</Box>
          </Box>
          <Ticker />
        </Box>
      </Box>

      <Drawer anchor="right" open={panel !== null} onClose={() => setPanel(null)} slotProps={{ paper: { sx: { width: { xs: "100%", sm: panel === "apps" ? 640 : 440 }, p: { xs: 2, sm: 2.5 }, borderLeft: 1, borderColor: "divider" } } }}>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
          <Typography component="h2" sx={{ fontFamily: DISPLAY_STACK, fontWeight: 600, fontSize: "1.125rem", letterSpacing: "0.02em", flex: 1 }}>
            {panel ? PANEL_TITLES[panel] : ""}
          </Typography>
          <IconButton aria-label="Close" onClick={() => setPanel(null)} sx={iconBtnSx}>
            <X size={18} />
          </IconButton>
        </Box>
        {panel === "notifications" ? <NotificationFeed limit={20} onNavigate={() => setPanel(null)} /> : panel === "apps" ? <AppsPanel /> : null}
      </Drawer>
      <AskPanel />
      <CriticalToasts />
      <ShortcutsDialog open={shortcuts} onClose={() => setShortcuts(false)} />
      {/* Settings and the global keys read the URL, which needs a Suspense boundary */}
      <Suspense fallback={null}>
        <SettingsModal />
        <GlobalKeys onShortcuts={() => setShortcuts(true)} />
      </Suspense>
    </Box>
  );
}
