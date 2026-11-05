import { readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { idempotentJson, requireIdempotencyKey } from "@/lib/server/admin-idempotency";
import { retireMarketItem, parseItemId } from "@/lib/server/admin-market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** «Olib tashlash»: off the shelf; buyers keep their copies (plan §9). */
export const POST = adminHandler(
  "admin/market/retire",
  { permission: "market.manage", mutation: true },
  async (req, { params }: { params: Promise<{ id: string }> }, admin) => {
    const id = parseItemId((await params).id);
    const key = requireIdempotencyKey(req);
    return idempotentJson(await retireMarketItem(admin, id, await readJson(req, 8 * 1024), key), 200);
  },
);
