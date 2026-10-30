"use client";

// Code changes across the repos, newest first, with a filter by system and repo,
// and the latest change per system above the list.
import { Box, FormControl, InputLabel, MenuItem, Select, Typography } from "@mui/material";
import { GitCommitHorizontal } from "lucide-react";
import { useState } from "react";
import { getChanges } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { systemName } from "@/lib/labels";
import { exactIst } from "@/lib/time";
import type { CodeChange } from "@/types/control";
import { PageHeader, Raw, RelTime } from "@/components/common/Bits";
import { Panel } from "@/components/common/Panel";
import { AsyncView, EmptyNote, LoadingRows } from "@/components/common/AsyncView";
import { MONO_STACK } from "@/providers/MuiProvider";

const sysLabel = (c: CodeChange) => (c.system === "sentry" ? "Sentry" : systemName(c.system));
const SOURCE_NOTE: Record<CodeChange["source"], string> = { git: "git", "file-mtime": "file times", static: "sample" };

function ChangeRow({ c }: { c: CodeChange }) {
  return (
    <Box component="li" sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "170px minmax(0, 1fr)" }, gap: { xs: 0.5, md: 2 }, py: 1.5, "& + &": { borderTop: 1, borderColor: "divider" } }}>
      <Box>
        <Typography variant="body2" sx={{ fontFamily: MONO_STACK }} title={exactIst(c.at)}>
          <RelTime iso={c.at} />
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {c.author}
        </Typography>
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
          <Box sx={{ color: "primary.main", pt: "3px", flexShrink: 0 }}>
            <GitCommitHorizontal size={15} aria-hidden />
          </Box>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {c.summary}
          </Typography>
        </Box>
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.25, display: "flex", gap: 1.25, flexWrap: "wrap", alignItems: "baseline" }}>
          <span>{sysLabel(c)}</span>
          <Raw sx={{ color: "text.primary" }}>{c.repo}</Raw>
          {c.ref ? <Raw>{c.ref.slice(0, 10)}</Raw> : null}
          <span>from {SOURCE_NOTE[c.source]}</span>
        </Typography>
        {c.files.length ? (
          <Box component="ul" aria-label="Files changed" sx={{ listStyle: "none", m: 0, mt: 0.75, p: 0, display: "flex", flexWrap: "wrap", gap: 0.5 }}>
            {c.files.map((f) => (
              <Box component="li" key={f} sx={{ px: 0.75, py: 0.25, border: 1, borderColor: "divider", borderRadius: "2px", bgcolor: "var(--ops-screen)" }}>
                <Raw>{f}</Raw>
              </Box>
            ))}
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}

export default function ChangesView() {
  const state = useApi("changes", getChanges, { refreshMs: 60_000 });
  const [system, setSystem] = useState("");
  const [repo, setRepo] = useState("");

  return (
    <>
      <PageHeader title="Changes" subtitle="Code changes across every repo, newest first. When something broke right after a change, start here." />
      <AsyncView state={state} what="code changes" loading={<LoadingRows rows={5} height={70} />} isEmpty={(d) => d.length === 0} empty="No code changes recorded yet.">
        {(all) => {
          const sorted = all.toSorted((a, b) => b.at.localeCompare(a.at));
          const systems = [...new Set(sorted.map((c) => c.system))];
          const repos = [...new Set(sorted.map((c) => c.repo))];
          const shown = sorted.filter((c) => (!system || c.system === system) && (!repo || c.repo === repo));
          const latestBySystem = systems.map((s) => sorted.find((c) => c.system === s)!);
          return (
            <Box sx={{ display: "grid", gap: 2 }}>
              <Panel n={1} title="Last change per system" id="latest">
                <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: 1, gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 260px), 1fr))" }}>
                  {latestBySystem.map((c) => (
                    <Box component="li" key={c.system} sx={{ p: 1.25, border: 1, borderColor: "divider", borderRadius: "2px", bgcolor: "var(--ops-screen)", minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {sysLabel(c)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" component="p" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.summary}>
                        {c.summary}
                      </Typography>
                      <Typography variant="caption" sx={{ fontFamily: MONO_STACK }}>
                        <RelTime iso={c.at} />
                      </Typography>
                    </Box>
                  ))}
                </Box>
              </Panel>
              <Panel
                n={2}
                title={`All changes (${shown.length})`}
                id="all"
                action={
                  <Box sx={{ display: "flex", gap: 1, py: 0.75, flexWrap: "wrap" }}>
                    <FormControl size="small" sx={{ minWidth: 150 }}>
                      <InputLabel id="ch-sys" shrink>
                        System
                      </InputLabel>
                      <Select labelId="ch-sys" label="System" notched displayEmpty value={system} onChange={(e) => setSystem(e.target.value)}>
                        <MenuItem value="">All systems</MenuItem>
                        {systems.map((s) => (
                          <MenuItem key={s} value={s}>
                            {s === "sentry" ? "Sentry" : systemName(s)}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <FormControl size="small" sx={{ minWidth: 150 }}>
                      <InputLabel id="ch-repo" shrink>
                        Repo
                      </InputLabel>
                      <Select labelId="ch-repo" label="Repo" notched displayEmpty value={repo} onChange={(e) => setRepo(e.target.value)}>
                        <MenuItem value="">All repos</MenuItem>
                        {repos.map((r) => (
                          <MenuItem key={r} value={r}>
                            {r}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Box>
                }
              >
                {shown.length ? (
                  <Box component="ol" sx={{ listStyle: "none", m: 0, p: 0 }}>
                    {shown.map((c) => (
                      <ChangeRow key={c.id} c={c} />
                    ))}
                  </Box>
                ) : (
                  <EmptyNote>No changes match. Clear a filter.</EmptyNote>
                )}
              </Panel>
            </Box>
          );
        }}
      </AsyncView>
    </>
  );
}
