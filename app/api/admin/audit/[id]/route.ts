import { json } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { getAudit } from "@/lib/server/admin-audit-query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One audit row in full (before / after / meta). A bad id is a 404, never a 500. */
export const GET = adminHandler(
  "admin/audit/detail",
  { permission: "audit.view" },
  async (_req, { params }: { params: Promise<{ id: string }> }) => {
    return json({ entry: await getAudit((await params).id) });
  },
);
