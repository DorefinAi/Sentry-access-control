"use client";

import { Box, Chip, FormControl, InputLabel, MenuItem, Select, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from "@mui/material";
import { useState } from "react";
import { getLogins } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { useClockReady } from "@/hooks/useNow";
import { APP_LABELS, LOGIN_FLAG_LABELS, LOGIN_RESULT_LABELS } from "@/lib/labels";
import { clockIst, exactIst, todayIst } from "@/lib/time";
import type { AppName, LoginEvent, LoginReport } from "@/types/control";
import { HealthLabel } from "@/components/common/Health";
import { Raw, RelTime, Section, Stat } from "@/components/common/Bits";
import { AsyncView, EmptyNote, LoadingRows } from "@/components/common/AsyncView";

function FlagChips({ flags }: { flags: LoginEvent["flags"] }) {
  if (!flags.length) return null;
  return (
    <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
      {flags.map((f) => (
        <Chip key={f} size="small" variant="outlined" label={LOGIN_FLAG_LABELS[f]} sx={{ height: 22, fontSize: "0.75rem", color: "warning.main", borderColor: "warning.main" }} />
      ))}
    </Box>
  );
}

function EventRows({ events, focus, flagsFirst }: { events: LoginEvent[]; focus?: string | null; flagsFirst?: boolean }) {
  return (
    <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
      {events.map((e) => (
        <Box
          component="li"
          key={e.id}
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "72px 140px minmax(0, 1fr) 130px minmax(0, 1fr)" },
            gap: { xs: 0.25, md: 1.5 },
            alignItems: "center",
            py: 1,
            px: 1,
            bgcolor: e.id === focus ? "action.selected" : undefined,
            "& + &": { borderTop: 1, borderColor: "divider" },
          }}
        >
          {flagsFirst ? (
            <Box sx={{ gridColumn: "1 / -1" }}>
              <FlagChips flags={e.flags} />
            </Box>
          ) : null}
          <Typography component="time" dateTime={e.at} title={exactIst(e.at)} variant="body2" sx={{ fontFamily: "var(--font-mono), monospace", fontSize: "0.75rem", color: "text.secondary" }}>
            {clockIst(e.at)}
          </Typography>
          <HealthLabel health={e.result === "success" ? "ok" : e.result === "bad_password" ? "warn" : "down"} label={LOGIN_RESULT_LABELS[e.result]} size="caption" />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>
              {e.name ?? e.user}
            </Typography>
            <Raw>
              {e.user}
              {e.role ? `, ${e.role}` : ""}
            </Raw>
          </Box>
          <Typography variant="body2">{APP_LABELS[e.app]}</Typography>
          <Box sx={{ minWidth: 0 }}>
            <Raw sx={{ color: "text.primary" }}>{e.ip}</Raw>
            <Typography variant="caption" color="text.secondary" component="p" title={e.userAgent} sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {e.userAgent}
            </Typography>
            {!flagsFirst ? <FlagChips flags={e.flags} /> : null}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

function Report({ r, focus }: { r: LoginReport; focus?: string | null }) {
  return (
    <Box sx={{ display: "grid", gap: 2 }}>
      <Section title="Unusual sign-ins" id="unusual">
        {r.unusual.length ? <EventRows events={r.unusual} focus={focus} flagsFirst /> : <EmptyNote>Nothing unusual: no new IPs, off-hours sign-ins or repeated failures.</EmptyNote>}
      </Section>
      <Section title="Totals" id="login-totals">
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 2 }}>
          <Stat label="Signed in" value={r.totals.success} />
          <Stat label="Failed" value={r.totals.failed} />
          <Stat label="People" value={r.totals.uniqueUsers} />
          <Stat label="Active sessions" value={r.totals.activeSessions} />
        </Box>
        <TableContainer sx={{ mt: 2 }}>
          <Table size="small" aria-label="Sign-ins per app">
            <TableHead>
              <TableRow>
                <TableCell>App</TableCell>
                <TableCell align="right">Signed in</TableCell>
                <TableCell align="right">Failed</TableCell>
                <TableCell align="right">Active</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {r.byApp.map((a) => (
                <TableRow key={a.app}>
                  <TableCell>{APP_LABELS[a.app]}</TableCell>
                  <TableCell align="right">{a.success}</TableCell>
                  <TableCell align="right" sx={{ color: a.failed ? "error.main" : undefined, fontWeight: a.failed ? 700 : undefined }}>
                    {a.failed}
                  </TableCell>
                  <TableCell align="right">{a.activeSessions}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Section>
      <Section title="Signed in now" id="sessions">
        {r.activeSessions.length ? (
          <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
            {r.activeSessions.map((s, i) => (
              <Box component="li" key={`${s.app}-${s.user}-${i}`} sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", alignItems: "baseline", py: 0.75, "& + &": { borderTop: 1, borderColor: "divider" } }}>
                <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>
                  {s.user}
                </Typography>
                <Typography variant="body2">{APP_LABELS[s.app]}</Typography>
                <Raw>{s.ip}</Raw>
                <Typography variant="caption" color="text.secondary">
                  since <RelTime iso={s.since} />, last seen <RelTime iso={s.lastSeen} />
                </Typography>
              </Box>
            ))}
          </Box>
        ) : (
          <EmptyNote>Nobody is signed in.</EmptyNote>
        )}
      </Section>
      <Section title="Every sign-in, newest first" id="events">
        {r.events.length ? <EventRows events={r.events} focus={focus} /> : <EmptyNote>No sign-ins on this day.</EmptyNote>}
      </Section>
    </Box>
  );
}

export function LoginsTab({ focus }: { focus?: string | null }) {
  // Default to the server's today once its clock is known
  const ready = useClockReady();
  const [picked, setDate] = useState<string | null>(null);
  // A cleared date box falls back to today rather than loading nothing
  const date = picked || (ready ? todayIst() : "");
  const [app, setApp] = useState<AppName | "">("");
  const state = useApi(date ? `logins:${date}:${app}` : null, (s) => getLogins(date, app || undefined, s));
  return (
    <>
      <Box sx={{ display: "flex", gap: 1.5, alignItems: "center", mb: 2, flexWrap: "wrap" }}>
        <TextField type="date" label="Day" size="small" value={date} onChange={(e) => setDate(e.target.value)} slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: ready ? todayIst() : undefined } }} />
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel id="app-l" shrink>
            App
          </InputLabel>
          <Select labelId="app-l" label="App" notched displayEmpty value={app} onChange={(e) => setApp(e.target.value as AppName | "")}>
            <MenuItem value="">All apps</MenuItem>
            {(Object.keys(APP_LABELS) as AppName[]).map((a) => (
              <MenuItem key={a} value={a}>
                {APP_LABELS[a]}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Typography variant="body2" color="text.secondary">
          Sign-ins to the three newsroom apps only.
        </Typography>
      </Box>
      <AsyncView state={state} what="sign-ins" loading={<LoadingRows rows={4} height={64} />}>
        {(r) => <Report r={r} focus={focus} />}
      </AsyncView>
    </>
  );
}
