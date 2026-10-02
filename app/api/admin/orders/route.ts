import { json } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { listAdminOrders } from "@/lib/server/admin-payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** S8 orders list (plan §6.6): filters, exact `q`, keyset paging. */
export const GET = adminHandler("admin/orders/list", { permission: "payments.view" }, async (req) => {
  return json(await listAdminOrders(new URL(req.url)));
});
