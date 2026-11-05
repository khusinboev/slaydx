import { json, requireUser } from "@/lib/server/api";
import { assertMarketOpen, marketHandler } from "@/lib/server/market/http";
import { listMyPurchases } from "@/lib/server/market/restore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** «Xaridlarim»: the signed-in buyer's own purchases only. */
export const GET = marketHandler("purchases", async (req) => {
  const { user } = await requireUser(req);
  await assertMarketOpen(user);
  return json({ purchases: await listMyPurchases(user.id) });
});
