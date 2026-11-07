import { ApiError, handler, json, limit, optionalUser } from "@/lib/server/api";
import { clientIp } from "@/lib/server/ratelimit";
import { publicTemplates } from "@/lib/server/media/library";
import { isTemplateMedia } from "@/lib/media/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/media/templates?media=` (docs/studio/P2B-SPEC.md, «Shablonlar»): the enabled templates of a kind (image by
 * default, or video) that still validate against the model's ParamSchema: a picture template while its model is available
 * RIGHT NOW, a clip template while any clip can be sold (its model is only a suggestion). Public fields only; rows cached ≤ 30 s.
 */
export const GET = handler("media/templates", async (req) => {
  await limit(`media:templates:${clientIp(req)}`, 120, 60);
  // The session opens an admin's preview of hidden models, as in `GET /api/media/catalog`.
  await optionalUser(req);
  const media = new URL(req.url).searchParams.get("media") ?? "image";
  if (!isTemplateMedia(media)) throw new ApiError("Noma'lum tur", 400);
  return json(await publicTemplates(media));
});
