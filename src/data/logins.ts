// App logins only (Assignment desk, Reporter portal, Digital desk). No Windows sign-ins.
import type { AppName, LoginEvent } from "@/types/control";
import { at, TODAY, YESTERDAY } from "./time";

const UA = {
  winChrome: "Chrome 141 on Windows 10",
  winEdge: "Edge 141 on Windows 11",
  android: "Chrome 141 on Android 15",
  iphone: "Safari on iOS 18",
  curl: "python-requests/2.32",
};

const PEOPLE: Record<string, { name: string; role: string }> = {
  vansh: { name: "Vansh", role: "super admin" },
  lead: { name: "Desk lead", role: "admin" },
  desk: { name: "Assignment desk", role: "assignment desk" },
  chief: { name: "Chief editor", role: "chief editor" },
  "pooja.jpr": { name: "Pooja", role: "reporter" },
  "ramesh.ajm": { name: "Ramesh", role: "reporter" },
  "sunita.udr": { name: "Sunita", role: "reporter" },
  "test.reporter": { name: "Test Reporter", role: "reporter" },
  "op.neha": { name: "Neha", role: "Socia operator" },
  "op.arjun": { name: "Arjun", role: "Socia operator" },
};

type Row = [string, AppName, string, string, string, LoginEvent["result"], LoginEvent["flags"]?];

function build(date: string, rows: Row[]): LoginEvent[] {
  const prefix = date.slice(8, 10) + date.slice(5, 7) + date.slice(2, 4);
  return rows.map(([time, app, user, ip, ua, result, flags], i) => ({
    id: `login-${prefix}-${String(i + 1).padStart(2, "0")}`,
    at: at(time, date),
    app,
    user,
    name: PEOPLE[user]?.name ?? null,
    role: PEOPLE[user]?.role ?? null,
    ip,
    userAgent: ua,
    result,
    flags: flags ?? [],
  }));
}

const TODAY_ROWS: Row[] = [
  ["02:47", "assignment-desk", "vansh", "10.0.0.12", UA.winChrome, "success", ["off_hours"]],
  ["06:58", "assignment-desk", "desk", "10.0.0.21", UA.winChrome, "success"],
  ["07:02", "reporter-portal", "sunita.udr", "49.36.112.40", UA.android, "success"],
  ["07:05", "assignment-desk", "lead", "10.0.0.22", UA.winEdge, "success"],
  ["07:10", "digital-desk", "op.neha", "10.0.0.31", UA.winChrome, "success"],
  ["08:00", "reporter-portal", "test.reporter", "10.0.0.12", UA.winChrome, "success"],
  ["08:12", "reporter-portal", "pooja.jpr", "49.36.98.17", UA.iphone, "success"],
  ["09:02", "assignment-desk", "chief", "10.0.0.25", UA.winChrome, "bad_password"],
  ["09:03", "assignment-desk", "chief", "10.0.0.25", UA.winChrome, "success"],
  ["09:50", "digital-desk", "op.arjun", "10.0.0.32", UA.winChrome, "totp_failed"],
  ["09:51", "digital-desk", "op.arjun", "10.0.0.32", UA.winChrome, "success"],
  ["10:15", "assignment-desk", "vansh", "10.0.0.12", UA.winChrome, "success"],
  ["13:28", "reporter-portal", "ramesh.ajm", "117.99.40.6", UA.android, "bad_password"],
  ["13:30", "reporter-portal", "ramesh.ajm", "117.99.40.6", UA.android, "success"],
  ["13:40", "assignment-desk", "chief", "10.0.0.58", UA.winEdge, "success", ["new_ip"]],
  ["14:31", "assignment-desk", "desk", "10.0.0.99", UA.curl, "bad_password", ["new_ip"]],
  ["14:32", "assignment-desk", "desk", "10.0.0.99", UA.curl, "bad_password", ["new_ip", "repeated_failures"]],
  ["14:32:40", "assignment-desk", "desk", "10.0.0.99", UA.curl, "bad_password", ["new_ip", "repeated_failures"]],
  ["14:33", "assignment-desk", "desk", "10.0.0.99", UA.curl, "bad_password", ["new_ip", "repeated_failures"]],
  ["14:34", "assignment-desk", "desk", "10.0.0.99", UA.curl, "locked", ["new_ip", "repeated_failures"]],
  ["15:20", "assignment-desk", "admin", "10.0.0.99", UA.curl, "unknown_user", ["new_ip"]],
  ["15:45", "digital-desk", "vansh", "10.0.0.12", UA.winChrome, "success"],
  ["16:16", "reporter-portal", "sunita.udr", "152.58.71.9", UA.android, "success", ["new_ip"]],
];

const YESTERDAY_ROWS: Row[] = [
  ["06:55", "assignment-desk", "desk", "10.0.0.21", UA.winChrome, "success"],
  ["07:08", "assignment-desk", "lead", "10.0.0.22", UA.winEdge, "success"],
  ["07:15", "digital-desk", "op.neha", "10.0.0.31", UA.winChrome, "success"],
  ["08:40", "reporter-portal", "pooja.jpr", "49.36.98.17", UA.iphone, "success"],
  ["09:30", "assignment-desk", "chief", "10.0.0.25", UA.winChrome, "success"],
  ["11:02", "reporter-portal", "ramesh.ajm", "117.99.40.6", UA.android, "bad_password"],
  ["11:03", "reporter-portal", "ramesh.ajm", "117.99.40.6", UA.android, "success"],
  ["14:20", "digital-desk", "op.arjun", "10.0.0.32", UA.winChrome, "success"],
  ["15:10", "reporter-portal", "sunita.udr", "49.36.112.40", UA.android, "success"],
];

export const LOGINS: Record<string, LoginEvent[]> = {
  [TODAY]: build(TODAY, TODAY_ROWS),
  [YESTERDAY]: build(YESTERDAY, YESTERDAY_ROWS),
};

export const ACTIVE_SESSIONS: Record<string, { app: AppName; user: string; since: string; lastSeen: string; ip: string }[]> = {
  [TODAY]: [
    { app: "assignment-desk", user: "desk", since: at("06:58"), lastSeen: at("16:29"), ip: "10.0.0.21" },
    { app: "assignment-desk", user: "lead", since: at("07:05"), lastSeen: at("16:27"), ip: "10.0.0.22" },
    { app: "assignment-desk", user: "chief", since: at("13:40"), lastSeen: at("16:22"), ip: "10.0.0.58" },
    { app: "reporter-portal", user: "ramesh.ajm", since: at("13:30"), lastSeen: at("16:10"), ip: "117.99.40.6" },
    { app: "reporter-portal", user: "sunita.udr", since: at("16:16"), lastSeen: at("16:19"), ip: "152.58.71.9" },
    { app: "digital-desk", user: "op.neha", since: at("07:10"), lastSeen: at("16:28"), ip: "10.0.0.31" },
    { app: "digital-desk", user: "op.arjun", since: at("09:51"), lastSeen: at("16:25"), ip: "10.0.0.32" },
  ],
  [YESTERDAY]: [],
};
