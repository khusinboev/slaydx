import "server-only";
import { ApiError } from "./api";
import { commitDocOps, loadDocForEdit } from "./slide-commit";
import { imageYieldField } from "../generation/slide-quality";
import { buildSlideDeck } from "../generation/slides";
import { assetUrl } from "./assets";
import { readUploadForm } from "./upload-body";
import { pendingUpload } from "./upload-quota";
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

/** Rasm tasmasi bilan matn qutidan chiqadigan slayd — foydalanuvchiga ko'rinadigan xabar. */
export const TEXT_TOO_LONG_FOR_IMAGE = "Matn rasm bilan sig‘maydi — avval matnni qisqartiring";

/**
 * «Matn rasmdan ustun» (AUDIT-25 P8, sharh 5-band): generatsiya matnni
 * RASMSIZ qutigacha yozadi (`normalizeSlide`, `NO_IMAGE`) va matni
 * rasmli qutiga sig'maydigan slaydga rasm qo'ymaydi (`imageYieldField`).
 * Ko'ruvchida shunday slaydga rasm yuklansa, kontent zonasi torayadi:
 * twoCol matni qutidan chiqadi, process/stats/table auditoriya polidan
 * pastga tushadi. Shuning uchun yuklash O'SHA predikat bilan rad etiladi
 * (400) — deka qoidasi va vizuali `buildSlideDeck` dan (`bodyType` =
 * `bodyRules(meta, tpl.id)`, `visual` = `doc.slideVisual` yoki shablon).
 *
 * Bu faqat TEZ oldindan tekshiruv (bitta o'qish): haqiqiy yozuv baribir
 * `commitDocOps` da, versiya qulfi bilan. Begona/tayyor bo'lmagan hujjat
 * shu yerda ham 404/409 oladi — aktiv yozilmaydi. Indeks chegaradan
 * tashqarida yoki maketda rasm joyi yo'q bo'lsa — qaror `applyDocOps`
 * ga qoldiriladi (422, o'z xabari bilan).
 */
async function assertTextFitsImage(id: string, userId: string, index: number): Promise<void> {
  const cur = await loadDocForEdit(id, userId);
  const slide = cur.doc.slides?.[index];
  if (!slide) return;
  const deck = buildSlideDeck(cur.doc);
  if (imageYieldField(slide, deck.bodyType, deck.visual)) throw new ApiError(TEXT_TOO_LONG_FOR_IMAGE, 400, { code: "text_too_long" });
}

/**
 * Foydalanuvchi o'z PNG/JPEG faylini biriktiradi (AI EMAS).
 *
 * Tartib: hajm (sarlavha, so'ng haqiqiy `file.size`) → sniff (baytlardan,
 * `content-type`dan EMAS — `logo.ts` bilan bir xil naqsh) →
 * `commitDocOps` (egalik, versiya qulfi, maket rasm joyi, kvota va
 * aktivga yozish — hammasi BITTA tranzaksiyada, ikkinchi marta yozilmaydi).
 */
export async function uploadSlideImage(
  req: Request,
  id: string,
  userId: string,
  index: number,
): ReturnType<typeof commitDocOps> {
  assertValidIndex(index);

  // Hajm tana o'qilayotganda — chunked so'rovda ham (SECB-05).
  const form = await readUploadForm(req, SLIDE_IMAGE_MAX_BYTES + 64 * 1024, "Fayl juda katta");
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

  /*
   * `asset_id` baytning xeshi — URL yozishdan OLDIN ma'lum. Bayt esa
   * hujjat bilan BITTA tranzaksiyada yoziladi (SECB-03): begona hujjat
   * (404), eskirgan versiya (409), rasm joyi yo'q maket (422) yoki kvota
   * (413) — bazada yetim aktiv qolmaydi.
   */
  // Matn rasm tasmasi bilan sig'masa — 400, aktiv yozilmaydi (P8).
  await assertTextFitsImage(id, userId, index);
  const upload = pendingUpload(mime, bytes);
  const ops: DocOp[] = [{ op: "image", index, url: assetUrl(id, upload.assetId) }];
  return commitDocOps(id, userId, baseVersion, ops, { uploads: [upload] });
}
