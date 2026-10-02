import { adminHandler } from "@/lib/server/admin-handler";
import { exportAdminUsers } from "@/lib/server/admin-users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** CSV of users with the list's filters; step-up, audited with `meta.filters` (plan §6.0 Exports). */
export const GET = adminHandler("admin/users/export", { permission: "users.export", rate: [10, 60] }, async (req, _ctx, admin) => {
  return exportAdminUsers(new URL(req.url), admin);
});
