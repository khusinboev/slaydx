import { readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { idempotentJson, requireIdempotencyKey } from "@/lib/server/admin-idempotency";
import { setMarketItemPrice, parseItemId } from "@/lib/server/admin-market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Per-item price override; `price: null` clears it. Step-up, reason, audited `market.price` (plan §4, §6). */
export const POST = adminHandler(
  "admin/market/price",
  { permission: "pricing.edit", mutation: true },
  async (req, { params }: { params: Promise<{ id: string }> }, admin) => {
    const id = parseItemId((await params).id);
    const key = requireIdempotencyKey(req);
    return idempotentJson(await setMarketItemPrice(admin, id, await readJson(req, 8 * 1024), key), 200);
  },
);
