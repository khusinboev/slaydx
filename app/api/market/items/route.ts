import { json, optionalUser } from "@/lib/server/api";
import { assertMarketOpen, limitCatalogRead, marketHandler, withBrowserCookie } from "@/lib/server/market/http";
import { listMarketItems } from "@/lib/server/market/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public catalog: card fields only (`MarketCard`), at most 48 per page. Rate-limited per browser and per IP. */
export const GET = marketHandler("list", async (req) => {
  const { user } = await optionalUser(req);
  await assertMarketOpen(user);
  const browser = await limitCatalogRead(req);
  const p = new URL(req.url).searchParams;
  const list = await listMarketItems({
    tool: p.get("tool"),
    subject: p.get("subject"),
    level: p.get("level"),
    sort: p.get("sort"),
    q: p.get("q"),
    cursor: p.get("cursor"),
    limit: p.get("limit") === null ? null : Number(p.get("limit")),
  });
  return withBrowserCookie(json(list), browser);
});
