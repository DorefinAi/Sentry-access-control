import type { Metadata } from "next";
import { Suspense } from "react";
import AlertsView from "@/components/alerts/AlertsView";
import { LoadingRows } from "@/components/common/AsyncView";

export const metadata: Metadata = { title: "Alerts" };

export default function AlertsPage() {
  // The view reads its tab and open alert from the URL
  return (
    <Suspense fallback={<LoadingRows rows={4} />}>
      <AlertsView />
    </Suspense>
  );
}
