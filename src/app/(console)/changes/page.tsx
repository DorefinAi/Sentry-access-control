import type { Metadata } from "next";
import ChangesView from "@/components/changes/ChangesView";

export const metadata: Metadata = { title: "Changes" };

export default function ChangesPage() {
  return <ChangesView />;
}
