import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isToolSlug, TOOL_BY_SLUG } from "@/lib/tools";
import { ToolWorkspace } from "@/components/forms/ToolWorkspace";

export function generateStaticParams() {
  return Object.keys(TOOL_BY_SLUG).map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const tool = TOOL_BY_SLUG[slug];
  if (!tool) return { title: "Topilmadi" };
  return {
    title: `${tool.title} — Sodda.ai`,
    description: tool.description,
  };
}

export default async function ToolPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isToolSlug(slug)) notFound();
  return <ToolWorkspace tool={TOOL_BY_SLUG[slug]} />;
}
