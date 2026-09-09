import "server-only";
import { randomInt } from "node:crypto";
import { ApiError } from "./api";
import { commitDocOps, loadDocForEdit } from "./slide-commit";
import { assetUrl, putAssetBytes } from "./assets";
import { reserveRedraw, releaseRedraw } from "./jobs";
import { fetchImageBytes, sniffImageType } from "../generation/slide-images";
import { IMAGE_REDRAW_LIMIT, SLIDE_IMAGE_MAX_BYTES } from "../generation/slide-limits";
import { pickProvider, type FalFailure } from "../generation/image-provider";
import { composeSlideImagePrompt } from "../generation/slide-image-prompts";
import { photoSlot, slotPixels } from "../generation/slide-layout";
import { buildSlideDeck } from "../generation/slides";
import type { DocOp } from "../generation/slide-edit";

/**
 * Slayd rasmini yuklash va qayta chizish (E5).
 *
 * Route'lar (`.../image/route.ts`, `.../image/regenerate/route.ts`)
 * ATAYIN yupqa: autentifikatsiya, chastota chegarasi va so'rov shakli
 * shu yerda emas — hamma haqiqiy mantiq (hajm, sniff, egalik, versiya
 * qulfi, limit, provayder) shu modulda, `slide-commit.ts`/`logo.ts`
 * naqshi bilan bir xil.
 *
 * Ikki funksiya, ikki YO'L:
 *
 *   - `uploadSlideImage` — foydalanuvchi O'ZINING faylini yuklaydi.
 *     Limit YO'Q (`IMAGE_REDRAW_LIMIT` faqat AI chizishga tegishli),
 *     shunchaki `commitDocOps`ga bitta `image` operatsiyasi yuboriladi
 *     — qolgan hamma tekshiruv (indeks chegarasi, maket rasm joyi)
 *     `applyDocOps` ichida (`slide-edit.ts`).
 *
 *   - `regenerateSlideImage` — AI qayta chizadi. Bu yerda LIMIT bor
 *     (`reserveRedraw`/`releaseRedraw`, TOCTOU'siz UPDATE predikatida,
 *     `jobs.ts`) va provayder chaqiruvi. Limit band qilingandan keyingi
 *     HAR bir yiqilishda (prompt/provayder/saqlash/commit — farqi yo'q)
 *     `releaseRedraw` chaqiriladi, aks holda muvaffaqiyatsiz urinish
 *     ham foydalanuvchining bepul limitidan yeb qo'yardi.
 */

/** Yuklash/regenerate uchun umumiy indeks shakli tekshiruvi — 400. */
function assertValidIndex(index: number): void {
  if (!Number.isInteger(index) || index < 0) {
    throw new ApiError("Noto'g'ri slayd indeksi", 400);
  }
}

/** Provayder yiqilish sababi → HTTP status. */
const FAILURE_STATUS: Record<FalFailure, number> = {
  "no-key": 503,
  blocked: 503,
  rate: 429,
  timeout: 504,
  failed: 502,
};

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

/** `data:mime;base64,xxxx` shaklidagi `ImageBytes.data` dan xom baytni ajratadi. */
function rawBytesOf(data: string): Buffer {
  const comma = data.indexOf(",");
  return Buffer.from(comma === -1 ? data : data.slice(comma + 1), "base64");
}

/**
 * AI slayd rasmini qayta chizadi.
 *
 * `hint` berilsa — ikkita operatsiya BITTA `commitDocOps` chaqirig'ida:
 * avval `imageHint` matni yangilanadi (foydalanuvchi keyingi safar
 * o'sha ko'rsatmani ko'radi), so'ng yangi rasm. Ikkalasi ham yo'q
 * bo'lib qolmasin ("ko'rdim = oldim") — atomik.
 */
export async function regenerateSlideImage(
  id: string,
  userId: string,
  index: number,
  baseVersion: number,
  hint?: string,
): ReturnType<typeof commitDocOps> {
  assertValidIndex(index);

  const cur = await loadDocForEdit(id, userId);
  const slide = cur.doc.slides[index];
  if (!slide) throw new ApiError("Noto'g'ri slayd indeksi", 400);

  const deck = buildSlideDeck(cur.doc);
  const slot = photoSlot(slide.layout, deck.visual);
  if (!slot) throw new ApiError("Bu maketda rasm joyi yo'q", 422);

  // TOCTOU yo'q: limit va egalik BITTA UPDATE predikatida (`jobs.ts`).
  const reserved = await reserveRedraw(id, userId, IMAGE_REDRAW_LIMIT);
  if (reserved == null) {
    throw new ApiError("Bepul qayta chizish limiti tugadi", 409, {
      code: "redraw_limit",
      imageRedraws: cur.imageRedraws,
    });
  }

  try {
    const meta = cur.doc.meta;
    const size = slotPixels(slot);
    const prompt = composeSlideImagePrompt(
      cur.topic,
      { ...slide, imageHint: hint ?? slide.imageHint },
      size,
      meta,
    );
    const provider = pickProvider(meta);
    // ATAYLAB `seedFrom(topic)` EMAS: bitta rasmni qayta chizishda
    // foydalanuvchi YANGI natija kutadi — deka seed'i bilan chizsa
    // ilgarigi bilan bir xil (yoki juda o'xshash) rasm qaytardi.
    const seed = randomInt(1_000_000);
    const res = await provider.fetchImage(
      { prompt, size, styleId: meta.slideImageStyle ?? "photo", seed, premium: meta.premiumVisuals },
      Date.now() + 75_000,
    );
    if (!res.ok) {
      throw new ApiError(`Rasm chizilmadi: ${res.detail}`, FAILURE_STATUS[res.reason], {
        code: res.reason,
      });
    }

    const bytes = await fetchImageBytes(res.image.url);
    if (!bytes) throw new ApiError("Rasm saqlanmadi", 502, { code: "failed" });

    const mime = bytes.type === "png" ? "image/png" : "image/jpeg";
    const assetId = await putAssetBytes(id, mime, rawBytesOf(bytes.data));
    const url = assetUrl(id, assetId);

    const ops: DocOp[] = [];
    if (hint !== undefined) ops.push({ op: "text", index, src: { f: "imageHint" }, value: hint });
    ops.push({ op: "image", index, url, ...(res.image.alt ? { alt: res.image.alt } : {}) });

    return await commitDocOps(id, userId, baseVersion, ops);
  } catch (e) {
    // HAR yiqilish — bepul limit qaytariladi (band qilingandan keyingi
    // istisnosiz har bir chiqish yo'li: prompt, provayder, saqlash, commit).
    await releaseRedraw(id, userId);
    throw e;
  }
}
