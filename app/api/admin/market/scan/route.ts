import { readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { idempotentJson, requireIdempotencyKey } from "@/lib/server/admin-idempotency";
import { runMarketScan } from "@/lib/server/admin-market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Manual candidate scan; works while the market is dark (plan §1.2, §10.5). */
export const POST = adminHandler("admin/market/scan", { permission: "market.manage", mutation: true, rate: [5, 60] }, async (req, _ctx, admin) => {
  const key = requireIdempotencyKey(req);
  return idempotentJson(await runMarketScan(admin, await readJson(req, 8 * 1024), key), 200);
});
