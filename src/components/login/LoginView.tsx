"use client";

// Sign-in as a console start-up. Three phases:
//   boot      each console channel comes online in turn (about 2 s; skip with a
//             click or any key; skipped under prefers-reduced-motion)
//   sign in   the form; a wrong password says so plainly
//   launcher  the newsroom products with live health, then on to Sentry
// The boot lines describe the console's own channels opening, not system health:
// health is only known after sign-in.
import { useRouter, useSearchParams } from "next/navigation";
import { Box, Button, IconButton, TextField, Tooltip, Typography } from "@mui/material";
import { Moon, Sun } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { ApiRequestError, getLauncher, getPreferences, login } from "@/lib/api";
import type { LauncherApp, Profile } from "@/types/control";
import { ConsoleLabel } from "@/components/common/Bits";
import { LauncherGrid } from "@/components/launcher/LauncherGrid";
import { safeNext } from "@/lib/safeNext";
import { DISPLAY_STACK, MONO_STACK, useThemeMode } from "@/providers/MuiProvider";

const CHANNELS = [
  "Postgres",
  "Samvadia API",
  "Samvadia worker",
  "FTP",
  "Octopus feed",
  "Socia ingest",
  "Socia render",
  "Socia publish",
  "Ollama (Qwen)",
  "Nightly backups",
  "WhatsApp",
  "Outlook",
  "X",
];
const STEP_MS = 140;

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read the user's setting after hydration
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

function BootPanel({ lit, done }: { lit: number; done: boolean }) {
  return (
    <Box aria-hidden={!done} sx={{ fontFamily: MONO_STACK, fontSize: { xs: "0.75rem", sm: "0.8125rem" }, lineHeight: 1.75 }}>
      <ConsoleLabel component="p" sx={{ mb: 1 }}>
        Console start-up
      </ConsoleLabel>
      <Box component="ol" sx={{ listStyle: "none", m: 0, p: 0, columns: { xs: 2, md: 1 }, columnGap: 3 }}>
        {CHANNELS.map((c, i) => {
          const on = i < lit;
          return (
            <Box component="li" key={c} sx={{ display: "flex", alignItems: "center", gap: 1, breakInside: "avoid", color: on ? "text.primary" : "text.secondary", opacity: on ? 1 : 0.35, transition: "opacity 160ms, color 160ms" }}>
              <Box component="span" sx={{ width: 8, height: 8, borderRadius: "2px", flexShrink: 0, bgcolor: on ? "primary.main" : "divider", boxShadow: on ? "0 0 8px var(--ops-brand)" : "none", transition: "background-color 160ms, box-shadow 160ms" }} />
              <Box component="span" sx={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {c}
              </Box>
              <Box component="span" sx={{ display: { xs: "none", md: "inline" }, color: on ? "primary.main" : "transparent", fontSize: "0.6875rem", letterSpacing: "0.06em" }}>
                CHANNEL OPEN
              </Box>
            </Box>
          );
        })}
      </Box>
      <Typography role="status" sx={{ mt: 1.5, fontFamily: DISPLAY_STACK, fontWeight: 700, letterSpacing: "0.12em", fontSize: "0.875rem", color: done ? "primary.main" : "text.secondary" }}>
        {done ? "ALL CHANNELS OPEN. SENTRY READY." : `OPENING CHANNELS ${lit}/${CHANNELS.length}`}
      </Typography>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ fontFamily: "inherit", mt: 0.5 }}>
        Live health of each system shows after you sign in.
      </Typography>
    </Box>
  );
}

function SignInForm({ onSignedIn }: { onSignedIn: (p: Profile) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const userRef = useRef<HTMLInputElement>(null);

  useEffect(() => userRef.current?.focus(), []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await login({ username: username.trim(), password });
      onSignedIn(res.profile);
    } catch (e2) {
      const status = e2 instanceof ApiRequestError ? e2.status : 0;
      setErr(status === 401 ? "That username and password do not match. Check both and try again." : (e2 as Error).message);
      setBusy(false);
    }
  };

  return (
    <Box component="form" onSubmit={submit} noValidate sx={{ display: "grid", gap: 2 }}>
      <Box>
        <Typography component="h1" sx={{ fontFamily: DISPLAY_STACK, fontWeight: 600, fontSize: { xs: "1.75rem", sm: "2.25rem" }, lineHeight: 1.1 }}>
          Sign in to Sentry
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Mission control for the Vartmaan newsroom pipelines.
        </Typography>
      </Box>
      <TextField inputRef={userRef} label="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required fullWidth slotProps={{ htmlInput: { spellCheck: false, autoCapitalize: "none" } }} />
      <TextField label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required fullWidth />
      {err ? (
        <Typography role="alert" variant="body2" sx={{ color: "error.main", fontWeight: 500 }}>
          {err}
        </Typography>
      ) : null}
      <Button type="submit" variant="contained" size="large" disabled={busy || !username.trim() || !password} sx={{ minHeight: 44, fontFamily: DISPLAY_STACK, letterSpacing: "0.06em" }}>
        {busy ? "Signing in…" : "Sign in"}
      </Button>
    </Box>
  );
}

function Launcher({ profile, next }: { profile: Profile; next: string | null }) {
  const router = useRouter();
  const [apps, setApps] = useState<LauncherApp[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [landing, setLanding] = useState("/");
  useEffect(() => {
    getLauncher().then(setApps, () => setFailed(true));
    // Without a ?next, Sentry opens on the screen the person chose in Settings
    getPreferences().then((p) => setLanding(p.defaultLanding), () => undefined);
  }, []);
  return (
    <Box sx={{ display: "grid", gap: 2.5 }}>
      <Box sx={{ display: "flex", alignItems: "flex-end", gap: 2, flexWrap: "wrap" }}>
        <Box sx={{ flex: 1, minWidth: 220 }}>
          <ConsoleLabel component="p">Signed in</ConsoleLabel>
          <Typography component="h1" sx={{ fontFamily: DISPLAY_STACK, fontWeight: 600, fontSize: { xs: "1.75rem", sm: "2.25rem" }, lineHeight: 1.1 }}>
            Welcome, {profile.name.split(" ")[0]}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Pick where to work. Sentry opens here; the other apps open in a new tab.
          </Typography>
        </Box>
        <Button variant="contained" size="large" onClick={() => router.replace(safeNext(next, window.location.origin) ?? landing)} sx={{ minHeight: 44, fontFamily: DISPLAY_STACK, letterSpacing: "0.06em" }}>
          Enter Sentry
        </Button>
      </Box>
      {apps ? <LauncherGrid apps={apps} /> : failed ? <Typography variant="body2" color="text.secondary">The app list did not load. You can still enter Sentry.</Typography> : <Typography variant="body2" color="text.secondary">Checking each app…</Typography>}
    </Box>
  );
}

export default function LoginView() {
  const params = useSearchParams();
  const rawNext = params.get("next");
  // Checked against the origin when used (see safeNext), never trusted as is
  const next = rawNext;
  const reduced = useReducedMotion();
  const { mode, toggleTheme } = useThemeMode();
  const [lit, setLit] = useState(0);
  const [skipped, setSkipped] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const booted = skipped || reduced || lit >= CHANNELS.length;

  useEffect(() => {
    if (booted) return;
    const id = window.setTimeout(() => setLit((n) => n + 1), STEP_MS);
    return () => window.clearTimeout(id);
  }, [lit, booted]);

  // Any key or click skips the start-up
  useEffect(() => {
    if (booted) return;
    const skip = () => setSkipped(true);
    window.addEventListener("keydown", skip);
    window.addEventListener("pointerdown", skip);
    return () => {
      window.removeEventListener("keydown", skip);
      window.removeEventListener("pointerdown", skip);
    };
  }, [booted]);

  return (
    <Box component="main" sx={{ minHeight: "100dvh", display: "flex", flexDirection: "column", px: { xs: 2, sm: 4 }, py: { xs: 2, sm: 3 } }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Box component="svg" viewBox="0 0 32 32" aria-hidden sx={{ width: 24, height: 24, color: "primary.main" }}>
          <rect x="1" y="1" width="30" height="30" rx="6" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M5 17h5l3-7 5 13 3-6h6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </Box>
        <Typography sx={{ fontFamily: DISPLAY_STACK, fontWeight: 700, letterSpacing: "0.16em", flex: 1 }}>SENTRY</Typography>
        {!booted ? (
          <Button size="small" onClick={() => setSkipped(true)}>
            Skip start-up
          </Button>
        ) : null}
        <Tooltip title={mode === "light" ? "Night ops room" : "Daylight ops room"}>
          <IconButton aria-label={mode === "light" ? "Switch to dark theme" : "Switch to light theme"} onClick={toggleTheme} sx={{ border: 1, borderColor: "divider", borderRadius: "6px", width: 38, height: 38 }}>
            {mode === "light" ? <Moon size={17} /> : <Sun size={17} />}
          </IconButton>
        </Tooltip>
      </Box>

      <Box sx={{ flex: 1, display: "grid", alignItems: "center", py: { xs: 3, md: 4 } }}>
        {profile ? (
          <Box sx={{ width: "100%", maxWidth: 1120, mx: "auto" }}>
            <Launcher profile={profile} next={next} />
          </Box>
        ) : (
          <Box sx={{ width: "100%", maxWidth: 960, mx: "auto", display: "grid", gap: { xs: 3, md: 6 }, gridTemplateColumns: { xs: "1fr", md: "minmax(0, 1fr) minmax(0, 400px)" }, alignItems: "center" }}>
            <Box sx={{ border: 1, borderColor: "divider", borderRadius: "6px", bgcolor: "background.paper", p: { xs: 1.5, sm: 2.5 }, order: { xs: 2, md: 1 } }}>
              <BootPanel lit={booted ? CHANNELS.length : lit} done={booted} />
            </Box>
            <Box sx={{ order: { xs: 1, md: 2 }, opacity: booted ? 1 : 0, transform: booted ? "none" : "translateY(6px)", transition: "opacity 240ms, transform 240ms", visibility: booted ? "visible" : "hidden" }}>
              {booted ? <SignInForm onSignedIn={setProfile} /> : null}
            </Box>
          </Box>
        )}
      </Box>

      <Typography variant="caption" color="text.secondary" sx={{ textAlign: "center" }}>
        Private console. Only for the people who run these systems.
      </Typography>
    </Box>
  );
}
