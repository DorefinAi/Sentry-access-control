"use client";

import { Box, Button, TextField, Typography } from "@mui/material";
import { LogOut } from "lucide-react";
import { FormEvent, useState } from "react";
import { changePassword, getSessions, revokeOtherSessions } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { useSession } from "@/providers/SessionProvider";
import { Raw, RelTime } from "@/components/common/Bits";
import { AsyncView } from "@/components/common/AsyncView";
import { Result, SettingsSection } from "./parts";

function browserOf(ua: string) {
  const b = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${b} on ${os}` : b;
}

function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Say what is wrong before the server has to
  const problem = !next ? null : next.length < 10 ? "Use at least 10 characters." : next === current ? "Pick a password different from the current one." : again && again !== next ? "The two new passwords do not match." : null;
  const ready = current && next && again === next && !problem;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setMsg(null);
    try {
      await changePassword({ current, next });
      setCurrent("");
      setNext("");
      setAgain("");
      setMsg({ ok: true, text: "Password changed. Your other sessions have been signed out." });
    } catch (e2) {
      setMsg({ ok: false, text: (e2 as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box component="form" onSubmit={submit} noValidate sx={{ display: "grid", gap: 1.5, maxWidth: 420 }}>
      <TextField size="small" type="password" label="Current password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      <TextField size="small" type="password" label="New password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} helperText="At least 10 characters, different from the current one." />
      <TextField size="small" type="password" label="New password again" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
      {problem ? (
        <Typography variant="body2" sx={{ color: "warning.main" }}>
          {problem}
        </Typography>
      ) : null}
      <Box>
        <Button type="submit" variant="contained" disabled={busy || !ready}>
          {busy ? "Changing…" : "Change password"}
        </Button>
      </Box>
      <Result msg={msg} />
    </Box>
  );
}

function Sessions() {
  const sessions = useApi("sessions", getSessions);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const revoke = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await revokeOtherSessions();
      sessions.reload();
      setMsg({ ok: true, text: "Signed out everywhere else." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <AsyncView state={sessions} what="your sessions" isEmpty={(d) => d.length === 0} empty="No active sessions.">
      {(list) => (
        <Box sx={{ display: "grid", gap: 1.5 }}>
          <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
            {list.map((s) => (
              <Box component="li" key={s.id} sx={{ display: "flex", gap: 1.5, alignItems: "baseline", flexWrap: "wrap", py: 1, "& + &": { borderTop: 1, borderColor: "divider" } }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {browserOf(s.userAgent)}
                  {s.current ? (
                    <Box component="span" sx={{ ml: 1, color: "primary.main", fontWeight: 500 }}>
                      (this one)
                    </Box>
                  ) : null}
                </Typography>
                <Raw>{s.ip}</Raw>
                <Typography variant="caption" color="text.secondary">
                  signed in <RelTime iso={s.startedAt} />, last seen <RelTime iso={s.lastSeen} />
                </Typography>
              </Box>
            ))}
          </Box>
          <Box>
            <Button variant="outlined" onClick={revoke} disabled={busy || list.every((s) => s.current)}>
              {busy ? "Signing out…" : "Sign out other sessions"}
            </Button>
          </Box>
          <Result msg={msg} />
        </Box>
      )}
    </AsyncView>
  );
}

export function AccountTab() {
  const { signOut } = useSession();
  return (
    <Box sx={{ display: "grid", gap: 3 }}>
      <SettingsSection title="Change password" hint="Changing it signs out your other sessions.">
        <PasswordForm />
      </SettingsSection>
      <SettingsSection title="Where you are signed in">
        <Sessions />
      </SettingsSection>
      <SettingsSection title="Sign out" hint="Ends this session on this computer.">
        <Box>
          <Button variant="outlined" color="inherit" onClick={() => void signOut()} startIcon={<LogOut size={16} aria-hidden />}>
            Sign out
          </Button>
        </Box>
      </SettingsSection>
    </Box>
  );
}
