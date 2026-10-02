import { json } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { listAudit } from "@/lib/server/admin-audit-query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** S17: audit trail, newest first (keyset on `(at, id)`); `before` / `after` / `meta` are not part of the list. */
export const GET = adminHandler("admin/audit/list", { permission: "audit.view" }, async (req) => {
  return json(await listAudit(new URL(req.url)));
});
