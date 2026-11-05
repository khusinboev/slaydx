import { ApiError } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { parseItemId } from "@/lib/server/admin-market";
import { can } from "@/lib/server/admin-rbac";
import { bytesBody } from "@/lib/server/http-bytes";
import { getMarketPreview } from "@/lib/server/market/previews";
import { getItemRow, PUBLIC_STATUSES } from "@/lib/server/market/store";
import { busyResponse, SofficeBusyError } from "@/lib/server/soffice-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A preview raster of any item, a candidate too (`admin: true`); the public route never reaches those (plan §3.2). What
 * is not on sale is unreviewed text: `market.view` sees the shop window, the rest needs `market.manage`.
 */
export const GET = adminHandler(
  "admin/market/preview",
  { permission: "market.view", rate: [300, 60] },
  async (_req, { params }: { params: Promise<{ id: string; page: string }> }, admin) => {
    const p = await params;
    const id = parseItemId(p.id);
    const page = /^\d{1,2}$/.test(p.page) ? Number(p.page) : 0;
    const row = await getItemRow(id);
    if (row && !PUBLIC_STATUSES.includes(row.status) && !can(admin.role, "market.manage")) throw new ApiError("Ruxsat yo'q", 403, { code: "forbidden" });
    try {
      const preview = await getMarketPreview(id, page, { admin: true });
      if (!preview) throw new ApiError("Topilmadi", 404, { code: "not_found" });
      return new Response(bytesBody(preview.bytes), {
        headers: { "Content-Type": preview.mime, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
      });
    } catch (e) {
      if (e instanceof SofficeBusyError) return busyResponse(e);
      throw e;
    }
  },
);
