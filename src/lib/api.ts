// One typed function per API route. Every screen goes through here, so the
// routes and their shapes live in one place (see src/types/control.ts).
import type {
  Alert,
  AlertPatch,
  AlertState,
  AiSummary,
  AppName,
  ApiError,
  BuildLogEntry,
  LogEntry,
  ChatRequest,
  ChatResponse,
  DailyReport,
  Fix,
  Incident,
  IncidentCreate,
  IncidentPatch,
  IncidentSummary,
  LogPage,
  LogQuery,
  LauncherApp,
  LoginReport,
  LoginRequest,
  LoginResponse,
  NotificationList,
  NotificationPatch,
  Overview,
  Profile,
  CodeChange,
  Gauge,
  PasswordChange,
  Preferences,
  PreferencesPatch,
  SessionInfo,
  TeamUser,
  TeamUserCreate,
  TeamUserPatch,
  SummaryScope,
  System,
  SystemDetail,
  Trace,
  TraceSearchHit,
} from "@/types/control";
import type { OwnerOverride, OwnerUser, PeopleHistory, PeopleOverview, PeoplePatch, PeopleSystem, UserPermissions } from "@/types/people";

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

type Params = Record<string, string | number | undefined | null>;

function withQuery(path: string, params?: Params): string {
  if (!params) return path;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiRequestError("Could not reach the control centre API. Is the dev server running?", "network", 0);
  }
  // A lapsed session sends the browser to sign in, then back here.
  // The login call itself reports a bad password as a normal error instead.
  if (res.status === 401 && !path.startsWith("/api/auth/") && typeof window !== "undefined") {
    const here = window.location.pathname + window.location.search;
    window.location.assign(`/login?next=${encodeURIComponent(here)}`);
    throw new ApiRequestError("Your session ended. Sign in again.", "unauthorized", 401);
  }
  if (!res.ok) {
    let body: Partial<ApiError> = {};
    try {
      body = (await res.json()) as ApiError;
    } catch {
      // Not JSON; fall back to the status line
    }
    // A 403 is the role check on the server: say so in plain words
    const fallback = res.status === 403 ? "Your role cannot do this. Ask an admin." : `${res.status} ${res.statusText}`;
    throw new ApiRequestError(body.message || fallback, body.error || (res.status === 403 ? "forbidden" : "http_error"), res.status);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

const json = (method: string, body: unknown, signal?: AbortSignal): RequestInit => ({ method, body: JSON.stringify(body), signal });

/** The board now, or as it stood at `at` (replay). */
export const getOverview = (signal?: AbortSignal, at?: string) => request<Overview>(withQuery("/api/overview", { at }), { signal });

export const getChanges = (signal?: AbortSignal) => request<CodeChange[]>("/api/changes", { signal });

export const getNotifications = (signal?: AbortSignal) => request<NotificationList>("/api/notifications", { signal });
export const patchNotifications = (patch: NotificationPatch) => request<NotificationList>("/api/notifications", json("PATCH", patch));

export const login = (body: LoginRequest) => request<LoginResponse>("/api/auth/login", json("POST", body));
export const logout = () => request<unknown>("/api/auth/logout", { method: "POST" });
export const getMe = (signal?: AbortSignal) => request<Profile>("/api/me", { signal });
export const getLauncher = (signal?: AbortSignal) => request<LauncherApp[]>("/api/launcher", { signal });

export const patchMe = (body: { name: string }) => request<Profile>("/api/me", json("PATCH", body));
export const changePassword = (body: PasswordChange) => request<unknown>("/api/me/password", json("POST", body));
export const getPreferences = (signal?: AbortSignal) => request<Preferences>("/api/me/preferences", { signal });
export const patchPreferences = (body: PreferencesPatch) => request<Preferences>("/api/me/preferences", json("PATCH", body));
export const getSessions = (signal?: AbortSignal) => request<SessionInfo[]>("/api/me/sessions", { signal });
export const revokeOtherSessions = () => request<unknown>("/api/me/sessions/revoke-others", { method: "POST" });

export const getTeam = (signal?: AbortSignal) => request<TeamUser[]>("/api/admin/users", { signal });
export const createTeamUser = (body: TeamUserCreate) => request<TeamUser>("/api/admin/users", json("POST", body));
export const patchTeamUser = (username: string, body: TeamUserPatch) => request<TeamUser>(`/api/admin/users/${encodeURIComponent(username)}`, json("PATCH", body));

export type GaugeThresholds = { warnAt?: number; dangerAt?: number };
export const getGauges = (signal?: AbortSignal) => request<Gauge[]>("/api/gauges", { signal });
export const patchGauge = (id: string, body: GaugeThresholds) => request<Gauge>(`/api/gauges/${encodeURIComponent(id)}`, json("PATCH", body));

export const getSystems = (signal?: AbortSignal) => request<System[]>("/api/systems", { signal });
export const getSystem = (id: string, signal?: AbortSignal) => request<SystemDetail>(`/api/systems/${encodeURIComponent(id)}`, { signal });

export const getAlerts = (state?: AlertState, signal?: AbortSignal) => request<Alert[]>(withQuery("/api/alerts", { state }), { signal });
export const patchAlert = (id: string, patch: AlertPatch) => request<Alert>(`/api/alerts/${encodeURIComponent(id)}`, json("PATCH", patch));

export function logQueryParams(q: LogQuery): Params {
  return {
    system: q.system?.length ? q.system.join(",") : undefined,
    // The route takes one minimum level
    level: q.level?.length ? q.level[0] : undefined,
    q: q.q,
    from: q.from,
    to: q.to,
    range: q.range,
    slug: q.slug,
    cursor: q.cursor,
    limit: q.limit,
  };
}
export const getLogs = (q: LogQuery, signal?: AbortSignal) => request<LogPage>(withQuery("/api/logs", logQueryParams(q)), { signal });
export const getLog = (id: string, signal?: AbortSignal) => request<LogEntry>(`/api/logs/${encodeURIComponent(id)}`, { signal });

export const searchTrace = (q: string, signal?: AbortSignal) => request<TraceSearchHit[]>(withQuery("/api/trace", { q }), { signal });
export const getTrace = (slug: string, signal?: AbortSignal) => request<Trace>(`/api/trace/${encodeURIComponent(slug)}`, { signal });

export const getFixes = (signal?: AbortSignal) => request<Fix[]>("/api/fixes", { signal });

export const getIncidents = (signal?: AbortSignal) => request<IncidentSummary[]>("/api/incidents", { signal });
export const createIncident = (body: IncidentCreate) => request<Incident>("/api/incidents", json("POST", body));
export const getIncident = (id: string, signal?: AbortSignal) => request<Incident>(`/api/incidents/${encodeURIComponent(id)}`, { signal });
export const patchIncident = (id: string, patch: IncidentPatch) => request<Incident>(`/api/incidents/${encodeURIComponent(id)}`, json("PATCH", patch));
export const incidentExportUrl = (id: string) => `/api/incidents/${encodeURIComponent(id)}/export?format=md`;

export const getDailyReport = (date: string, signal?: AbortSignal) => request<DailyReport>(withQuery("/api/reports/daily", { date }), { signal });
export const getLogins = (date: string, app?: AppName, signal?: AbortSignal) => request<LoginReport>(withQuery("/api/logins", { date, app }), { signal });
export const getBuildLog = (signal?: AbortSignal) => request<BuildLogEntry[]>("/api/build-log", { signal });

export type SummaryParams =
  | { scope: "day"; date?: string }
  | { scope: "logs"; query: LogQuery }
  | { scope: "incident"; id: string };

export function getSummary(p: SummaryParams, signal?: AbortSignal) {
  const scope: SummaryScope = p.scope;
  const params: Params =
    p.scope === "logs" ? { scope, ...logQueryParams({ ...p.query, cursor: undefined, limit: undefined }) } : p.scope === "day" ? { scope, date: p.date } : { scope, id: p.id };
  return request<AiSummary>(withQuery("/api/summaries", params), { signal });
}

export const chat = (body: ChatRequest, signal?: AbortSignal) => request<ChatResponse>("/api/assistant/chat", json("POST", body, signal));


// Owners only: people in the Assignment desk and Socia (see src/types/people.ts)
const personPath = (system: PeopleSystem, id: string) => `/api/people/${system}/${encodeURIComponent(id)}`;
export const getPeople = (signal?: AbortSignal) => request<PeopleOverview>("/api/people", { signal });
export const getPeopleHistory = (cursor?: string, signal?: AbortSignal) => request<PeopleHistory>(withQuery("/api/people/history", { limit: 50, cursor }), { signal });
export const getPersonPermissions = (system: PeopleSystem, id: string, signal?: AbortSignal) => request<UserPermissions>(`${personPath(system, id)}/permissions`, { signal });
export const patchPerson = (system: PeopleSystem, id: string, body: PeoplePatch) => request<{ user: OwnerUser }>(personPath(system, id), json("PATCH", body));
export const putPersonOverrides = (system: PeopleSystem, id: string, overrides: OwnerOverride[]) => request<UserPermissions>(`${personPath(system, id)}/overrides`, json("PUT", { overrides }));
