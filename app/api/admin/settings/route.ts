import { json } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { listAdminSettings } from "@/lib/server/admin-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every catalog setting with its effective value, source, env value and last writer (plan §6.10). */
export const GET = adminHandler("admin/settings/list", { permission: "settings.view" }, async () => {
  return json({ items: await listAdminSettings() });
});
