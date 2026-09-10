import "server-only";
import { ApiError } from "./api";
import { assetUrl, putAssetBytes } from "./assets";
import { commitDocOps } from "./slide-commit";
import { sniffImageType } from "../generation/slide-images";
import { SLIDE_IMAGE_MAX_BYTES } from "../generation/slide-limits";
import type { ResumeOp } from "../generation/resume/edit";

/**
 * Rezyume suratini ko'ruvchidan almashtirish (Rezyume 2, AUDIT-15).
 *
 * Route (`app/api/generations/[id]/photo/route.ts`) ATAYIN yupqa —
 * `slide-image.ts` bilan bir xil naqsh: autentifikatsiya va chastota
 * chegarasi u yerda, qolgan hamma narsa (hajm, sniff, aktivga yozish,
 * egalik, versiya qulfi) shu modulda. Sabab `cookies()` — route
 * funksiyasining o'zini testdan chaqirib bo'lmaydi, sessiyadan
 * ajratilgan funksiyani esa haqiqiy `Request` bilan chaqirsa bo'ladi.
 *
 * Ikkita bayt keladi:
 *
 *   • `file` — KESILGAN surat (doira shablonda niqob KLIENTDA qo'llanadi
 *     va shaffof PNG bo'lib keladi; DOCX da doira niqob yo'q);
 *   • `original` — ixtiyoriy asl surat, keyinchalik qayta markazlash
 *     uchun (`photo.originalAssetId`).
 *
 * Modelga yozish `commitDocOps` orqali — ya'ni egalik, `baseVersion`
 * qulfi va URL egaligi tekshiruvi (`applyResumeOps` dagi
 * `ownAssetUrlRe`) ikkinchi marta yozilmaydi.
 */

export type ResumePhotoResult = ReturnType<typeof commitDocOps>;

function assertBytes(file: unknown, field: string): File {
  if (!(file instanceof File)) throw new ApiError(`«${field}» yuborilmadi`, 400);
  if (file.size === 0) throw new ApiError("Fayl bo'sh", 400);
  if (file.size > SLIDE_IMAGE_MAX_BYTES) throw new ApiError("Fayl juda katta", 413);
  return file;
}

/** `content-type` sarlavhasiga ISHONILMAYDI — faqat magic baytlar (`logo.ts` naqshi). */
async function storeImage(genId: string, file: File): Promise<{ assetId: string; url: string }> {
  const bytes = Buffer.from(await file.arrayBuffer());
  const type = sniffImageType(bytes);
  if (!type) throw new ApiError("Faqat PNG yoki JPEG qabul qilinadi", 415);
  const assetId = await putAssetBytes(genId, type === "png" ? "image/png" : "image/jpeg", bytes);
  return { assetId, url: assetUrl(genId, assetId) };
}

function parseCrop(raw: unknown): { x: number; y: number; zoom: number } | undefined {
  if (typeof raw !== "string" || !raw) return undefined;
  try {
    const c = JSON.parse(raw) as Record<string, unknown>;
    if (typeof c.x !== "number" || typeof c.y !== "number" || typeof c.zoom !== "number") return undefined;
    if (![c.x, c.y, c.zoom].every((n) => Number.isFinite(n))) return undefined;
    return { x: c.x, y: c.y, zoom: c.zoom };
  } catch {
    return undefined;
  }
}

export async function uploadResumePhoto(req: Request, id: string, userId: string): ResumePhotoResult {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > SLIDE_IMAGE_MAX_BYTES * 2 + 64 * 1024) {
    throw new ApiError("Fayl juda katta", 413);
  }

  const form = await req.formData().catch(() => null);
  if (!form) throw new ApiError("So'rov tanasi yaroqsiz", 400);

  const baseVersionRaw = form.get("baseVersion");
  const baseVersion = Number(baseVersionRaw);
  if (typeof baseVersionRaw !== "string" || !Number.isInteger(baseVersion) || baseVersion < 0) {
    throw new ApiError("«baseVersion» yaroqsiz", 400);
  }

  // Bo'sh `file` — suratni OLIB TASHLASH (klient `remove=1` yuboradi).
  if (form.get("remove") === "1") {
    return commitDocOps(id, userId, baseVersion, [{ op: "photo", url: "" }] satisfies ResumeOp[]);
  }

  const shapeRaw = form.get("shape");
  const shape: "circle" | "square" = shapeRaw === "square" ? "square" : "circle";

  const cropped = await storeImage(id, assertBytes(form.get("file"), "file"));
  const originalFile = form.get("original");
  const original = originalFile instanceof File && originalFile.size ? await storeImage(id, assertBytes(originalFile, "original")) : null;
  const crop = parseCrop(form.get("crop"));

  const op: ResumeOp = {
    op: "photo",
    url: cropped.url,
    shape,
    assetId: cropped.assetId,
    ...(original ? { originalAssetId: original.assetId } : {}),
    ...(crop ? { crop } : {}),
  };
  return commitDocOps(id, userId, baseVersion, [op]);
}
