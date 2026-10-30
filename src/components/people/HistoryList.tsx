"use client";

// Changes to people in both systems, newest first: who did what to whom, and what changed.
// "Show older" pages back through both systems at once. With `targets`, only those accounts.
// Older pages survive the first page's refresh (every minute, and after each save): the refreshed
// first page is merged with everything already loaded, so nothing vanishes and nothing repeats.
import { Box, Button, Typography } from "@mui/material";
import { useState } from "react";
import { getPeopleHistory } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { actionWords, actorWords, describeChange, mergeEntries } from "@/lib/people";
import type { HistoryEntry, PeopleHistory } from "@/types/people";
import { SYSTEM_LABEL } from "@/types/people";
import { AsyncView, EmptyNote, ErrorNote, LoadingRows } from "@/components/common/AsyncView";
import { SystemTag, When } from "./parts";

function EntryRow({ e, label }: { e: HistoryEntry; label: (key: string) => string }) {
  const lines = describeChange(e.before, e.after, label);
  return (
    <Box component="li" sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "150px minmax(0, 1fr)" }, gap: { xs: 0.25, sm: 1.5 }, py: 1.25, "& + &": { borderTop: 1, borderColor: "divider" } }}>
      <Box sx={{ display: "flex", flexDirection: { xs: "row", sm: "column" }, gap: { xs: 1, sm: 0.5 }, alignItems: { xs: "center", sm: "flex-start" } }}>
        <Typography variant="caption" color="text.secondary">
          <When iso={e.at} />
        </Typography>
        <SystemTag system={e.system} />
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2">
          {e.actorKind === "owner" ? (
            <Box component="span" sx={{ mr: 0.5, px: 0.5, border: 1, borderColor: "primary.main", color: "primary.main", borderRadius: "2px", fontSize: "0.6875rem", fontWeight: 700, verticalAlign: "1px" }}>
              Owner
            </Box>
          ) : null}
          <Box component="span" sx={{ fontWeight: 600 }}>
            {actorWords(e.actor, e.actorKind)}
          </Box>{" "}
          {actionWords(e.action)}{" "}
          <Box component="span" sx={{ fontWeight: 600 }}>
            {e.target.name ?? "a removed account"}
          </Box>
        </Typography>
        {lines.length ? (
          <Box component="ul" sx={{ m: 0, mt: 0.25, pl: 2.25, color: "text.secondary" }}>
            {lines.map((l, i) => (
              <Typography component="li" variant="caption" key={i} sx={{ overflowWrap: "anywhere" }}>
                {l}
              </Typography>
            ))}
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}

export function HistoryList({ targets, label = (k) => k }: { targets?: { system: string; id: string }[]; label?: (key: string) => string }) {
  const first = useApi("people:history", (s) => getPeopleHistory(undefined, s), { refreshMs: 60_000 });
  // Everything loaded beyond the current first page, with where to continue and what was missing
  const [older, setOlder] = useState<{ seen: HistoryEntry[]; next: string | null; missing: PeopleHistory["missing"] } | null>(null);
  const [prevFirst, setPrevFirst] = useState(first.data);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Error | null>(null);
  // A refreshed first page: keep the old one's entries with the older pages, so the run of
  // entries from the newest to the oldest loaded has no gap
  if (first.data !== prevFirst) {
    setPrevFirst(first.data);
    if (older && prevFirst) setOlder({ ...older, seen: mergeEntries(prevFirst.entries, older.seen) });
  }
  const next = older ? older.next : (first.data?.next ?? null);

  const more = async () => {
    if (!next) return;
    setBusy(true);
    setErr(null);
    try {
      const page = await getPeopleHistory(next);
      setOlder((o) => ({ seen: mergeEntries(o?.seen ?? [], page.entries), next: page.next, missing: page.missing }));
    } catch (e) {
      setErr(e as Error);
    } finally {
      setBusy(false);
    }
  };

  const keep = (e: HistoryEntry) => !targets || targets.some((t) => t.system === e.system && t.id === e.target.id);

  return (
    <AsyncView state={first} what="the change history" loading={<LoadingRows rows={4} height={48} />}>
      {(d) => {
        const entries = mergeEntries(d.entries, older?.seen ?? []).filter(keep);
        // What could not be read, from the first page and the latest older page, once per system
        const missing = [...new Map([...d.missing, ...(older?.missing ?? [])].map((m) => [m.system, m])).values()];
        return (
          <Box sx={{ display: "grid", gap: 1 }}>
            {missing.map((m) => (
              <Typography key={m.system} variant="body2" color="warning.main">
                {SYSTEM_LABEL[m.system]} history is missing: {m.message}
              </Typography>
            ))}
            {entries.length ? (
              <Box component="ul" aria-label="Changes" sx={{ listStyle: "none", m: 0, p: 0 }}>
                {entries.map((e) => (
                  <EntryRow key={`${e.system}|${e.at}|${e.target.id}|${e.action}|${e.actor ?? ""}`} e={e} label={label} />
                ))}
              </Box>
            ) : (
              <EmptyNote>{targets ? "No changes to this person in the history loaded so far." : "No changes recorded yet."}</EmptyNote>
            )}
            {err ? <ErrorNote error={err} onRetry={more} what="older changes" /> : null}
            {next ? (
              <Box>
                <Button variant="outlined" size="small" onClick={more} disabled={busy}>
                  {busy ? "Loading…" : "Show older changes"}
                </Button>
              </Box>
            ) : null}
          </Box>
        );
      }}
    </AsyncView>
  );
}
