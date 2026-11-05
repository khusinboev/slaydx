import { ApiError, json, optionalUser } from "@/lib/server/api";
import { assertMarketOpen, limitCatalogRead, marketHandler, withBrowserCookie } from "@/lib/server/market/http";
import { getMarketItem, recordMarketView } from "@/lib/server/market/items";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** The item page: `MarketItemView`, built from a row without `doc_json`. Unknown and not-public ids are the same 404. */
export const GET = marketHandler("item", async (req: Request, ctx: Ctx) => {
  const { user } = await optionalUser(req);
  await assertMarketOpen(user);
  const browser = await limitCatalogRead(req);
  const { id } = await ctx.params;
  const item = await getMarketItem(id, user?.id ?? null);
  if (!item) throw new ApiError("Topilmadi", 404);
  await recordMarketView(id, user ? `u:${user.id}` : `b:${browser.id}`);
  return withBrowserCookie(json(item), browser);
});
