import type { Metadata } from "next";
import TraceView from "@/components/trace/TraceView";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Trace ${slug}` };
}

export default async function TraceSlugPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <TraceView slug={slug} />;
}
