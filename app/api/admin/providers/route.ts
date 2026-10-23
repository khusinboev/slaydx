import { json } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { listAdminProviders } from "@/lib/server/admin-providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every AI provider with its switch and key state (program-17 D7). Never a key: `hasDbKey`, the masked
 * `keyHint` (only for roles that may edit) and whether an env fallback exists.
 */
export const GET = adminHandler("admin/providers/list", { permission: "settings.view" }, async (_req, _ctx, admin) => {
  return json(await listAdminProviders(admin.role));
});
