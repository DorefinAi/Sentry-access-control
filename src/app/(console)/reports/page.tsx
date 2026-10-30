import type { Metadata } from "next";
import { Suspense } from "react";
import ReportsView from "@/components/reports/ReportsView";
import { LoadingRows } from "@/components/common/AsyncView";

export const metadata: Metadata = { title: "Reports" };

export default function ReportsPage() {
  return (
    <Suspense fallback={<LoadingRows rows={4} />}>
      <ReportsView />
    </Suspense>
  );
}
