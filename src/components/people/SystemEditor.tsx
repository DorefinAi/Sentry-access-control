"use client";

// One person's account in one system: on/off, role, pages (show/hide) and actions (allow/block).
// Nothing is sent until "Save changes"; turning an account off asks first. The backend owns the
// safety rules (the last admin stays), and its answer is shown as it comes.
//
// The editor reports whether it has unsaved changes (onDirty) so the drawer can ask before closing.
// A role change and page/action edits are saved one at a time: while the role is changed but not
// saved, the switches are locked (their defaults belong to the old role), and while switches are
// changed the role is locked.
import { Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, FormControl, FormControlLabel, FormHelperText, InputLabel, MenuItem, Select, Switch, Typography } from "@mui/material";
import { RotateCcw, ShieldAlert } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { ApiRequestError, getPersonPermissions, patchPerson, putPersonOverrides } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { invalidate } from "@/lib/invalidate";
import { dropKey, draftFrom, effective, hasChanges, planSave, setKey, type Draft } from "@/lib/people";
import type { CatalogueEntry, OwnerUser, PeopleSystem, PermissionState, SystemStatus } from "@/types/people";
import { SYSTEM_LABEL } from "@/types/people";
import { AsyncView, EmptyNote, LoadingRows } from "@/components/common/AsyncView";
import { ConsoleLabel } from "@/components/common/Bits";
import { When } from "./parts";
import { Result } from "@/components/settings/parts";

type Msg = { ok: boolean; text: string; code?: string } | null;

function Tag({ exception, roleAllowed, group }: { exception: boolean; roleAllowed: boolean | null; group: CatalogueEntry["group"] }) {
  const roleWord = roleAllowed === null ? "" : group === "pages" ? (roleAllowed ? "shown" : "hidden") : roleAllowed ? "allowed" : "blocked";
  return (
    <Box
      component="span"
      sx={{
        px: 0.75,
        py: "1px",
        borderRadius: "2px",
        border: 1,
        borderColor: exception ? "warning.main" : "divider",
        color: exception ? "warning.main" : "text.secondary",
        fontSize: "0.75rem",
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {exception ? (roleWord ? `Exception (role: ${roleWord})` : "Exception") : "Role default"}
    </Box>
  );
}

function PermRow({ entry, p, draft, onSet, onDrop, notFor, locked }: { entry: CatalogueEntry; p: PermissionState; draft: Draft; onSet: (v: boolean) => void; onDrop: () => void; notFor: string | null; locked: boolean }) {
  const on = effective(p, draft);
  const exception = p.key in draft;
  const droppedUnknown = !exception && p.source === "override" && p.roleAllowed === null; // role value appears after saving
  const id = useId();
  const word = entry.group === "pages" ? (on ? "Shown" : "Hidden") : on ? "Allowed" : "Blocked";
  return (
    <Box component="li" sx={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 1, alignItems: "center", py: 1, "& + &": { borderTop: 1, borderColor: "divider" } }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography id={`${id}-l`} variant="body2" sx={{ fontWeight: 600 }}>
          {entry.label}
        </Typography>
        {entry.description ? (
          <Typography id={`${id}-d`} variant="caption" color="text.secondary" component="p">
            {entry.description}
          </Typography>
        ) : null}
        <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap", mt: 0.5 }}>
          {notFor ? (
            <Typography variant="caption" color="text.secondary">
              Does not apply to the {notFor} role
            </Typography>
          ) : droppedUnknown ? (
            <Typography variant="caption" color="text.secondary">
              Back to the role when saved
            </Typography>
          ) : (
            <Tag exception={exception} roleAllowed={p.roleAllowed} group={entry.group} />
          )}
          {exception && !locked ? (
            <Button size="small" onClick={onDrop} sx={{ minHeight: 28, py: 0, px: 1 }} aria-label={`Use the role default for ${entry.label}`}>
              Use role default
            </Button>
          ) : null}
        </Box>
      </Box>
      <FormControlLabel
        labelPlacement="start"
        sx={{ m: 0, gap: 0.5, "& .MuiFormControlLabel-label": { fontSize: "0.8125rem", minWidth: 58, textAlign: "right", color: on ? "text.primary" : "text.secondary" } }}
        control={<Switch checked={on} disabled={!!notFor || locked} onChange={(e) => onSet(e.target.checked)} slotProps={{ input: { "aria-labelledby": `${id}-l`, "aria-describedby": entry.description ? `${id}-d` : undefined } }} />}
        label={word}
      />
    </Box>
  );
}

function PermGroup({ title, hint, entries, perms, draft, setDraft, role, roleName, locked }: { title: string; hint: string; entries: CatalogueEntry[]; perms: Map<string, PermissionState>; draft: Draft; setDraft: (d: Draft) => void; role: string; roleName: string; locked: boolean }) {
  // Keys the backend says mean nothing for this role are hidden (contract: appliesTo), unless an
  // exception sits on one; that stays visible, switched off, so it can be cleared. A hidden
  // exception is still in the draft, so saving never drops it (planSave sends the whole draft).
  const applies = (e: CatalogueEntry) => !e.appliesTo || e.appliesTo.includes(role);
  const shown = entries.filter((e) => perms.has(e.key) && (applies(e) || e.key in draft || perms.get(e.key)!.source === "override"));
  const hidden = entries.filter((e) => perms.has(e.key)).length - shown.length;
  if (!shown.length && !hidden) return null;
  return (
    <Box component="section" aria-label={title}>
      <ConsoleLabel component="h3">{title}</ConsoleLabel>
      <Typography variant="caption" color="text.secondary" component="p">
        {hint}
      </Typography>
      <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
        {shown.map((e) => {
          const p = perms.get(e.key)!;
          const notFor = applies(e) ? null : roleName;
          return <PermRow key={e.key} entry={e} p={p} draft={draft} notFor={notFor} locked={locked} onSet={(v) => setDraft(setKey(draft, p, v))} onDrop={() => setDraft(dropKey(draft, e.key))} />;
        })}
      </Box>
      {hidden ? (
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>
          {hidden} more {hidden === 1 ? "does" : "do"} not apply to the {roleName} role and {hidden === 1 ? "is" : "are"} not shown.
        </Typography>
      ) : null}
    </Box>
  );
}

export function SystemEditor({ system, user, status, onUser, onDirty }: { system: PeopleSystem; user: OwnerUser | null; status: SystemStatus; onUser: (u: OwnerUser) => void; onDirty: (system: PeopleSystem, dirty: boolean) => void }) {
  const label = SYSTEM_LABEL[system];
  if (!status.connected) {
    return (
      <EmptyNote>
        {label} not connected. {status.message}
      </EmptyNote>
    );
  }
  if (!user) return <EmptyNote>No {label} account for this person. Accounts are created in {label} itself.</EmptyNote>;
  // A fresh editor per person, so drafts never leak between people
  return <Editor key={user.id} system={system} user={user} catalogue={status.catalogue} roles={status.roles} onUser={onUser} onDirty={onDirty} />;
}

function Editor({
  system,
  user,
  catalogue,
  roles,
  onUser,
  onDirty,
}: {
  system: PeopleSystem;
  user: OwnerUser;
  catalogue: CatalogueEntry[];
  roles: { key: string; label: string }[];
  onUser: (u: OwnerUser) => void;
  onDirty: (system: PeopleSystem, dirty: boolean) => void;
}) {
  const label = SYSTEM_LABEL[system];
  const perm = useApi(`people:perm:${system}:${user.id}`, (s) => getPersonPermissions(system, user.id, s));
  const [role, setRole] = useState<string | null>(null);
  const [active, setActive] = useState<boolean | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const roleId = useId();

  const saved = perm.data ? draftFrom(perm.data.permissions) : null;
  const current = draft ?? saved ?? {};
  const nextRole = role ?? user.role;
  const nextActive = active ?? user.active;
  const roleChanged = nextRole !== user.role;
  const plan = planSave({ user, nextRole, nextActive, saved, draft: current });
  const permsChanged = saved !== null && draft !== null && plan.overrides !== null;
  const dirty = hasChanges(plan) || (roleChanged && draft !== null);
  const roleLabel = (k: string) => roles.find((r) => r.key === k)?.label ?? k;
  // The catalogue's order and words; keys it does not list still show, under their own name
  const known = new Set(catalogue.map((c) => c.key));
  const extras: CatalogueEntry[] = (perm.data?.permissions ?? []).filter((p) => !known.has(p.key)).map((p) => ({ key: p.key, group: p.key.startsWith("page.") ? "pages" : "actions", label: p.key, description: "", appliesTo: null }));
  const entries = [...catalogue, ...extras];

  // Tell the drawer, which asks before closing with unsaved changes; clear it when this editor goes
  useEffect(() => {
    onDirty(system, dirty);
  }, [dirty, onDirty, system]);
  useEffect(() => () => onDirty(system, false), [onDirty, system]);

  const discard = () => {
    setRole(null);
    setActive(null);
    setDraft(null);
    setMsg(null);
  };

  const save = async () => {
    setBusy(true);
    setMsg(null);
    let latest = user;
    let patched = false;
    const done: string[] = [];
    try {
      if (plan.patch) {
        const { user: u } = await patchPerson(system, user.id, plan.patch);
        latest = u;
        patched = true;
        onUser(u);
        setRole(null);
        setActive(null);
        if (plan.patch.role !== undefined) done.push(`role is now ${u.roleLabel}`);
        if (plan.patch.active !== undefined) done.push(u.active ? "account turned on" : "account turned off and signed out");
      }
      if (plan.overrides) {
        const next = await putPersonOverrides(system, user.id, plan.overrides);
        perm.mutate(next);
        setDraft(null);
        onUser({ ...latest, overrides: plan.overrides });
        done.push(plan.overrides.length ? `${plan.overrides.length} ${plan.overrides.length === 1 ? "exception" : "exceptions"} saved` : "pages and actions reset to the role");
      } else if (patched) {
        perm.reload(); // the new role's defaults
      }
      invalidate("people:history");
      setMsg({ ok: true, text: `Saved: ${done.join(", ")}.` });
    } catch (e) {
      const err = e as ApiRequestError;
      const prefix = done.length ? `Partly saved (${done.join(", ")}). ` : "";
      setMsg({ ok: false, text: prefix + err.message, code: err.code });
      if (err.code === "outcome_unknown") {
        // It may have been saved: reload this person's pages and actions, the list and the history
        perm.reload();
        invalidate("people");
      } else if (patched) {
        perm.reload(); // the PATCH went through; show what the account has now
      }
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  const onSave = () => (plan.patch?.active === false ? setConfirming(true) : void save());
  const pages = entries.filter((e) => e.group === "pages");
  const actions = entries.filter((e) => e.group === "actions");

  return (
    <Box sx={{ display: "grid", gap: 2 }}>
      <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", sm: "auto minmax(0, 1fr)" }, alignItems: "center" }}>
        <FormControlLabel
          sx={{ m: 0, gap: 1 }}
          control={<Switch checked={nextActive} disabled={busy} onChange={(e) => setActive(e.target.checked === user.active ? null : e.target.checked)} />}
          label={
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {nextActive ? "Account on" : "Account off"}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {user.lastLoginAt ? <When iso={user.lastLoginAt} prefix="last sign-in " /> : "no sign-in on record"}
              </Typography>
            </Box>
          }
        />
        <FormControl size="small" sx={{ minWidth: 0 }} disabled={busy || permsChanged}>
          <InputLabel id={roleId}>Role in {label}</InputLabel>
          <Select
            labelId={roleId}
            label={`Role in ${label}`}
            value={roles.some((r) => r.key === nextRole) ? nextRole : ""}
            onChange={(e) => setRole(e.target.value === user.role ? null : e.target.value)}
            displayEmpty
            inputProps={{ "aria-describedby": permsChanged ? `${roleId}-why` : undefined }}
          >
            {roles.some((r) => r.key === user.role) ? null : (
              <MenuItem value="" disabled>
                {user.roleLabel} (not in the list)
              </MenuItem>
            )}
            {roles.map((r) => (
              <MenuItem key={r.key} value={r.key}>
                {r.label}
              </MenuItem>
            ))}
          </Select>
          {permsChanged ? <FormHelperText id={`${roleId}-why`}>Save or discard the page and action changes first.</FormHelperText> : null}
        </FormControl>
      </Box>
      {roleChanged ? (
        <Typography variant="body2" color="text.secondary" role="status">
          Save the role first. Pages and actions are locked until then, because their defaults change with the role ({roleLabel(user.role)} now, {roleLabel(nextRole)} after saving); exceptions stay.
        </Typography>
      ) : null}

      <AsyncView state={perm} what="pages and actions" loading={<LoadingRows rows={5} height={52} />}>
        {(d) => {
          const map = new Map(d.permissions.map((p) => [p.key, p]));
          const count = Object.keys(current).length;
          const locked = roleChanged || busy;
          return (
            <Box sx={{ display: "grid", gap: 2 }}>
              <PermGroup title="Pages" hint="Which screens they can open." entries={pages} perms={map} draft={current} setDraft={setDraft} role={user.role} roleName={roleLabel(user.role)} locked={locked} />
              <PermGroup title="Actions" hint="What they can do on those screens." entries={actions} perms={map} draft={current} setDraft={setDraft} role={user.role} roleName={roleLabel(user.role)} locked={locked} />
              <Typography variant="body2" color="text.secondary">
                {count ? `${count} ${count === 1 ? "exception" : "exceptions"} to the ${roleLabel(user.role)} role.` : `Everything follows the ${roleLabel(user.role)} role.`}
              </Typography>
            </Box>
          );
        }}
      </AsyncView>

      {msg && !msg.ok && msg.code === "last_admin" ? (
        <Box role="alert" sx={{ display: "flex", gap: 1, p: 1.5, border: 1, borderColor: "error.main", borderRadius: "4px" }}>
          <Box sx={{ color: "error.main", display: "flex", pt: "2px" }}>
            <ShieldAlert size={18} aria-hidden />
          </Box>
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              {label} needs at least one active admin
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {msg.text}
            </Typography>
          </Box>
        </Box>
      ) : (
        <Result msg={msg} />
      )}

      <Box sx={{ position: "sticky", bottom: 0, zIndex: 1, display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center", py: 1.5, bgcolor: "background.paper", borderTop: 1, borderColor: "divider" }}>
        <Button variant="contained" onClick={onSave} disabled={!hasChanges(plan) || busy}>
          {busy ? "Saving…" : `Save ${label} changes`}
        </Button>
        <Button onClick={discard} disabled={!dirty || busy}>
          Discard
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button startIcon={<RotateCcw size={14} aria-hidden />} onClick={() => setDraft({})} disabled={busy || roleChanged || !perm.data || Object.keys(current).length === 0}>
          Reset to role
        </Button>
      </Box>

      <Dialog open={confirming} onClose={() => (busy ? undefined : setConfirming(false))} aria-labelledby={`${roleId}-confirm`}>
        <DialogTitle id={`${roleId}-confirm`} sx={{ fontWeight: 700 }}>
          Turn off {user.name}&apos;s {label} account?
        </DialogTitle>
        <DialogContent>
          <DialogContentText>They are signed out of {label} everywhere at once and cannot sign in until an owner or admin turns the account back on.</DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConfirming(false)} disabled={busy} autoFocus>
            Cancel
          </Button>
          <Button variant="contained" color="error" onClick={() => void save()} disabled={busy}>
            {busy ? "Turning off…" : "Turn off and save"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
