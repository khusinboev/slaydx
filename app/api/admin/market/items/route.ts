import { json } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { listMarketAdminItems, parseMarketItemsQuery } from "@/lib/server/admin-market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Queue and catalog: filters, keyset paging; never the document (plan §6). */
export const GET = adminHandler("admin/market/items", { permission: "market.view" }, async (req) => {
  return json(await listMarketAdminItems(parseMarketItemsQuery(new URL(req.url))));
});
