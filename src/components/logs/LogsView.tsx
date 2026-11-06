"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Box, Button, Checkbox, FormControl, InputAdornment, InputLabel, ListItemText, MenuItem, Select, TextField, Typography } from "@mui/material";
import { RefreshCw, Search, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { getLogs, getSummary } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { useDebounced } from "@/hooks/useDebounced";
import { useClockReady } from "@/hooks/useNow";
import { LEVELS, LEVEL_LABELS, SYSTEM_IDS, SYSTEM_NAMES } from "@/lib/labels";
import { RANGE_LABELS, RangePreset, exactIst, relative } from "@/lib/time";
import type { AiSummary, LogEntry, LogLevel, LogPage, LogQuery, SystemId } from "@/types/control";
import { PageHeader, cardSx } from "@/components/common/Bits";
import { AsyncView, ErrorNote, LoadingRows } from "@/components/common/AsyncView";
import { AiSummaryBox } from "@/components/common/AiSummaryBox";
import { LogList } from "./LogList";
import { MONO_STACK } from "@/providers/MuiProvider";

const DEFAULT_RANGE: RangePreset = "24h";
const RANGE_PRESETS = Object.keys(RANGE_LABELS) as RangePreset[];
const PAGE = 100;

interface Filters {
  systems: SystemId[];
  level: LogLevel | "";
  range: RangePreset;
  q: string;
  slug: string;
}

function readFilters(p: URLSearchParams): Filters {
  // Array lookups, not `in`: "constructor" or "toString" must not pass as a value
  const systems = (p.get("system") ?? "").split(",").filter((s): s is SystemId => SYSTEM_IDS.includes(s as SystemId));
  const level = p.get("level");
  const range = p.get("range");
  return {
    systems,
    // Debug and above is every line, which is the "Every level" option
    level: level !== "debug" && LEVELS.includes(level as LogLevel) ? (level as LogLevel) : "",
    range: RANGE_PRESETS.includes(range as RangePreset) ? (range as RangePreset) : DEFAULT_RANGE,
    q: p.get("q") ?? "",
    slug: p.get("slug") ?? "",
  };
}

function toSearch(f: Filters): string {
  const s = new URLSearchParams();
  if (f.systems.length) s.set("system", f.systems.join(","));
  if (f.level) s.set("level", f.level);
  if (f.range !== DEFAULT_RANGE) s.set("range", f.range);
  if (f.q) s.set("q", f.q);
  if (f.slug) s.set("slug", f.slug);
  return s.toString();
}

function toQuery(f: Filters): LogQuery {
  // The server turns the range into times with its own clock (real for live logs, frozen for the demo)
  return { system: f.systems, level: f.level ? [f.level] : undefined, q: f.q || undefined, slug: f.slug || undefined, range: f.range, limit: PAGE };
}

const LEVEL_OPTIONS: { value: LogLevel | ""; label: string }[] = [
  { value: "", label: "Every level" },
  { value: "info", label: "Info and up" },
  { value: "warn", label: "Warnings and errors" },
  { value: "error", label: "Errors only" },
];

/** A text box that edits locally and pushes to the URL after a pause. */
function DebouncedField({ value, onCommit, label, placeholder, mono, icon }: { value: string; onCommit: (v: string) => void; label: string; placeholder: string; mono?: boolean; icon?: boolean }) {
  const [draft, setDraft] = useState(value);
  const debounced = useDebounced(draft, 350);
  // Follow the URL when it changes from outside (back button, cleared filters)
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setDraft(value);
  }
  useEffect(() => {
    if (debounced !== value) onCommit(debounced);
    // Only a settled draft should write to the URL
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  return (
    <TextField
      label={label}
      size="small"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      placeholder={placeholder}
      slotProps={{
        htmlInput: { spellCheck: false, style: mono ? { fontFamily: MONO_STACK } : undefined },
        input: icon ? { startAdornment: <InputAdornment position="start"><Search size={16} aria-hidden /></InputAdornment> } : undefined,
      }}
      sx={{ minWidth: 0 }}
    />
  );
}

const STALE_BEAT_MS = 90_000; // three missed 30 s heartbeats

/** Where the lines come from: each backend's last pull and its processes' heartbeats, or "demo data". */
function SourceStrip({ page }: { page: LogPage }) {
  // Heartbeats and pulls are real time, not the demo clock, so this ticks on its own
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  if (!page.live) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Demo data. Set <code>SAMVADIA_API_URL</code> / <code>SAMVADIA_OWNER_KEY</code> or <code>SOCIA_API_URL</code> / <code>SOCIA_OWNER_KEY</code> in <code>.env.local</code> to see the real logs.
      </Typography>
    );
  }
  return (
    <Box component="ul" aria-label="Log sources" sx={{ ...cardSx, listStyle: "none", m: 0, mb: 1.5, px: 1.5, py: 1, display: "flex", flexWrap: "wrap", gap: 2 }}>
      {page.sources.map((s) => (
        <Box component="li" key={s.source} sx={{ minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {s.label}{" "}
            <Box component="span" sx={{ fontWeight: 400, color: s.lastError ? "error.main" : "text.secondary" }}>
              {s.lastError ? `not pulling: ${s.lastError}` : s.lastOkAt ? `pulled ${relative(s.lastOkAt, now)}` : "waiting for the first pull"}
            </Box>
          </Typography>
          {s.processes.length ? (
            <Typography variant="caption" color="text.secondary" component="p" sx={{ m: 0 }}>
              {s.processes.map((p, i) => {
                const stale = now - Date.parse(p.beatAt) > STALE_BEAT_MS;
                return (
                  <Box component="span" key={p.process} title={`${p.host}, running since ${exactIst(p.startedAt)}`} sx={{ color: stale ? "warning.main" : undefined }}>
                    {i ? " · " : ""}
                    {p.process} {stale ? "silent since" : "beat"} {relative(p.beatAt, now)}
                  </Box>
                );
              })}
            </Typography>
          ) : null}
          {s.dropped ? (
            <Typography variant="caption" color="warning.main" component="p" sx={{ m: 0 }}>
              {s.dropped} lines dropped by the backend before saving
            </Typography>
          ) : null}
        </Box>
      ))}
    </Box>
  );
}

export default function LogsView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const filters = readFilters(new URLSearchParams(params.toString()));
  const focus = params.get("focus");
  const key = toSearch(filters);

  const setFilters = (patch: Partial<Filters>) => {
    const s = toSearch({ ...filters, ...patch });
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  };

  // Time presets count from the server clock, so wait for it
  const ready = useClockReady();
  const first = useApi(ready ? `logs:${key}` : null, (sig) => getLogs(toQuery(filters), sig));
  const [more, setMore] = useState<{ key: string; entries: LogEntry[]; cursor: string | null; loading: boolean; error?: Error }>({ key: "", entries: [], cursor: null, loading: false });
  const extra = more.key === key ? more : null;
  const cursor = extra ? extra.cursor : (first.data?.nextCursor ?? null);
  const entries = first.data ? [...first.data.entries, ...(extra?.entries ?? [])] : [];

  const loadMore = async () => {
    if (!cursor) return;
    setMore({ key, entries: extra?.entries ?? [], cursor, loading: true });
    try {
      const page = await getLogs({ ...toQuery(filters), cursor });
      setMore((m) => ({ key, entries: [...(m.key === key ? m.entries : []), ...page.entries], cursor: page.nextCursor, loading: false }));
    } catch (e) {
      setMore((m) => ({ ...m, loading: false, error: e as Error }));
    }
  };

  const [summary, setSummary] = useState<{ key: string; data?: AiSummary; error?: Error; loading: boolean } | null>(null);
  const shownSummary = summary?.key === key ? summary : null;
  const summarize = async () => {
    setSummary({ key, loading: true });
    try {
      const data = await getSummary({ scope: "logs", query: toQuery(filters) });
      setSummary({ key, data, loading: false });
    } catch (e) {
      setSummary({ key, error: e as Error, loading: false });
    }
  };

  const filtered = key !== "";
  const focusLoaded = !!focus && entries.some((e) => e.id === focus);
  useEffect(() => {
    if (focusLoaded) document.getElementById(`row-${focus}`)?.scrollIntoView({ block: "center" });
  }, [focusLoaded, focus]);

  return (
    <>
      <PageHeader
        title="Logs"
        subtitle="Every system's log lines in one place. Filters stay in the link, so you can share the exact view."
        action={
          <Button variant="contained" onClick={summarize} disabled={shownSummary?.loading} startIcon={<Sparkles size={16} aria-hidden />}>
            {shownSummary?.loading ? "Summarizing…" : "Summarize what I'm looking at"}
          </Button>
        }
      />

      <Box component="form" role="search" aria-label="Filter logs" onSubmit={(e) => e.preventDefault()} sx={{ ...cardSx, p: 1.5, mb: 2, display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", lg: "1.3fr 1fr 1fr 1.5fr 1.3fr" }, alignItems: "start" }}>
        <FormControl size="small" sx={{ minWidth: 0 }}>
          <InputLabel id="sys-l" shrink>
            Systems
          </InputLabel>
          <Select<SystemId[]>
            labelId="sys-l"
            label="Systems"
            multiple
            notched
            value={filters.systems}
            onChange={(e) => setFilters({ systems: (typeof e.target.value === "string" ? e.target.value.split(",") : e.target.value) as SystemId[] })}
            renderValue={(v) => (v.length === 0 ? "All systems" : v.length <= 2 ? v.map((id) => SYSTEM_NAMES[id]).join(", ") : `${v.length} systems`)}
            displayEmpty
            MenuProps={{ slotProps: { paper: { sx: { maxHeight: 360 } } } }}
          >
            {SYSTEM_IDS.map((id) => (
              <MenuItem key={id} value={id} dense>
                <Checkbox size="small" checked={filters.systems.includes(id)} sx={{ p: 0.5, mr: 1 }} />
                <ListItemText primary={SYSTEM_NAMES[id]} secondary={id} slotProps={{ secondary: { sx: { fontFamily: MONO_STACK, fontSize: "0.6875rem" } } }} />
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 0 }}>
          <InputLabel id="lvl-l" shrink>
            Level
          </InputLabel>
          <Select labelId="lvl-l" label="Level" notched value={filters.level} displayEmpty onChange={(e) => setFilters({ level: e.target.value as LogLevel | "" })} renderValue={(v) => LEVEL_OPTIONS.find((o) => o.value === v)?.label ?? LEVEL_LABELS[v as LogLevel]}>
            {LEVEL_OPTIONS.map((o) => (
              <MenuItem key={o.value || "any"} value={o.value}>
                {o.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 0 }}>
          <InputLabel id="rng-l">Time</InputLabel>
          <Select labelId="rng-l" label="Time" value={filters.range} onChange={(e) => setFilters({ range: e.target.value as RangePreset })}>
            {(Object.keys(RANGE_LABELS) as RangePreset[]).map((r) => (
              <MenuItem key={r} value={r}>
                {RANGE_LABELS[r]}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <DebouncedField label="Search messages" placeholder="ftp timeout" value={filters.q} onCommit={(q) => setFilters({ q })} icon />
        <DebouncedField label="Slug" placeholder="271026_JPR_RAIN_AV_POOJA" value={filters.slug} onCommit={(slug) => setFilters({ slug: slug.trim() })} mono />
      </Box>

      {shownSummary?.data ? (
        <Box sx={{ mb: 2 }}>
          <AiSummaryBox
            title="What these logs say"
            summary={shownSummary.data}
            action={
              <Button size="small" onClick={() => setSummary(null)} startIcon={<X size={14} aria-hidden />}>
                Hide
              </Button>
            }
          />
        </Box>
      ) : null}
      {shownSummary?.error ? (
        <Box sx={{ mb: 2 }}>
          <ErrorNote error={shownSummary.error} what="a summary" onRetry={summarize} />
        </Box>
      ) : null}

      {first.data ? <SourceStrip page={first.data} /> : null}

      <Box sx={{ ...cardSx, overflow: "hidden" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 1, flexWrap: "wrap" }}>
          <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }} aria-live="polite">
            {first.data ? `Showing ${entries.length} of ${first.data.total} matching lines, newest first` : first.loading ? "Loading…" : ""}
          </Typography>
          {focus && first.data && !focusLoaded ? (
            <Typography variant="body2" color="text.secondary" sx={{ width: "100%", order: 2 }}>
              The linked line <code>{focus}</code> is not in this view. Try “Any time” or clear the filters.
            </Typography>
          ) : null}
          {filtered ? (
            <Button size="small" onClick={() => router.replace(pathname, { scroll: false })} startIcon={<X size={14} aria-hidden />}>
              Clear filters
            </Button>
          ) : null}
          <Button size="small" onClick={first.reload} startIcon={<RefreshCw size={14} aria-hidden />}>
            Refresh
          </Button>
        </Box>
        <AsyncView state={first} what="logs" loading={<Box sx={{ p: 1.5 }}><LoadingRows rows={8} height={24} /></Box>} isEmpty={(d) => d.entries.length === 0} empty={filtered ? "No log lines match these filters. Widen the time range or clear a filter." : "No log lines in this window."}>
          {() => (
            <>
              <LogList entries={entries} focusId={focus} />
              {extra?.error ? (
                <Box sx={{ p: 1.5 }}>
                  <ErrorNote error={extra.error} what="more lines" onRetry={loadMore} />
                </Box>
              ) : null}
              {cursor ? (
                <Box sx={{ p: 1.5, textAlign: "center" }}>
                  <Button variant="outlined" onClick={loadMore} disabled={extra?.loading}>
                    {extra?.loading ? "Loading…" : "Load more"}
                  </Button>
                </Box>
              ) : (
                <Typography variant="caption" color="text.secondary" component="p" sx={{ p: 1.5, textAlign: "center" }}>
                  End of the matching lines.
                </Typography>
              )}
            </>
          )}
        </AsyncView>
      </Box>
    </>
  );
}
