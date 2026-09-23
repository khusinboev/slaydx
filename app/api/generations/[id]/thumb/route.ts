import { ApiError, handler, requireUser } from "@/lib/server/api";
import { bytesBody, NO_STORE, noStoreOnError } from "@/lib/server/http-bytes";
import { getVersions } from "@/lib/server/jobs";
import { busyResponse, SofficeBusyError } from "@/lib/server/soffice-gate";
import { getOrBuildThumb } from "@/lib/server/thumb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Birinchi so'rovda LibreOffice o'giradi (2–8 s); keyingilari aktivdan. */
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Fayl kartasi eskizi (AUDIT-14): DOCX/PPTX natijaning 1-sahifasi, kichik JPEG.
 * Egalik SQL da (`getOrBuildThumb`). O'girib bo'lmasa 404 — karta matn
 * ko'rinishiga qaytadi. LibreOffice slotlari band bo'lsa 503 + `Retry-After`
 * (C07) — karta ham matn ko'rinishida qoladi.
 *
 * Kesh (C08, review W2-B R2): eskiz aktiv id si doimiy (`THUMB_ASSET_ID`),
 * URL o'zi o'zgarmaydi. Shuning uchun brauzer keshi faqat `?v=` JORIY
 * `file_version` ga teng bo'lganda — kesh kaliti amalda fayl versiyasi,
 * tahrir/qayta yasashdan keyin klient yangi `v` bilan so'raydi. Versiyasiz
 * yoki eski `v` — `private, no-store`. Route `next.config.ts` dagi `/api`
 * no-store qoidasidan istisno, shuning uchun har xato javobi (400/401/404/
 * 500) ham `noStoreOnError` orqali `private, no-store` oladi.
 */
export const GET = noStoreOnError(
  handler("generations/thumb", async (req, ctx: Ctx) => {
    const { user } = await requireUser(req);
    const { id } = await ctx.params;
    if (!UUID.test(id)) throw new ApiError("Noto'g'ri id", 400);
    let jpeg: Buffer | null;
    try {
      jpeg = await getOrBuildThumb(id, user.id);
    } catch (e) {
      if (e instanceof SofficeBusyError) return busyResponse(e);
      throw e;
    }
    if (!jpeg) throw new ApiError("Eskiz yo'q", 404);

    const v = new URL(req.url).searchParams.get("v");
    const current = v !== null ? await getVersions(id, user.id) : null;
    const cacheable = current !== null && v === String(current.fileVersion);
    return new Response(bytesBody(jpeg), {
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(jpeg.byteLength),
        "Cache-Control": cacheable ? "private, max-age=86400, immutable" : NO_STORE,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  }),
);
