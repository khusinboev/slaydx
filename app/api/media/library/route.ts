import { ApiError, handler, json, limit } from "@/lib/server/api";
import { clientIp } from "@/lib/server/ratelimit";
import { publicLibrary } from "@/lib/server/media/library";
import { isLibraryMedia } from "@/lib/media/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/media/library?media=&category=` (docs/studio/P2B-SPEC.md, «Namuna promptlar»): the enabled library prompts of a
 * kind (image by default, video, music, sfx) — all, or one category's — and the categories that have any. Public fields
 * only; rows cached ≤ 30 s server-side.
 */
export const GET = handler("media/library", async (req) => {
  await limit(`media:library:${clientIp(req)}`, 120, 60);
  const q = new URL(req.url).searchParams;
  const media = q.get("media") ?? "image";
  if (!isLibraryMedia(media)) throw new ApiError("Noma'lum tur", 400);
  return json(await publicLibrary(q.get("category"), media));
});
