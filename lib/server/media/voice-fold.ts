import "server-only";
import type { Metadata } from "next";
import { TOOL_BY_SLUG } from "../../tools";
import { getSetting } from "../settings";
import { voiceFoldPath, type VoiceTemplateId } from "../../media/voice-templates";

/**
 * Studio P8b (docs/studio/P8-SPEC.md): `/uz/podcast` and `/uz/greeting` read the dark switch `studio.legacy_fold` on
 * every request. On: where the page redirects (`/uz/studio?tab=ovoz&template=<id>`, the old link's other query kept).
 * Off: `null` — the page renders the tool exactly as before (`ToolWorkspace`).
 */
export async function voiceFoldTarget(id: VoiceTemplateId, query: Readonly<Record<string, string | string[] | undefined>>): Promise<string | null> {
  return (await getSetting("studio.legacy_fold")) === true ? voiceFoldPath(id, query) : null;
}

/** The same title / description the `[slug]` page gave these tools. */
export function voiceToolMetadata(id: VoiceTemplateId): Metadata {
  const tool = TOOL_BY_SLUG[id]!;
  return { title: tool.title, description: tool.description };
}
