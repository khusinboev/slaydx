import { readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { idempotentJson, requireIdempotencyKey } from "@/lib/server/admin-idempotency";
import { rejectMarketItem, parseItemId } from "@/lib/server/admin-market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Rejects a candidate with a reason code and a free-text reason (plan §6, §9). */
export const POST = adminHandler(
  "admin/market/reject",
  { permission: "market.manage", mutation: true },
  async (req, { params }: { params: Promise<{ id: string }> }, admin) => {
    const id = parseItemId((await params).id);
    const key = requireIdempotencyKey(req);
    return idempotentJson(await rejectMarketItem(admin, id, await readJson(req, 8 * 1024), key), 200);
  },
);
