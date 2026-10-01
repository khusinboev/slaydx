import { ApiError, readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { idempotentJson, requireIdempotencyKey } from "@/lib/server/admin-idempotency";
import { parseExternalRefundBody, recordExternalRefund } from "@/lib/server/admin-order-refund";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Records an external refund / chargeback with an optional wallet clawback; `Idempotency-Key` required (plan §6.6). */
export const POST = adminHandler(
  "admin/orders/external-refund",
  { permission: "payments.refund_record", mutation: true },
  async (req, { params }: { params: Promise<{ id: string }> }, admin) => {
    const id = (await params).id;
    if (!UUID.test(id)) throw new ApiError("Topilmadi", 404, { code: "not_found" });
    const key = requireIdempotencyKey(req);
    const input = parseExternalRefundBody(await readJson(req, 8 * 1024));
    return idempotentJson(await recordExternalRefund(admin, id.toLowerCase(), input, key), 201);
  },
);
