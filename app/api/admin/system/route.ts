import { json } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { getSystemStatus } from "@/lib/server/admin-system";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** S15: DB, migrations, queue, process heartbeats, housekeeping and config messages (never values). */
export const GET = adminHandler("admin/system", { permission: "system.view" }, async () => {
  return json(await getSystemStatus());
});
