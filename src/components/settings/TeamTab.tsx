"use client";

// Team management for admins: members, roles, enable/disable, password resets.
// The server owns the guard rails (you cannot demote or disable yourself, the last
// admin stays an admin, only owners touch owners); its messages are shown as they come.
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel, MenuItem, Select, TextField, Typography } from "@mui/material";
import { KeyRound, Plus } from "lucide-react";
import { FormEvent, useState } from "react";
import { createTeamUser, getTeam, patchTeamUser } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { invalidate } from "@/lib/invalidate";
import { ROLE_LABELS, type RoleId } from "@/lib/roles";
import type { TeamRole, TeamUser } from "@/types/control";
import { useCan, useSession } from "@/providers/SessionProvider";
import { Raw, RelTime } from "@/components/common/Bits";
import { AsyncView, EmptyNote } from "@/components/common/AsyncView";
import { Result, RoleBadge, SettingsSection } from "./parts";

const ROLES: TeamRole[] = ["admin", "operator", "viewer"];
const ROLE_HINT: Record<TeamRole, string> = { owner: "Everything, including owners", admin: "Everything, including the team", operator: "Acts on alerts and incidents", viewer: "Can only look" };

// Only an owner may hand out the owner role; others see it only on an owner's own row.
const rolesFor = (viewer: RoleId | null, current?: TeamRole): TeamRole[] => (viewer === "owner" || current === "owner" ? ["owner", ...ROLES] : ROLES);
const USERNAME = /^[a-z0-9._-]{2,40}$/;

function AddMember({ onClose, onDone }: { onClose: () => void; onDone: (u: TeamUser) => void }) {
  const { role } = useSession();
  const [f, setF] = useState({ username: "", name: "", role: "operator" as TeamRole, password: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const userOk = USERNAME.test(f.username);
  const ready = userOk && f.name.trim() && f.password.length >= 10;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setErr(null);
    try {
      onDone(await createTeamUser({ ...f, name: f.name.trim() }));
    } catch (e2) {
      setErr((e2 as Error).message);
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs" slotProps={{ paper: { component: "form", onSubmit: submit } as object }}>
      <DialogTitle sx={{ fontWeight: 700 }}>Add a team member</DialogTitle>
      <DialogContent sx={{ display: "grid", gap: 2, pt: "8px !important" }}>
        <TextField
          size="small"
          label="Username"
          value={f.username}
          onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase() })}
          autoFocus
          error={!!f.username && !userOk}
          helperText="2 to 40 characters: a-z, 0-9, dot, dash, underscore."
          slotProps={{ htmlInput: { spellCheck: false, autoCapitalize: "none" } }}
        />
        <TextField size="small" label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <FormControl size="small">
          <InputLabel id="new-role">Role</InputLabel>
          <Select labelId="new-role" label="Role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as TeamRole })}>
            {rolesFor(role).map((r) => (
              <MenuItem key={r} value={r}>
                {ROLE_LABELS[r]}: {ROLE_HINT[r]}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField size="small" label="First password" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} helperText="At least 10 characters. Share it with them privately." />
        <Result msg={err ? { ok: false, text: err } : null} />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="contained" disabled={busy || !ready}>
          {busy ? "Adding…" : "Add member"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ResetPassword({ user, onClose, onDone }: { user: TeamUser; onClose: () => void; onDone: (u: TeamUser) => void }) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.length < 10) return;
    setBusy(true);
    setErr(null);
    try {
      onDone(await patchTeamUser(user.username, { password: pw }));
    } catch (e2) {
      setErr((e2 as Error).message);
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs" slotProps={{ paper: { component: "form", onSubmit: submit } as object }}>
      <DialogTitle sx={{ fontWeight: 700 }}>Reset password for {user.name}</DialogTitle>
      <DialogContent sx={{ display: "grid", gap: 2, pt: "8px !important" }}>
        <Typography variant="body2" color="text.secondary">
          Their other sessions stop working at once. Share the new password with them privately.
        </Typography>
        <TextField size="small" label="New password" type="password" autoComplete="new-password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} helperText="At least 10 characters." />
        <Result msg={err ? { ok: false, text: err } : null} />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="contained" disabled={busy || pw.length < 10}>
          {busy ? "Resetting…" : "Reset password"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function MemberRow({ u, me, onChange, onReset }: { u: TeamUser; me: string | undefined; onChange: (username: string, patch: Partial<TeamUser>) => void; onReset: (u: TeamUser) => void }) {
  const self = u.username === me;
  const { role } = useSession();
  const locked = u.role === "owner" && role !== "owner"; // the server refuses these too
  return (
    <Box
      component="li"
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", md: "minmax(0, 1.4fr) 170px 120px minmax(0, 1fr) auto" },
        gap: { xs: 1, md: 1.5 },
        alignItems: "center",
        py: 1.25,
        opacity: u.disabled ? 0.65 : 1,
        "& + &": { borderTop: 1, borderColor: "divider" },
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {u.name} {self ? <Box component="span" sx={{ color: "text.secondary", fontWeight: 400 }}>(you)</Box> : null}
        </Typography>
        <Raw>{u.username}</Raw>
      </Box>
      <FormControl size="small">
        <Select value={u.role} disabled={locked} onChange={(e) => onChange(u.username, { role: e.target.value as TeamRole })} inputProps={{ "aria-label": `Role for ${u.name}` }} renderValue={(r) => <RoleBadge role={r} />}>
          {rolesFor(role, u.role).map((r) => (
            <MenuItem key={r} value={r}>
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {ROLE_LABELS[r]}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {ROLE_HINT[r]}
                </Typography>
              </Box>
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <Typography variant="body2" sx={{ fontWeight: 600, color: u.disabled ? "text.secondary" : "success.main" }}>
        {u.disabled ? "Disabled" : "Active"}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {u.lastLoginAt ? (
          <>
            last in <RelTime iso={u.lastLoginAt} />
          </>
        ) : (
          "never signed in"
        )}
        {u.activeSessions ? `, ${u.activeSessions} active ${u.activeSessions === 1 ? "session" : "sessions"}` : ""}
      </Typography>
      <Box sx={{ display: "flex", gap: 0.75, justifyContent: { md: "flex-end" } }}>
        <Button size="small" variant="outlined" disabled={locked} onClick={() => onChange(u.username, { disabled: !u.disabled })}>
          {u.disabled ? "Enable" : "Disable"}
        </Button>
        {/* Your own password is changed under Account, which asks for the current one */}
        {self ? null : (
          <Button size="small" variant="outlined" disabled={locked} onClick={() => onReset(u)} startIcon={<KeyRound size={14} aria-hidden />}>
            Reset password
          </Button>
        )}
      </Box>
    </Box>
  );
}

export function TeamTab() {
  const allowed = useCan("team.manage").allowed;
  const { me } = useSession();
  const team = useApi(allowed ? "team" : null, getTeam);
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<TeamUser | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (!allowed) return <EmptyNote>Admins only. Ask an admin if you need someone added or their role changed.</EmptyNote>;

  const replace = (u: TeamUser) => team.mutate((list) => (list ?? []).map((x) => (x.username === u.username ? u : x)));
  const change = async (username: string, patch: Partial<TeamUser>) => {
    setMsg(null);
    try {
      const u = await patchTeamUser(username, patch);
      replace(u);
      invalidate("me", "notifications");
      setMsg({ ok: true, text: patch.role ? `${u.name} is now ${ROLE_LABELS[u.role].toLowerCase()}.` : u.disabled ? `${u.name} is disabled and signed out.` : `${u.name} is enabled.` });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };

  return (
    <Box sx={{ display: "grid", gap: 2 }}>
      <SettingsSection title="Team" hint="Everyone who can sign in to Sentry, and what they may do.">
        <Box>
          <Button variant="contained" startIcon={<Plus size={16} aria-hidden />} onClick={() => setAdding(true)}>
            Add member
          </Button>
        </Box>
      </SettingsSection>
      <Result msg={msg} />
      <AsyncView state={team} what="the team" isEmpty={(d) => d.length === 0} empty="No members yet.">
        {(list) => (
          <Box component="ul" aria-label="Team members" sx={{ listStyle: "none", m: 0, p: 0 }}>
            {list.map((u) => (
              <MemberRow key={u.username} u={u} me={me.data?.username} onChange={change} onReset={setResetting} />
            ))}
          </Box>
        )}
      </AsyncView>
      {adding ? (
        <AddMember
          onClose={() => setAdding(false)}
          onDone={(u) => {
            setAdding(false);
            team.mutate((list) => [...(list ?? []), u]);
            setMsg({ ok: true, text: `${u.name} added as ${ROLE_LABELS[u.role].toLowerCase()}.` });
          }}
        />
      ) : null}
      {resetting ? (
        <ResetPassword
          user={resetting}
          onClose={() => setResetting(null)}
          onDone={(u) => {
            setResetting(null);
            replace(u);
            setMsg({ ok: true, text: `Password reset for ${u.name}.` });
          }}
        />
      ) : null}
    </Box>
  );
}
