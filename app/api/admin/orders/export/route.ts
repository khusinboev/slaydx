import { adminHandler } from "@/lib/server/admin-handler";
import { exportAdminOrders } from "@/lib/server/admin-payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** CSV of orders with the list's filters; step-up, audited with `meta.filters` (plan §6.0 Exports). */
export const GET = adminHandler("admin/orders/export", { permission: "payments.export", rate: [10, 60] }, async (req, _ctx, admin) => {
  return exportAdminOrders(new URL(req.url), admin);
});
