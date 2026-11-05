import { readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { idempotentJson, requireIdempotencyKey } from "@/lib/server/admin-idempotency";
import { parseItemId, setPurchaseAbuseFlag } from "@/lib/server/admin-market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** «Suiiste'mol» on a purchase: blocks restore and rating; `clear: true` takes it off (plan §3.1). */
export const POST = adminHandler(
  "admin/market/abuse",
  { permission: "market.manage", mutation: true },
  async (req, { params }: { params: Promise<{ id: string }> }, admin) => {
    const id = parseItemId((await params).id);
    const key = requireIdempotencyKey(req);
    return idempotentJson(await setPurchaseAbuseFlag(admin, id, await readJson(req, 8 * 1024), key), 200);
  },
);
