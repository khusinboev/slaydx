import { handler, json, requireUser } from "@/lib/server/api";
import { listMixSources } from "@/lib/server/media/mix-sources";
import { MIX_AUDIO_MAX_SECONDS, MIX_VIDEO_MAX_SECONDS } from "@/lib/media/catalog-mix";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/media/mix-sources` (docs/studio/P8-SPEC.md «P8c»): the «Montaj» pickers — the signed-in user's OWN finished
 * results per role (video / audio / speech / music, newest first; ids, titles and lengths only, never a file URL), the
 * base price (`studio.mix_price`, before the tool's `tool_pricing` % that the session's price adjustments add exactly as
 * the server does) and the length limits.
 */
export const GET = handler("media/mix-sources", async (req) => {
  const { user } = await requireUser(req);
  const sources = await listMixSources(String(user.id));
  return json({ ...sources, limits: { videoSeconds: MIX_VIDEO_MAX_SECONDS, audioSeconds: MIX_AUDIO_MAX_SECONDS } });
});
