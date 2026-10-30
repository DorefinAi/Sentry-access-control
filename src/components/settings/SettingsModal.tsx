"use client";

// Settings as a centred modal, addressed by the URL (?settings=<tab>) so any tab
// can be linked. Esc or the backdrop closes it; MUI traps focus inside and
// returns it to the trigger. On a phone it is a full-screen sheet whose first
// screen is the list of tabs.
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Box, Dialog, IconButton, Typography, useMediaQuery, useTheme } from "@mui/material";
import { ArrowLeft, Bell, Palette, ShieldCheck, User, Users, X } from "lucide-react";
import type { ComponentType } from "react";
import { useCan } from "@/providers/SessionProvider";
import { DISPLAY_STACK } from "@/providers/MuiProvider";
import { ProfileTab } from "./ProfileTab";
import { AppearanceTab } from "./AppearanceTab";
import { NotificationsTab } from "./NotificationsTab";
import { AccountTab } from "./AccountTab";
import { TeamTab } from "./TeamTab";

export type SettingsTabId = "profile" | "appearance" | "notifications" | "account" | "team";

const TABS: { id: SettingsTabId; label: string; icon: ComponentType<{ size?: number }>; body: ComponentType; admin?: boolean }[] = [
  { id: "profile", label: "Profile", icon: User, body: ProfileTab },
  { id: "appearance", label: "Appearance", icon: Palette, body: AppearanceTab },
  { id: "notifications", label: "Notifications", icon: Bell, body: NotificationsTab },
  { id: "account", label: "Account", icon: ShieldCheck, body: AccountTab },
  { id: "team", label: "Team", icon: Users, body: TeamTab, admin: true },
];

/** Open Settings on a tab, keeping the rest of the URL. */
export function useOpenSettings() {
  const router = useRouter();
  const pathname = usePathname();
  return (tab: SettingsTabId | "menu" = "profile") => {
    const q = new URLSearchParams(window.location.search);
    q.set("settings", tab);
    router.push(`${pathname}?${q.toString()}`, { scroll: false });
  };
}

export default function SettingsModal() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down("sm"));
  const isAdmin = useCan("team.manage").allowed;
  const raw = params.get("settings");
  const tabs = TABS.filter((t) => !t.admin || isAdmin);
  const open = raw !== null;
  // "menu" is the phone's first screen; on a desktop it means Profile
  const current = tabs.find((t) => t.id === raw) ?? (phone && (raw === "menu" || raw === "") ? null : tabs[0]);

  const go = (tab: string | null) => {
    const q = new URLSearchParams(params.toString());
    if (tab === null) q.delete("settings");
    else q.set("settings", tab);
    const s = q.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  };

  const tabList = (
    <Box component="nav" aria-label="Settings" sx={{ display: "grid", gap: 0.25, alignContent: "start" }}>
      {tabs.map(({ id, label, icon: Icon }) => {
        const active = current?.id === id;
        return (
          <Box
            key={id}
            component="button"
            type="button"
            onClick={() => go(id)}
            aria-current={active ? "page" : undefined}
            sx={{
              all: "unset",
              boxSizing: "border-box",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 1.25,
              px: 1.5,
              minHeight: { xs: 48, sm: 38 },
              borderRadius: "4px",
              fontSize: "0.875rem",
              fontWeight: active ? 600 : 500,
              color: active ? "text.primary" : "text.secondary",
              bgcolor: active ? "action.selected" : "transparent",
              "&:hover": { bgcolor: active ? "action.selected" : "action.hover", color: "text.primary" },
              "&:focus-visible": { outline: "2px solid var(--focus-ring)", outlineOffset: -2 },
            }}
          >
            <Icon size={17} />
            {label}
          </Box>
        );
      })}
    </Box>
  );

  // A non-admin following a link to Team gets the polite "Admins only" note, not another tab
  const Body = raw === "team" && !isAdmin ? TeamTab : current?.body;

  return (
    <Dialog
      open={open}
      onClose={() => go(null)}
      fullScreen={phone}
      maxWidth={false}
      aria-labelledby="settings-title"
      slotProps={{ paper: { sx: { width: { sm: "min(920px, calc(100vw - 48px))" }, height: { sm: "min(680px, calc(100dvh - 64px))" }, m: { sm: 2 }, borderRadius: { xs: 0, sm: "6px" }, display: "flex", flexDirection: "column", overflow: "hidden" } } }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: { xs: 1.5, sm: 2.5 }, minHeight: 56, borderBottom: 1, borderColor: "divider", flexShrink: 0 }}>
        {phone && current ? (
          <IconButton aria-label="Back to settings" onClick={() => go("menu")} sx={{ border: 1, borderColor: "divider", borderRadius: "6px", width: 38, height: 38 }}>
            <ArrowLeft size={18} />
          </IconButton>
        ) : null}
        <Typography id="settings-title" component="h2" sx={{ fontFamily: DISPLAY_STACK, fontWeight: 600, fontSize: "1.125rem", letterSpacing: "0.02em", flex: 1 }}>
          {phone && current ? current.label : "Settings"}
        </Typography>
        <IconButton aria-label="Close settings" onClick={() => go(null)} sx={{ border: 1, borderColor: "divider", borderRadius: "6px", width: 38, height: 38 }}>
          <X size={18} />
        </IconButton>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: { xs: "1fr", sm: "200px minmax(0, 1fr)" } }}>
        {!phone ? <Box sx={{ borderRight: 1, borderColor: "divider", p: 1.5, bgcolor: "var(--ops-screen)" }}>{tabList}</Box> : null}
        <Box sx={{ overflowY: "auto", p: { xs: 2, sm: 3 } }}>{phone && !current ? tabList : Body ? <Body /> : null}</Box>
      </Box>
    </Dialog>
  );
}
