import { json, readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { requireIdempotencyKey } from "@/lib/server/admin-idempotency";
import { bulkApproveMarketItems } from "@/lib/server/admin-market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Up to 20 candidates with one reason; each item is its own transaction and audit row, works with PII hits are refused (plan §6). */
export const POST = adminHandler("admin/market/bulk-approve", { permission: "market.manage", mutation: true, rate: [10, 60] }, async (req, _ctx, admin) => {
  const key = requireIdempotencyKey(req);
  return json(await bulkApproveMarketItems(admin, await readJson(req, 8 * 1024), key));
});
