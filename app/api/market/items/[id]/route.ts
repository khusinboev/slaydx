import { ApiError, json, optionalUser } from "@/lib/server/api";
import { assertMarketOpen, limitCatalogRead, marketHandler, withBrowserCookie } from "@/lib/server/market/http";
import { getMarketItem, recordMarketView } from "@/lib/server/market/items";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A request without the browser cookie (a script, or a first visit): one view per IP per day. */
const VIEW_IP_WINDOW_SEC = 86_400;

type Ctx = { params: Promise<{ id: string }> };

/** The item page: `MarketItemView`, built from a row without `doc_json`. Unknown and not-public ids are the same 404. */
export const GET = marketHandler("item", async (req: Request, ctx: Ctx) => {
  const { user, ip } = await optionalUser(req);
  await assertMarketOpen(user);
  const browser = await limitCatalogRead(req);
  const { id } = await ctx.params;
  const item = await getMarketItem(id, user?.id ?? null);
  if (!item) throw new ApiError("Topilmadi", 404);
  if (user) await recordMarketView(id, `u:${user.id}`);
  else if (!browser.fresh) await recordMarketView(id, `b:${browser.id}`);
  else await recordMarketView(id, `ip:${ip}`, VIEW_IP_WINDOW_SEC);
  return withBrowserCookie(json(item), browser);
});
