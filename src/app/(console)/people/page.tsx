import type { Metadata } from "next";
import { Suspense } from "react";
import PeopleView from "@/components/people/PeopleView";
import { LoadingRows } from "@/components/common/AsyncView";

export const metadata: Metadata = { title: "People" };

export default function PeoplePage() {
  // The view reads the open person from the URL
  return (
    <Suspense fallback={<LoadingRows rows={6} />}>
      <PeopleView />
    </Suspense>
  );
}
