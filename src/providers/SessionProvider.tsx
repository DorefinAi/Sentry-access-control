"use client";

// Who is signed in, their preferences, and their notifications. The header,
// the sidebar profile button, the Settings modal and the notifications page read from here.
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo } from "react";
import { getMe, getNotifications, getPreferences, logout, patchNotifications, patchPreferences } from "@/lib/api";
import { ApiState, useApi } from "@/hooks/useApi";
import type { NotificationList, Preferences, PreferencesPatch, Profile } from "@/types/control";
import { Action, DENIED_HINT, RoleId, can, roleOf } from "@/lib/roles";
import { useThemeMode } from "@/providers/MuiProvider";

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "system",
  density: "comfortable",
  notify: { kinds: ["alert_fired", "alert_resolved", "incident_opened", "incident_resolved", "code_change", "login_unusual", "backup", "report_ready", "team_change"], critical: true },
  defaultLanding: "/",
};

interface Session {
  me: ApiState<Profile>;
  role: RoleId | null;
  preferences: Preferences;
  savePreferences: (patch: PreferencesPatch) => Promise<string | null>;
  /** Notifications filtered to the kinds this person wants in the bell. */
  notifications: ApiState<NotificationList>;
  markRead: (ids: string[]) => Promise<void>;
  markAllRead: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}

/** Whether the signed-in role may do `action`, and the tooltip to show when not. */
export function useCan(action: Action): { allowed: boolean; reason: string } {
  const { role } = useSession();
  const allowed = can(role, action);
  return { allowed, reason: allowed || !role ? "" : DENIED_HINT[role] };
}

export default function SessionProvider({ children }: { children: ReactNode }) {
  const me = useApi("me", getMe, { refreshMs: 60_000 });
  const prefs = useApi("preferences", getPreferences);
  const raw = useApi("notifications", getNotifications, { refreshMs: 30_000 });
  const { mutate, reload } = raw;
  const { theme, density, setTheme, setDensity } = useThemeMode();

  const preferences = prefs.data ?? DEFAULT_PREFERENCES;

  // The server's appearance wins over the local cache once it arrives
  const serverTheme = prefs.data?.theme;
  const serverDensity = prefs.data?.density;
  useEffect(() => {
    if (serverTheme && serverTheme !== theme) setTheme(serverTheme);
    if (serverDensity && serverDensity !== density) setDensity(serverDensity);
    // Only when the server copy changes, not on every local toggle
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverTheme, serverDensity]);

  const { mutate: mutatePrefs } = prefs;
  const savePreferences = useCallback(
    async (patch: PreferencesPatch) => {
      // Apply at once; the server's answer replaces the guess
      if (patch.theme) setTheme(patch.theme);
      if (patch.density) setDensity(patch.density);
      mutatePrefs((p) => {
        const base = p ?? DEFAULT_PREFERENCES;
        return { ...base, ...patch, notify: { ...base.notify, ...patch.notify } } as Preferences;
      });
      try {
        mutatePrefs(await patchPreferences(patch));
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    },
    [mutatePrefs, setTheme, setDensity]
  );

  const kinds = preferences.notify.kinds;
  const notifications = useMemo<ApiState<NotificationList>>(() => {
    if (!raw.data) return raw;
    const items = raw.data.items.filter((n) => kinds.includes(n.kind));
    return { ...raw, data: { items, unread: items.filter((n) => !n.read).length } };
  }, [raw, kinds]);

  const markRead = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      // Show it read at once; the server's answer replaces the guess
      mutate((prev) => (prev ? { unread: Math.max(0, prev.unread - prev.items.filter((n) => ids.includes(n.id) && !n.read).length), items: prev.items.map((n) => (ids.includes(n.id) ? { ...n, read: true } : n)) } : { unread: 0, items: [] }));
      try {
        mutate(await patchNotifications({ ids }));
      } catch {
        reload();
      }
    },
    [mutate, reload]
  );

  const markAllRead = useCallback(async () => {
    mutate((prev) => ({ unread: 0, items: (prev?.items ?? []).map((n) => ({ ...n, read: true })) }));
    try {
      mutate(await patchNotifications({ all: true }));
    } catch {
      reload();
    }
  }, [mutate, reload]);

  const signOut = useCallback(async () => {
    try {
      await logout();
    } finally {
      window.location.assign("/login");
    }
  }, []);

  const role = roleOf(me.data);
  const value = useMemo(
    () => ({ me, role, preferences, savePreferences, notifications, markRead, markAllRead, signOut }),
    [me, role, preferences, savePreferences, notifications, markRead, markAllRead, signOut]
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
