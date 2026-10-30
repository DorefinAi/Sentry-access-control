import type { Metadata } from "next";
import { TelemetryView } from "@/components/monitor/MonitorPages";

export const metadata: Metadata = { title: "Telemetry" };

export default function Page() {
  return <TelemetryView />;
}
