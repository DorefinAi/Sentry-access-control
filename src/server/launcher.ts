// The app launcher. Each app keeps its own login in this phase; there is no single sign-on yet.
import type { LauncherApp } from "@/types/control";
import { dayStats } from "@/data/stats";
import { headlineFor } from "./ai/summary";
import { store } from "./store";
import { listSystems, worst } from "./systems";

export function listLauncher(): LauncherApp[] {
  const systems = listSystems();
  const health = (id: string) => systems.find((s) => s.id === id)?.health ?? "unknown";
  const s = dayStats();
  return [
    {
      id: "sentry",
      name: "Sentry",
      product: "Sentry",
      description: "This control centre: status, alerts, logs, traces and reports.",
      url: "/",
      health: worst(systems.map((x) => x.health)),
      detail: headlineFor(store().alerts),
      signIn: "Console login (username + password from .env.local)",
    },
    {
      id: "assignment-desk",
      name: "Assignment Desk",
      product: "Samvadia",
      description: "Review incoming stories, approve them and send them to the feed.",
      url: "http://localhost:3000",
      health: health("assignment-desk"),
      detail: `${s.waitingDesk} items waiting for the desk`,
      signIn: "Own login: desk username + password",
    },
    {
      id: "reporter-portal",
      name: "Reporter Portal",
      product: "Samvadia",
      description: "Reporters submit stories and files.",
      url: "http://localhost:3002",
      health: health("reporter-portal"),
      detail: `${s.bySource.portal} stories submitted today`,
      signIn: "Own login: reporter username + password",
    },
    {
      // The Socia frontend has no fixed port yet; 3001 is where it usually runs locally.
      id: "digital-desk",
      name: "Digital Desk",
      product: "Socia",
      description: "Socia operators check cards and approve posts for X.",
      url: "http://localhost:3001",
      health: health("digital-desk"),
      detail: `${s.waitingOperator} drafts waiting for an operator`,
      signIn: "Own login: email + password + TOTP",
    },
  ];
}
