import { ApiError, handler, requireUser } from "@/lib/server/api";
import { getAsset } from "@/lib/server/assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; assetId: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ASSET_ID = /^[0-9a-f]{8,64}$/i;
/** Faqat rasm turlariga ruxsat — `Content-Type` orqali XSS bo'lmasin. */
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/** Slayd/rasm mediasi. Egalik SQL darajasida tekshiriladi. */
export const GET = handler("generations/asset", async (req, ctx: Ctx) => {
  const { user } = await requireUser(req);
  const { id, assetId } = await ctx.params;
  if (!UUID.test(id) || !ASSET_ID.test(assetId)) throw new ApiError("Noto'g'ri id", 400);

  const asset = await getAsset(id, assetId, user.id);
  if (!asset) throw new ApiError("Topilmadi", 404);

  const mime = ALLOWED.has(asset.mime) ? asset.mime : "application/octet-stream";
  return new Response(new Uint8Array(asset.bytes), {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(asset.bytes.byteLength),
      // Aktiv id — kontent hashi, shuning uchun uzoq keshlash xavfsiz.
      "Cache-Control": "private, max-age=86400, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
});
