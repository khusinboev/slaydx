import { ApiError } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { marketItemAsset, parseItemId } from "@/lib/server/admin-market";
import { bytesBody } from "@/lib/server/http-bytes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** An image of the sanitised document, for the drawer's viewer. */
export const GET = adminHandler(
  "admin/market/asset",
  { permission: "market.manage", rate: [600, 60] },
  async (_req, { params }: { params: Promise<{ id: string; assetId: string }> }) => {
    const p = await params;
    if (!/^[\w-]{1,100}$/.test(p.assetId)) throw new ApiError("Topilmadi", 404, { code: "not_found" });
    const asset = await marketItemAsset(parseItemId(p.id), p.assetId);
    return new Response(bytesBody(asset.bytes), {
      headers: { "Content-Type": asset.mime, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
    });
  },
);
