import type { Metadata } from "next";
import { Typography } from "@mui/material";
import { PageHeader, Slug } from "@/components/common/Bits";
import { TraceSearch } from "@/components/trace/TraceSearch";

export const metadata: Metadata = { title: "Trace" };

export default async function TracePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  return (
    <>
      <PageHeader title="Trace a story" subtitle="Follow one story from intake to the feed and X, and see where it stopped." />
      <TraceSearch key={q ?? ""} initial={q ?? ""} autoFocus />
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
        For example <Slug slug="271026_JPR_RAIN_AV_POOJA" />, or a word like “rain”. Press Enter to open the top match.
      </Typography>
    </>
  );
}
