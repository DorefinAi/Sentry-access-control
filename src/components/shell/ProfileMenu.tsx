"use client";

// The profile button pinned to the bottom of the sidebar, and its menu:
// Settings, a quick theme switch, the launcher, keyboard shortcuts and sign out.
import { Box, Divider, ListItemIcon, ListItemText, Menu, MenuItem, Tooltip, Typography } from "@mui/material";
import { Keyboard, LayoutGrid, LogOut, Moon, Settings, Sun } from "lucide-react";
import { useState } from "react";
import { useSession } from "@/providers/SessionProvider";
import { useThemeMode, DISPLAY_STACK, MONO_STACK } from "@/providers/MuiProvider";
import { useSecondClock } from "@/hooks/useNow";
import { clockOffset } from "@/lib/clock";
import { counter } from "@/lib/time";
import { ROLE_LABELS } from "@/lib/roles";
import { Initials } from "@/components/settings/parts";
import { useOpenSettings } from "@/components/settings/SettingsModal";

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

function Shift({ since }: { since: string }) {
  const now = useSecondClock();
  // Sign-in times are real; the second clock runs on the server's (possibly frozen) time
  return <>{now ? counter((now - clockOffset() - Date.parse(since)) / 1000) : "--:--:--"}</>;
}

export function ProfileMenu({ collapsed, onLauncher, onShortcuts }: { collapsed: boolean; onLauncher: () => void; onShortcuts: () => void }) {
  const { me, role, signOut, savePreferences } = useSession();
  const { mode } = useThemeMode();
  const openSettings = useOpenSettings();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = !!anchorEl;
  const p = me.data;
  const close = () => setAnchorEl(null);
  const run = (fn: () => void) => () => {
    close();
    fn();
  };

  const button = (
    <Box
      component="button"
      type="button"
      onClick={(e) => setAnchorEl(e.currentTarget)}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={p ? `${p.name}, ${role ? ROLE_LABELS[role] : ""}. Open the profile menu` : "Open the profile menu"}
      sx={{
        all: "unset",
        boxSizing: "border-box",
        cursor: "pointer",
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 1.25,
        p: collapsed ? 0.75 : 1,
        justifyContent: collapsed ? "center" : "flex-start",
        borderRadius: "4px",
        border: 1,
        borderColor: open ? "primary.main" : "divider",
        bgcolor: "var(--ops-screen)",
        "&:hover": { borderColor: "primary.main" },
        "&:focus-visible": { outline: "2px solid var(--focus-ring)", outlineOffset: 2 },
      }}
    >
      <Initials text={p?.initials ?? "··"} size={34} />
      {!collapsed ? (
        <Box sx={{ minWidth: 0, flex: 1, textAlign: "left" }}>
          <Typography variant="body2" sx={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.3 }}>
            {p?.name ?? "Loading…"}
          </Typography>
          <Box sx={{ display: "flex", gap: 0.75, alignItems: "baseline", fontSize: "0.6875rem", color: "text.secondary" }}>
            <Box component="span" sx={{ fontFamily: DISPLAY_STACK, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              {role ? ROLE_LABELS[role] : ""}
            </Box>
            {p ? (
              <Box component="span" sx={{ fontFamily: MONO_STACK }} aria-label="Time on shift">
                <Shift since={p.onShiftSince} />
              </Box>
            ) : null}
          </Box>
        </Box>
      ) : null}
    </Box>
  );

  return (
    <>
      {collapsed ? (
        <Tooltip title={p ? `${p.name}, ${role ? ROLE_LABELS[role] : ""}` : "Profile"} placement="right">
          {button}
        </Tooltip>
      ) : (
        button
      )}
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={close}
        anchorOrigin={{ vertical: "top", horizontal: "left" }}
        transformOrigin={{ vertical: "bottom", horizontal: "left" }}
        slotProps={{ paper: { sx: { minWidth: 248, mt: -1 } } }}
      >
        <Box sx={{ px: 2, py: 1.25 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {p?.name}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ fontFamily: MONO_STACK }}>
            {p?.username}
          </Typography>
        </Box>
        <Divider />
        <MenuItem onClick={run(() => openSettings(window.matchMedia("(max-width: 599.95px)").matches ? "menu" : "profile"))}>
          <ListItemIcon>
            <Settings size={16} />
          </ListItemIcon>
          <ListItemText>Settings</ListItemText>
          <Typography variant="caption" color="text.secondary" sx={{ fontFamily: MONO_STACK, ml: 2 }}>
            {isMac() ? "⌘," : "Ctrl+,"}
          </Typography>
        </MenuItem>
        <MenuItem onClick={() => void savePreferences({ theme: mode === "dark" ? "light" : "dark" })}>
          <ListItemIcon>{mode === "dark" ? <Sun size={16} /> : <Moon size={16} />}</ListItemIcon>
          <ListItemText>{mode === "dark" ? "Switch to daylight" : "Switch to night"}</ListItemText>
        </MenuItem>
        <MenuItem onClick={run(onLauncher)}>
          <ListItemIcon>
            <LayoutGrid size={16} />
          </ListItemIcon>
          <ListItemText>Open launcher</ListItemText>
        </MenuItem>
        <MenuItem onClick={run(onShortcuts)}>
          <ListItemIcon>
            <Keyboard size={16} />
          </ListItemIcon>
          <ListItemText>Keyboard shortcuts</ListItemText>
          <Typography variant="caption" color="text.secondary" sx={{ fontFamily: MONO_STACK, ml: 2 }}>
            ?
          </Typography>
        </MenuItem>
        <Divider />
        <MenuItem onClick={run(() => void signOut())}>
          <ListItemIcon>
            <LogOut size={16} />
          </ListItemIcon>
          <ListItemText>Sign out</ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
}
