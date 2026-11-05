import { ApiError } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { parseItemId } from "@/lib/server/admin-market";
import { bytesBody } from "@/lib/server/http-bytes";
import { getMarketPreview } from "@/lib/server/market/previews";
import { busyResponse, SofficeBusyError } from "@/lib/server/soffice-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A preview raster of any item, a candidate too (`admin: true`); the public route never reaches those (plan §3.2). */
export const GET = adminHandler(
  "admin/market/preview",
  { permission: "market.view", rate: [300, 60] },
  async (_req, { params }: { params: Promise<{ id: string; page: string }> }) => {
    const p = await params;
    const id = parseItemId(p.id);
    const page = /^\d{1,2}$/.test(p.page) ? Number(p.page) : 0;
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
