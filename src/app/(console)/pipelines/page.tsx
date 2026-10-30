import type { Metadata } from "next";
import { PipelinesView } from "@/components/monitor/MonitorPages";

export const metadata: Metadata = { title: "Pipelines" };

export default function Page() {
  return <PipelinesView />;
}
