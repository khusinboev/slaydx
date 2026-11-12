import { ApiError, handler, json, readJson, requireUser } from "@/lib/server/api";
import { GenerationRatingError, rateGeneration, ratingTarget } from "@/lib/server/generation-ratings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Someone else's generation answers exactly like a missing one: the web never learns whether an id
 * exists (the bot, talking to the button's own presser, may say «Bu ish sizniki emas»).
 */
function hideForeign(e: unknown): never {
  if (e instanceof GenerationRatingError && e.code === "not_owner") throw new ApiError("Topilmadi", 404, { code: "not_found" });
  throw e;
}

/**
 * The signed-in user's rating of THIS work (docs/ratings/GENERATION-RATING.md): `rating` is `null`
 * until rated; `rateable` is false while the generation is not COMPLETED.
 */
export const GET = handler("generations/rating-get", async (req, ctx: Ctx) => {
  const { user } = await requireUser(req);
  const { id } = await ctx.params;
  if (!UUID.test(id)) throw new ApiError("Noto'g'ri id", 400);
  const t = await ratingTarget(user.id, id).catch(hideForeign);
  return json({ rating: t.rating, rateable: t.status === "COMPLETED" });
});

/**
 * Rates or re-rates the work: `{ stars: 1-5, reason?: design|images|text|errors|other (1-3 stars
 * only), comment?: ≤ 500 chars }`. The whole value is replaced (the last rating wins). Same
 * service as the bot; errors carry a `code` (`lib/server/generation-ratings.ts`).
 */
export const PUT = handler("generations/rating-put", async (req, ctx: Ctx) => {
  const { user } = await requireUser(req);
  const { id } = await ctx.params;
  if (!UUID.test(id)) throw new ApiError("Noto'g'ri id", 400);
  const body = await readJson<{ stars?: unknown; reason?: unknown; comment?: unknown }>(req, 8_000);
  const rating = await rateGeneration({
    userId: user.id,
    generationId: id,
    stars: body.stars,
    reason: body.reason,
    comment: body.comment,
    source: "web",
  }).catch(hideForeign);
  return json({ rating });
});
