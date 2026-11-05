import { json, limit, readJson, requireUser } from "@/lib/server/api";
import { assertMarketOpen, marketHandler } from "@/lib/server/market/http";
import { parseRating, ratePurchase } from "@/lib/server/market/ratings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Rate or re-rate a bought copy: `{ stars: 1..5, text?: ≤ 300 }`. */
export const POST = marketHandler("rating", async (req: Request, ctx: Ctx) => {
  const { user } = await requireUser(req);
  await assertMarketOpen(user);
  await limit(`market:rating:${user.id}`, 30, 3600);
  const { id } = await ctx.params;
  const { stars, text } = parseRating(await readJson<{ stars?: unknown; text?: unknown }>(req, 5_000));
  return json(await ratePurchase({ userId: user.id, purchaseId: id, stars, text }));
});
