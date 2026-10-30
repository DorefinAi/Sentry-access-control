"use client";

// Owners only: everyone in the Assignment desk (Samvadia) and Socia, one row per person.
// Search and filter the list, open a person to change their account, role, pages and actions in
// each system, and read the change history from both. Sentry never writes either database; every
// change goes through that system's owner API, which keeps its own safety rules.
import { useRouter, useSearchParams } from "next/navigation";
import { Box, Button, ButtonBase, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Drawer, FormControl, IconButton, InputAdornment, InputLabel, ListSubheader, MenuItem, Select, Tab, Tabs, TextField, Tooltip, Typography } from "@mui/material";
import { PlugZap, Search, X } from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { getPeople } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { filterRows, NO_FILTER, type RowFilter, type StatusFilter, type SystemFilter } from "@/lib/people";
import type { NearMatch, OwnerUser, PeopleOverview, PeopleSystem, PersonRow } from "@/types/people";
import { PEOPLE_SYSTEMS, SYSTEM_LABEL } from "@/types/people";
import { useSession } from "@/providers/SessionProvider";
import { DISPLAY_STACK } from "@/providers/MuiProvider";
import { PageHeader, Raw } from "@/components/common/Bits";
import { Panel } from "@/components/common/Panel";
import { AsyncView, EmptyNote, LoadingRows } from "@/components/common/AsyncView";
import { AccountCell, SystemTag } from "./parts";
import { SystemEditor } from "./SystemEditor";
import { HistoryList } from "./HistoryList";

const COLS = { xs: "minmax(0, 1fr) minmax(0, 1fr)", md: "minmax(0, 1.3fr) minmax(0, 1fr) minmax(0, 1fr)" };

function NotConnectedNotes({ data }: { data: PeopleOverview }) {
  const off = PEOPLE_SYSTEMS.filter((s) => !data.systems[s].connected);
  if (!off.length) return null;
  return (
    <Box sx={{ display: "grid", gap: 1, mb: 2 }}>
      {off.map((s) => {
        const st = data.systems[s];
        return (
          <Box key={s} role="status" sx={{ display: "flex", gap: 1.25, p: 1.5, border: 1, borderColor: "warning.main", borderRadius: "4px", bgcolor: "background.paper" }}>
            <Box sx={{ color: "warning.main", display: "flex", pt: "2px" }}>
              <PlugZap size={18} aria-hidden />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                {SYSTEM_LABEL[s]} not connected
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                {st.connected ? "" : st.message} The rest of this page still works for {SYSTEM_LABEL[s === "samvadia" ? "socia" : "samvadia"]}.
              </Typography>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

function Filters({ data, f, setF, shown }: { data: PeopleOverview; f: RowFilter; setF: (f: RowFilter) => void; shown: number }) {
  const roleGroups = PEOPLE_SYSTEMS.flatMap((s) => {
    const st = data.systems[s];
    if (!st.connected || !st.roles.length) return [];
    return [
      <ListSubheader key={`h-${s}`}>{SYSTEM_LABEL[s]}</ListSubheader>,
      ...st.roles.map((r) => (
        <MenuItem key={`${s}:${r.key}`} value={`${s}:${r.key}`}>
          {r.label}
        </MenuItem>
      )),
    ];
  });
  return (
    <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr 1fr", md: "minmax(0, 2fr) repeat(3, minmax(0, 1fr))" }, alignItems: "center" }}>
      <TextField
        size="small"
        type="search"
        label="Search people"
        placeholder="Name, username or email"
        value={f.q}
        onChange={(e) => setF({ ...f, q: e.target.value })}
        sx={{ gridColumn: { xs: "1 / -1", md: "auto" } }}
        slotProps={{
          htmlInput: { spellCheck: false, autoCapitalize: "none", "aria-describedby": "people-count" },
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <Search size={16} aria-hidden />
              </InputAdornment>
            ),
          },
        }}
      />
      <FormControl size="small">
        <InputLabel id="f-system">System</InputLabel>
        <Select labelId="f-system" label="System" value={f.system} onChange={(e) => setF({ ...f, system: e.target.value as SystemFilter })}>
          <MenuItem value="all">Any</MenuItem>
          <MenuItem value="samvadia">Has an Assignment desk account</MenuItem>
          <MenuItem value="socia">Has a Socia account</MenuItem>
          <MenuItem value="both">In both</MenuItem>
          <MenuItem value="one">In one only</MenuItem>
        </Select>
      </FormControl>
      <FormControl size="small">
        <InputLabel id="f-status">Status</InputLabel>
        <Select labelId="f-status" label="Status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as StatusFilter })}>
          <MenuItem value="all">Any</MenuItem>
          <MenuItem value="active">On everywhere</MenuItem>
          <MenuItem value="disabled">Off somewhere</MenuItem>
        </Select>
      </FormControl>
      <FormControl size="small" sx={{ gridColumn: { xs: "1 / -1", md: "auto" } }}>
        <InputLabel id="f-role">Role</InputLabel>
        <Select labelId="f-role" label="Role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
          <MenuItem value="">Any</MenuItem>
          {roleGroups}
        </Select>
      </FormControl>
      <Typography id="people-count" variant="caption" color="text.secondary" role="status" sx={{ gridColumn: "1 / -1" }}>
        {shown === data.rows.length ? `${shown} ${shown === 1 ? "person" : "people"}` : `Showing ${shown} of ${data.rows.length} people`}
      </Typography>
    </Box>
  );
}

function PersonRowButton({ r, hint, connected, onOpen, selected }: { r: PersonRow; hint: boolean; connected: Record<PeopleSystem, boolean>; onOpen: () => void; selected: boolean }) {
  const login = r.username ?? r.email;
  return (
    <li>
      <ButtonBase
        onClick={onOpen}
        aria-current={selected ? "true" : undefined}
        sx={{
          width: "100%",
          display: "grid",
          gridTemplateColumns: COLS,
          gap: { xs: 0.75, md: 1.5 },
          alignItems: "center",
          textAlign: "left",
          px: { xs: 1, sm: 1.5 },
          py: 1.25,
          borderRadius: "2px",
          bgcolor: selected ? "action.selected" : "transparent",
          "&:hover": { bgcolor: "action.hover" },
          "&.Mui-focusVisible": { outline: "2px solid var(--focus-ring)", outlineOffset: -2 },
        }}
      >
        <Box sx={{ minWidth: 0, gridColumn: { xs: "1 / -1", md: "auto" } }}>
          <Typography variant="body2" sx={{ fontWeight: 600, display: "flex", gap: 0.75, alignItems: "baseline" }}>
            <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {r.name}
            </Box>
            {hint ? (
              <Typography component="span" variant="caption" sx={{ color: "warning.main", whiteSpace: "nowrap", fontWeight: 600 }}>
                maybe matches another row
              </Typography>
            ) : null}
          </Typography>
          {login ? <Raw>{login}</Raw> : null}
        </Box>
        <AccountCell user={r.samvadia} connected={connected.samvadia} system="samvadia" />
        <AccountCell user={r.socia} connected={connected.socia} system="socia" />
      </ButtonBase>
    </li>
  );
}

function NearMatches({ data, onOpen }: { data: PeopleOverview; onOpen: (key: string) => void }) {
  const byKey = new Map(data.rows.map((r) => [r.key, r]));
  if (!data.nearMatches.length) return null;
  const link = (key: string, system: PeopleSystem) => {
    const r = byKey.get(key);
    if (!r) return null;
    const u = r[system]!;
    return (
      <ButtonBase onClick={() => onOpen(key)} sx={{ display: "inline-flex", gap: 0.75, alignItems: "center", borderRadius: "2px", px: 0.5, textDecoration: "underline", textUnderlineOffset: 3, "&.Mui-focusVisible": { outline: "2px solid var(--focus-ring)" } }}>
        <SystemTag system={system} />
        <Typography component="span" variant="body2" sx={{ fontWeight: 600 }}>
          {u.name}
        </Typography>
        <Raw>{u.username ?? u.email ?? ""}</Raw>
      </ButtonBase>
    );
  };
  return (
    <Panel title="Possibly the same person" id="near">
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        These rows did not join because neither the email nor the username matches. If one is the same person, give them the same email in both systems.
      </Typography>
      <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
        {data.nearMatches.map((m: NearMatch) => (
          <Box component="li" key={`${m.a}|${m.b}`} sx={{ py: 1, display: "grid", gap: 0.5, "& + &": { borderTop: 1, borderColor: "divider" } }}>
            <Typography variant="caption" color="text.secondary">
              {m.why}
            </Typography>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, alignItems: "center" }}>
              {link(m.a, "samvadia")}
              <Typography component="span" variant="body2" color="text.secondary">
                and
              </Typography>
              {link(m.b, "socia")}
            </Box>
          </Box>
        ))}
      </Box>
    </Panel>
  );
}

type DrawerTab = PeopleSystem | "history";

/** Page and action keys to their catalogue labels, for the history lines. */
function labelsOf(data: PeopleOverview | undefined): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of PEOPLE_SYSTEMS) {
    const st = data?.systems[s];
    if (st?.connected) st.catalogue.forEach((c) => m.set(c.key, c.label));
  }
  return m;
}

function PersonPanel({
  row,
  data,
  onUser,
  onClose,
  onDirty,
  hints,
  gone,
}: {
  row: PersonRow;
  data: PeopleOverview;
  onUser: (system: PeopleSystem, u: OwnerUser) => void;
  onClose: () => void;
  onDirty: (system: PeopleSystem, dirty: boolean) => void;
  hints: number;
  gone: boolean;
}) {
  const [tab, setTab] = useState<DrawerTab>(row.samvadia || !row.socia ? "samvadia" : "socia");
  const labels = useMemo(() => labelsOf(data), [data]);
  const targets = PEOPLE_SYSTEMS.flatMap((s) => (row[s] ? [{ system: s, id: row[s]!.id }] : []));
  return (
    <Box sx={{ display: "flex", flexDirection: "column", minHeight: "100%" }}>
      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1, px: { xs: 2, sm: 3 }, pt: { xs: 2, sm: 2.5 } }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography component="h2" id="person-title" sx={{ fontFamily: DISPLAY_STACK, fontWeight: 600, fontSize: "1.25rem", lineHeight: 1.25 }}>
            {row.name}
          </Typography>
          <Box sx={{ display: "flex", gap: 1.25, flexWrap: "wrap" }}>
            {row.username ? <Raw>{row.username}</Raw> : null}
            {row.email ? <Raw>{row.email}</Raw> : null}
          </Box>
          {hints ? (
            <Typography variant="caption" sx={{ color: "warning.main" }}>
              Another row looks like this person. See &quot;Possibly the same person&quot;.
            </Typography>
          ) : null}
        </Box>
        <Tooltip title="Close (Esc)">
          <IconButton aria-label="Close person" onClick={onClose} sx={{ border: 1, borderColor: "divider", borderRadius: "6px", width: 40, height: 40 }}>
            <X size={18} />
          </IconButton>
        </Tooltip>
      </Box>
      {gone ? (
        <Typography role="status" variant="body2" sx={{ mx: { xs: 2, sm: 3 }, mt: 1, p: 1, border: 1, borderColor: "warning.main", borderRadius: "4px" }}>
          This person&apos;s row changed in the list since you opened it (their accounts were matched differently). Your unsaved changes are kept here: save or discard them, then
          open the person again from the list.
        </Typography>
      ) : null}
      <Tabs value={tab} onChange={(_, v: DrawerTab) => setTab(v)} variant="scrollable" scrollButtons={false} aria-label="Systems" sx={{ borderBottom: 1, borderColor: "divider", px: { xs: 1, sm: 2 }, mt: 1 }}>
        {PEOPLE_SYSTEMS.map((s) => (
          <Tab key={s} value={s} id={`tab-${s}`} aria-controls={`panel-${s}`} label={`${SYSTEM_LABEL[s]}${row[s] ? "" : " (none)"}`} />
        ))}
        <Tab value="history" id="tab-history" aria-controls="panel-history" label="History" />
      </Tabs>
      {/* Both editors stay mounted, so switching tabs never loses a draft or a save message */}
      {PEOPLE_SYSTEMS.map((s) => (
        <Box key={s} id={`panel-${s}`} role="tabpanel" aria-labelledby={`tab-${s}`} hidden={tab !== s} sx={{ px: { xs: 2, sm: 3 }, pt: 2, flex: 1 }}>
          <SystemEditor system={s} user={row[s]} status={data.systems[s]} onUser={(u) => onUser(s, u)} onDirty={onDirty} />
        </Box>
      ))}
      <Box id="panel-history" role="tabpanel" aria-labelledby="tab-history" hidden={tab !== "history"} sx={{ px: { xs: 2, sm: 3 }, pt: 2, pb: 2, flex: 1 }}>
        {tab === "history" ? <HistoryList targets={targets} label={(k) => labels.get(k) ?? k} /> : null}
      </Box>
    </Box>
  );
}

const CLEAN: Record<PeopleSystem, boolean> = { samvadia: false, socia: false };

export default function PeopleView() {
  const { role } = useSession();
  const owner = role === "owner";
  const router = useRouter();
  const params = useSearchParams();
  const openKey = params.get("p");
  const state = useApi(owner ? "people" : null, getPeople, { refreshMs: 120_000 });
  const [f, setF] = useState<RowFilter>(NO_FILTER);
  const deferred = useDeferredValue(f);
  const labels = useMemo(() => labelsOf(state.data), [state.data]);
  // Unsaved changes per system in the open drawer (reported by the editors)
  const [dirty, setDirty] = useState(CLEAN);
  const [asking, setAsking] = useState(false);
  const [lastRow, setLastRow] = useState<PersonRow | null>(null);
  const anyDirty = dirty.samvadia || dirty.socia;
  const onDirty = useCallback((s: PeopleSystem, d: boolean) => setDirty((prev) => (prev[s] === d ? prev : { ...prev, [s]: d })), []);

  const open = useCallback(
    (key: string | null) => {
      const s = new URLSearchParams(params.toString());
      if (key) s.set("p", key);
      else s.delete("p");
      const qs = s.toString();
      router.replace(qs ? `/people?${qs}` : "/people", { scroll: false });
    },
    [params, router]
  );
  const requestClose = () => (anyDirty ? setAsking(true) : open(null));

  const replaceUser = (key: string, system: PeopleSystem, u: OwnerUser) => {
    const base = state.data;
    if (!base) return; // nothing loaded to update; the next load brings it
    state.mutate((prev) => {
      const cur = prev ?? base;
      return { ...cur, rows: cur.rows.map((r) => (r.key === key ? { ...r, [system]: u } : r)) };
    });
  };

  const data = state.data;
  const found = data?.rows.find((r) => r.key === openKey) ?? null;
  // Remember the open row, so a refresh that re-matches it does not throw away unsaved changes
  if (found && found !== lastRow) setLastRow(found);
  const kept = !found && anyDirty && lastRow?.key === openKey ? lastRow : null;
  const selected = found ?? kept;

  // A link to someone who is no longer in the list: drop it from the address
  useEffect(() => {
    if (data && openKey && !selected) open(null);
  }, [data, openKey, selected, open]);

  if (role === null) return <LoadingRows rows={6} />;
  if (!owner) {
    return (
      <>
        <PageHeader title="People" />
        <EmptyNote>Only owners can see and change people in the Assignment desk and Socia.</EmptyNote>
      </>
    );
  }

  const hinted = new Set(data?.nearMatches.flatMap((m) => [m.a, m.b]) ?? []);

  return (
    <>
      <PageHeader title="People" subtitle="Everyone in the Assignment desk and Socia, one row per person. Open someone to change their account, role, pages and actions." />
      {data ? <NotConnectedNotes data={data} /> : null}
      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "minmax(0, 1fr)", lg: "minmax(0, 1fr) 380px" }, alignItems: "start" }}>
        <Panel title="People" id="people">
          <AsyncView state={state} what="people" loading={<LoadingRows rows={6} height={52} />}>
            {(d) => {
              const connected = { samvadia: d.systems.samvadia.connected, socia: d.systems.socia.connected };
              const rows = filterRows(d.rows, deferred);
              return (
                <Box sx={{ display: "grid", gap: 1.5 }}>
                  <Filters data={d} f={f} setF={setF} shown={rows.length} />
                  <Box aria-hidden sx={{ display: { xs: "none", md: "grid" }, gridTemplateColumns: COLS, gap: 1.5, px: 1.5, pb: 0.5, borderBottom: 1, borderColor: "divider" }}>
                    {["Person", SYSTEM_LABEL.samvadia, SYSTEM_LABEL.socia].map((h) => (
                      <Typography key={h} sx={{ fontFamily: DISPLAY_STACK, fontSize: "0.75rem", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "text.secondary" }}>
                        {h}
                      </Typography>
                    ))}
                  </Box>
                  {!d.rows.length ? (
                    <EmptyNote>No people to show. Connect at least one system in Sentry&apos;s .env.local.</EmptyNote>
                  ) : rows.length ? (
                    <Box component="ul" aria-label="People" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", "& > li + li": { borderTop: 1, borderColor: "divider" } }}>
                      {rows.map((r) => (
                        <PersonRowButton key={r.key} r={r} hint={hinted.has(r.key)} connected={connected} selected={r.key === openKey} onOpen={() => open(r.key)} />
                      ))}
                    </Box>
                  ) : (
                    <EmptyNote>Nobody matches. Try fewer words or clear a filter.</EmptyNote>
                  )}
                </Box>
              );
            }}
          </AsyncView>
        </Panel>
        <Box sx={{ display: "grid", gap: 2, minWidth: 0 }}>
          {data ? <NearMatches data={data} onOpen={open} /> : null}
          <Panel title="Change history" id="history">
            <HistoryList label={(k) => labels.get(k) ?? k} />
          </Panel>
        </Box>
      </Box>

      <Drawer anchor="right" open={!!selected} onClose={requestClose} slotProps={{ paper: { sx: { width: { xs: "100%", sm: 640 } }, role: "dialog", "aria-modal": true, "aria-labelledby": "person-title" } }}>
        {selected && data ? (
          <PersonPanel
            key={selected.key}
            row={selected}
            data={data}
            hints={hinted.has(selected.key) ? 1 : 0}
            gone={!found}
            onUser={(s, u) => replaceUser(selected.key, s, u)}
            onClose={requestClose}
            onDirty={onDirty}
          />
        ) : null}
      </Drawer>
      <Dialog open={asking} onClose={() => setAsking(false)} aria-labelledby="discard-title">
        <DialogTitle id="discard-title" sx={{ fontWeight: 700 }}>
          Discard unsaved changes?
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            {PEOPLE_SYSTEMS.filter((s) => dirty[s])
              .map((s) => SYSTEM_LABEL[s])
              .join(" and ")}{" "}
            has changes that are not saved yet. Closing throws them away.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setAsking(false)} autoFocus>
            Keep editing
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => {
              setAsking(false);
              open(null);
            }}
          >
            Discard and close
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
