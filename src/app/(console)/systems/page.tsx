import type { Metadata } from "next";
import { SystemsIndexView } from "@/components/monitor/MonitorPages";

export const metadata: Metadata = { title: "Systems" };

export default function Page() {
  return <SystemsIndexView />;
}
