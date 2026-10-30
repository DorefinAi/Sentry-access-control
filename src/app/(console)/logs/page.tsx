import type { Metadata } from "next";
import { Suspense } from "react";
import LogsView from "@/components/logs/LogsView";
import { LoadingRows } from "@/components/common/AsyncView";

export const metadata: Metadata = { title: "Logs" };

export default function LogsPage() {
  // Filters live in the URL, which needs a Suspense boundary for prerendering
  return (
    <Suspense fallback={<LoadingRows rows={8} height={24} />}>
      <LogsView />
    </Suspense>
  );
}
