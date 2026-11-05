import { readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { idempotentJson, requireIdempotencyKey } from "@/lib/server/admin-idempotency";
import { approveMarketItem, parseItemId } from "@/lib/server/admin-market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** candidate → active: neutral file, snapshot price, default cap, audit row, all in one transaction (plan §1.2, §6). */
export const POST = adminHandler(
  "admin/market/approve",
  { permission: "market.manage", mutation: true, rate: [60, 60] },
  async (req, { params }: { params: Promise<{ id: string }> }, admin) => {
    const id = parseItemId((await params).id);
    const key = requireIdempotencyKey(req);
    return idempotentJson(await approveMarketItem(admin, id, await readJson(req, 16 * 1024), key), 200);
  },
);
