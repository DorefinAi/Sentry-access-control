"use client";

// Small pieces of the People page: the system tag and the account cell (on/off and role).
import { Box, Typography } from "@mui/material";
import { exactIst } from "@/lib/time";
import type { OwnerUser, PeopleSystem } from "@/types/people";
import { SYSTEM_LABEL } from "@/types/people";
import { DISPLAY_STACK } from "@/providers/MuiProvider";

/** A time from a backend, shown exactly in IST (the console's own clock is a frozen demo day). */
export function When({ iso, prefix }: { iso: string; prefix?: string }) {
  const valid = !Number.isNaN(Date.parse(iso));
  return (
    <Box component="time" dateTime={valid ? iso : undefined} sx={{ whiteSpace: "nowrap" }}>
      {prefix}
      {valid ? exactIst(iso) : iso}
    </Box>
  );
}

export const srOnly = { position: "absolute", width: "1px", height: "1px", p: 0, m: "-1px", overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0 } as const;

/** Short system name: "Desk" and "Socia" fit a phone row; screen readers hear the full name. */
export function SystemTag({ system }: { system: PeopleSystem }) {
  return (
    <Box
      component="span"
      title={SYSTEM_LABEL[system]}
      sx={{
        px: 0.75,
        borderRadius: "2px",
        border: 1,
        borderColor: system === "samvadia" ? "primary.main" : "text.secondary",
        color: system === "samvadia" ? "primary.main" : "text.primary",
        fontFamily: DISPLAY_STACK,
        fontWeight: 700,
        fontSize: "0.6875rem",
        letterSpacing: "0.08em",
        lineHeight: 1.7,
        whiteSpace: "nowrap",
      }}
    >
      <span aria-hidden>{system === "samvadia" ? "DESK" : "SOCIA"}</span>
      <Box component="span" sx={srOnly}>
        {SYSTEM_LABEL[system]}
      </Box>
    </Box>
  );
}

/** One system's account in a people row: a lamp, on/off, and the role; or "No account". */
export function AccountCell({ user, connected, system }: { user: OwnerUser | null; connected: boolean; system: PeopleSystem }) {
  if (!connected) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ fontStyle: "italic", display: "flex", gap: 0.75, alignItems: "center" }}>
        <Box component="span" sx={{ display: { md: "none" } }}>
          <SystemTag system={system} />
        </Box>
        not connected
      </Typography>
    );
  }
  if (!user) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ display: "flex", gap: 0.75, alignItems: "center" }}>
        <Box component="span" sx={{ display: { md: "none" } }}>
          <SystemTag system={system} />
        </Box>
        <Box component="span" sx={{ ...srOnly, display: { xs: "none", md: "block" } }}>
          {SYSTEM_LABEL[system]}:{" "}
        </Box>
        No account
      </Typography>
    );
  }
  const exceptions = user.overrides.length;
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0 }}>
      <Box component="span" sx={{ display: { md: "none" }, flexShrink: 0 }}>
        <SystemTag system={system} />
      </Box>
      <Box component="span" sx={{ ...srOnly, display: { xs: "none", md: "block" } }}>
        {SYSTEM_LABEL[system]}:
      </Box>
      <Box aria-hidden sx={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, bgcolor: user.active ? "success.main" : "transparent", border: 1.5, borderColor: user.active ? "success.main" : "text.secondary" }} />
      <Typography variant="body2" sx={{ fontWeight: 600, color: user.active ? "text.primary" : "text.secondary", whiteSpace: "nowrap" }}>
        {user.active ? "On" : "Off"}
      </Typography>
      <Typography variant="body2" color="text.secondary" noWrap sx={{ minWidth: 0 }}>
        {user.roleLabel}
      </Typography>
      {exceptions ? (
        <Typography variant="caption" sx={{ color: "warning.main", whiteSpace: "nowrap" }}>
          +{exceptions}
          <Box component="span" sx={srOnly}>
            {exceptions === 1 ? " exception" : " exceptions"}
          </Box>
        </Typography>
      ) : null}
    </Box>
  );
}
