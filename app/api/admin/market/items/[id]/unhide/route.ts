import { readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { idempotentJson, requireIdempotencyKey } from "@/lib/server/admin-idempotency";
import { unhideMarketItem, parseItemId } from "@/lib/server/admin-market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reports reviewed: the item returns to the shelf (plan §9, `hidden_until_review`). */
export const POST = adminHandler(
  "admin/market/unhide",
  { permission: "market.manage", mutation: true },
  async (req, { params }: { params: Promise<{ id: string }> }, admin) => {
    const id = parseItemId((await params).id);
    const key = requireIdempotencyKey(req);
    return idempotentJson(await unhideMarketItem(admin, id, await readJson(req, 8 * 1024), key), 200);
  },
);
