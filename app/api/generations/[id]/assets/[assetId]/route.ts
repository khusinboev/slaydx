import { ApiError, handler, requireUser } from "@/lib/server/api";
import { wantsViewCopy } from "@/lib/asset-view";
import { getAsset, getViewAsset } from "@/lib/server/assets";
import { bytesBody, NO_STORE, noStoreOnError } from "@/lib/server/http-bytes";
import { THUMB_ASSET_ID } from "@/lib/server/thumb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; assetId: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ASSET_ID = /^[0-9a-f]{8,64}$/i;
/** Faqat rasm turlariga ruxsat — `Content-Type` orqali XSS bo'lmasin. */
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/**
 * Slayd/rasm mediasi. Egalik SQL darajasida tekshiriladi.
 *
 * Route `next.config.ts` dagi `/api` → no-store qoidasidan ISTISNO (C08):
 * muvaffaqiyatda o'z keshi, xatoda `private, no-store` (`noStoreOnError`).
 */
export const GET = noStoreOnError(
  handler("generations/asset", async (req, ctx: Ctx) => {
    const { user } = await requireUser(req);
    const { id, assetId } = await ctx.params;
    if (!UUID.test(id) || !ASSET_ID.test(assetId)) throw new ApiError("Noto'g'ri id", 400);

    /*
     * `?view=1` — the viewer's screen copy (ops D5, `lib/asset-view.ts`): the
     * light copy when the worker stored one, else the original. Without the
     * flag: the original, exactly as before (downloads, PPTX, image tools).
     */
    const view = wantsViewCopy(new URL(req.url));
    const asset = view ? await getViewAsset(id, assetId, user.id) : await getAsset(id, assetId, user.id);
    if (!asset) throw new ApiError("Topilmadi", 404);

    const mime = ALLOWED.has(asset.mime) ? asset.mime : "application/octet-stream";
    /*
     * Aktiv id — kontent hashi, shuning uchun uzoq keshlash xavfsiz.
     * ISTISNO: eskiz (`THUMB_ASSET_ID`) — sobit id, bayti tahrirdan keyin
     * o'zgaradi (review W2-B N3); u faqat `/thumb?v=` orqali keshlanadi.
     * `?view=1` while the deck is still building (live view): the copy does
     * not exist yet, so the original must not be pinned under this URL for a
     * day — a short cache lets the next open get the copy.
     */
    const pending = "variant" in asset && asset.variant === "original" && !asset.final;
    const cache =
      assetId.toLowerCase() === THUMB_ASSET_ID
        ? NO_STORE
        : pending
          ? "private, max-age=60"
          : "private, max-age=86400, immutable";
    return new Response(bytesBody(asset.bytes), {
      headers: {
        "Content-Type": mime,
        "Content-Length": String(asset.bytes.byteLength),
        "Cache-Control": cache,
        ...("variant" in asset ? { "X-Asset-Variant": asset.variant } : {}),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  }),
);
