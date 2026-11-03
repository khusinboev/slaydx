import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TOOL_BY_SLUG } from "@/lib/tools";
import { ToolWorkspace } from "@/components/forms/ToolWorkspace";
import { voiceFoldTarget, voiceToolMetadata } from "@/lib/server/media/voice-fold";

/**
 * `/uz/podcast` (docs/studio/P8-SPEC.md «P8b»): with `studio.legacy_fold` on it leads to the Studio «Ovoz» tab template;
 * off, the tool page exactly as the `[slug]` route rendered it. Read per request (the switch takes effect at once).
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = voiceToolMetadata("podcast");

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const target = await voiceFoldTarget("podcast", await searchParams);
  if (target) redirect(target);
  return <ToolWorkspace tool={TOOL_BY_SLUG.podcast!} />;
}
