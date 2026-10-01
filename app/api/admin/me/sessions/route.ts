import { json } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { listOwnSessions } from "@/lib/server/admin-accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The caller's own live admin sessions (§6.2). */
export const GET = adminHandler("admin/me/sessions", { permission: "self" }, async (_req, _ctx, admin) => {
  return json({ items: await listOwnSessions(admin) });
});
