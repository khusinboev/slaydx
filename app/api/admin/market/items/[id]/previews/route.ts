import { readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { idempotentJson, requireIdempotencyKey } from "@/lib/server/admin-idempotency";
import { redrawMarketPreviews, parseItemId } from "@/lib/server/admin-market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** «Qayta chizish»: a new preview version; rasters rebuild on the next view (plan §3.2, §6). */
export const POST = adminHandler(
  "admin/market/previews",
  { permission: "market.manage", mutation: true },
  async (req, { params }: { params: Promise<{ id: string }> }, admin) => {
    const id = parseItemId((await params).id);
    const key = requireIdempotencyKey(req);
    return idempotentJson(await redrawMarketPreviews(admin, id, await readJson(req, 8 * 1024), key), 200);
  },
);
