import "server-only";
import { ApiError } from "./api";
import { commitDocOps } from "./slide-commit";
import { assetUrl, putAssetBytes } from "./assets";
import { sniffImageType } from "../generation/slide-images";
import { SLIDE_IMAGE_MAX_BYTES } from "../generation/slide-limits";
import type { DocOp } from "../generation/slide-edit";

/**
 * Slayd rasmini yuklash (E5).
 *
 * Route (`.../image/route.ts`) ATAYIN yupqa: autentifikatsiya, chastota
 * chegarasi va so'rov shakli shu yerda emas — hamma haqiqiy mantiq
 * (hajm, sniff, egalik, versiya qulfi) shu modulda, `slide-commit.ts`/
 * `logo.ts` naqshi bilan bir xil.
 *
 * `uploadSlideImage` — foydalanuvchi O'ZINING faylini yuklaydi. Limit
 * YO'Q, shunchaki `commitDocOps`ga bitta `image` operatsiyasi yuboriladi
 * — qolgan hamma tekshiruv (indeks chegarasi, maket rasm joyi)
 * `applyDocOps` ichida (`slide-edit.ts`).
 *
 * AI bilan qayta chizish (`regenerateSlideImage`) olib tashlandi
 * (Muharrir 2 / WP4a-4b) — endi faqat foydalanuvchi o'z faylini yuklaydi.
 */

/** Yuklash uchun indeks shakli tekshiruvi — 400. */
function assertValidIndex(index: number): void {
  if (!Number.isInteger(index) || index < 0) {
    throw new ApiError("Noto'g'ri slayd indeksi", 400);
  }
}

/**
 * Foydalanuvchi o'z PNG/JPEG faylini biriktiradi (AI EMAS).
 *
 * Tartib: hajm (sarlavha, so'ng haqiqiy `file.size`) → sniff (baytlardan,
 * `content-type`dan EMAS — `logo.ts` bilan bir xil naqsh) → aktivga
 * yozish → `commitDocOps` (egalik, versiya qulfi, maket rasm joyi —
 * hammasi shu yerda, ikkinchi marta yozilmaydi).
 */
export async function uploadSlideImage(
  req: Request,
  id: string,
  userId: string,
  index: number,
): ReturnType<typeof commitDocOps> {
  assertValidIndex(index);

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > SLIDE_IMAGE_MAX_BYTES + 64 * 1024) {
    throw new ApiError("Fayl juda katta", 413);
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw new ApiError("Fayl yuborilmadi", 400);
  if (file.size > SLIDE_IMAGE_MAX_BYTES) throw new ApiError("Fayl juda katta", 413);
  if (file.size === 0) throw new ApiError("Fayl bo'sh", 400);

  const baseVersionRaw = form?.get("baseVersion");
  const baseVersion = Number(baseVersionRaw);
  if (typeof baseVersionRaw !== "string" || !Number.isInteger(baseVersion) || baseVersion < 0) {
    throw new ApiError("«baseVersion» yaroqsiz", 400);
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  // `content-type` sarlavhasiga ISHONILMAYDI — faqat magic baytlar.
  const type = sniffImageType(bytes);
  if (!type) throw new ApiError("Faqat PNG yoki JPEG qabul qilinadi", 415);
  const mime = type === "png" ? "image/png" : "image/jpeg";

  const assetId = await putAssetBytes(id, mime, bytes);
  const url = assetUrl(id, assetId);
  const ops: DocOp[] = [{ op: "image", index, url }];
  return commitDocOps(id, userId, baseVersion, ops);
}
