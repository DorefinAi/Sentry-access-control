import type { BuildLogEntry } from "@/types/control";
import { at } from "./time";

export const BUILD_LOG: BuildLogEntry[] = [
  {
    at: at("16:30"),
    phase: 1,
    title: "Phase 1: static UI and API",
    connected: [],
    missing: [
      "Reads from Postgres (samvadia and socia) for stories, items, jobs and feed_log",
      "A log sink: Samvadia, Socia, FTP and backup logs are not shipped here yet",
      "Heartbeats from each service, so health is measured instead of written down",
      "Qwen3 on Ollama for summaries, fixes and chat (now static text from templates)",
      "Alert delivery to WhatsApp or email; alerts only show on this screen",
      "Real app login events from the Assignment desk, Reporter portal and Digital desk",
    ],
  },
];
