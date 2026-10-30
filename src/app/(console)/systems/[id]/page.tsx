import type { Metadata } from "next";
import SystemView from "@/components/systems/SystemView";

export const metadata: Metadata = { title: "System" };

export default async function SystemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SystemView id={id} />;
}
