import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TOOL_BY_ID } from "@/lib/tools";
import { ToolWorkspace } from "@/components/forms/ToolWorkspace";
import { getSetting } from "@/lib/server/settings";
import { legacyFoldTarget } from "@/lib/media/legacy-fold";

type SearchParams = Record<string, string | string[] | undefined>;

const tool = TOOL_BY_ID.image;

// Same as the `[slug]` page's metadata (the brand name is added by the `template` in `app/layout.tsx`).
export const metadata: Metadata = { title: tool.title, description: tool.description };

// The switch is read per request (an admin toggle shows at once), so this page is not pre-rendered like `[slug]`.
export const dynamic = "force-dynamic";

/**
 * «Rasm» (`/uz/rasm`). Studio P8a (docs/studio/P8-SPEC.md): while `studio.legacy_fold` is on the page is a server
 * redirect to the Studio's «Rasm» tab (query kept: the bot's `?bt=` link token); off, it is the old form, exactly as
 * the `[slug]` page drew it.
 */
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const target = legacyFoldTarget(tool.id, await getSetting("studio.legacy_fold"), await searchParams);
  if (target) redirect(target);
  return <ToolWorkspace tool={tool} />;
}
