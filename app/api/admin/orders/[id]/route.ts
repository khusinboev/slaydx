import { ApiError, json } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { getAdminOrder } from "@/lib/server/admin-payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** S9 order detail: order, redacted webhook events, ledger rows, recorded external refunds (plan §6.6). */
export const GET = adminHandler(
  "admin/orders/detail",
  { permission: "payments.view" },
  async (_req, { params }: { params: Promise<{ id: string }> }) => {
    const id = (await params).id;
    if (!UUID.test(id)) throw new ApiError("Topilmadi", 404, { code: "not_found" });
    const out = await getAdminOrder(id);
    if (!out) throw new ApiError("Topilmadi", 404, { code: "not_found" });
    return json(out);
  },
);
