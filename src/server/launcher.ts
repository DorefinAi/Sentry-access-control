// The app launcher. Each app keeps its own login in this phase; there is no single sign-on yet.
// Health comes from the probes; the detail line from the backends' ops summaries.
import type { LauncherApp } from "@/types/control";
import { headlineFor } from "./ai/summary";
import { FRONTEND_URLS } from "./catalog";
import { liveMoment } from "./moment";
import { systemsFor, worst } from "./systems";

export function listLauncher(): LauncherApp[] {
  const m = liveMoment();
  const systems = systemsFor(m);
  const health = (id: string) => systems.find((s) => s.id === id)?.health ?? "unknown";
  const sam = m.ops.samvadia.summary;
  const soc = m.ops.socia.summary;
  const waiting = (summary: typeof sam, stage: string) => summary?.stages.find((s) => s.id === stage)?.waiting;
  const deskWaiting = waiting(sam, "desk");
  const operatorWaiting = waiting(soc, "operator");
  const url = (raw: string) => raw.replace("127.0.0.1", "localhost");
  return [
    {
      id: "sentry",
      name: "Sentry",
      product: "Sentry",
      description: "This control centre: status, alerts, logs, traces and reports.",
      url: "/",
      health: worst(systems.map((x) => x.health)),
      detail: headlineFor(m.alerts),
      signIn: "Console login (username + password)",
    },
    {
      id: "assignment-desk",
      name: "Assignment Desk",
      product: "Samvadia",
      description: "Review incoming stories, approve them and send them to the feed.",
      url: url(FRONTEND_URLS["assignment-desk"]()),
      health: health("assignment-desk"),
      detail: deskWaiting === undefined ? (m.ops.samvadia.problem ?? "No data") : `${deskWaiting} ${deskWaiting === 1 ? "item waits" : "items wait"} for the desk`,
      signIn: "Own login: desk username + password",
    },
    {
      id: "reporter-portal",
      name: "Reporter Portal",
      product: "Samvadia",
      description: "Reporters submit stories and files.",
      url: url(FRONTEND_URLS["reporter-portal"]()),
      health: health("reporter-portal"),
      detail: sam ? `${sam.flow.bySource.portal} stories submitted today` : (m.ops.samvadia.problem ?? "No data"),
      signIn: "Own login: reporter username + password",
    },
    {
      id: "digital-desk",
      name: "Digital Desk",
      product: "Socia",
      description: "Socia operators check cards and mark posts for X.",
      url: url(FRONTEND_URLS["digital-desk"]()),
      health: health("digital-desk"),
      detail: operatorWaiting === undefined ? (m.ops.socia.problem ?? "No data") : `${operatorWaiting} ${operatorWaiting === 1 ? "draft waits" : "drafts wait"} for an operator`,
      signIn: "Own login: email + password + TOTP",
    },
  ];
}
