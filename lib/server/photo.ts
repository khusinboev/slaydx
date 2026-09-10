import "server-only";
import { createHash } from "node:crypto";
import { query, queryOne } from "./db";
import { ApiError } from "./api";
import { imageDims, sniffImageType } from "../generation/slide-images";

/**
 * Rezyume surati (Rezyume 2, AUDIT-15) — `logo.ts` shartnomasining
 * rezyume varianti.
 *
 * Ikki bayt saqlanadi: KESILGAN (rezyumega tushadigan, 600×600 dan
 * katta emas) va ASL (ixtiyoriy). Nega asl ham: «Rasmni markazlash»
 * kesilgan suratdan qayta kesmaydi — u asl pikselni qayta ochadi,
 * aks holda har markazlash sifatni pog'onama-pog'ona yo'qotardi.
 *
 * Kesish KLIENTDA bajariladi (`PhotoCropDialog` canvas bilan): doira
 * shaklidagi shablonlar uchun burchaklari SHAFFOF PNG kerak — `docx`
 * `ImageRun` rasmni doiraga kesa olmaydi (B-9).
 */

/** Asl surat chegarasi. Klient kesilgan nusxani 600×600 qilib yuboradi. */
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
/** Kesilgan nusxa uchun tomon chegarasi — undan kattasi rad etiladi. */
export const PHOTO_CROP_MAX_SIDE = 1200;

export type PhotoCrop = { x: number; y: number; zoom: number };
export type PhotoUploadResult = {
  assetId: string;
  mime: "image/png" | "image/jpeg";
  size: number;
  shape: "circle" | "square";
  originalAssetId?: string;
  crop?: PhotoCrop;
};

function assetIdFor(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 24);
}

function parseCrop(raw: unknown): PhotoCrop | undefined {
  if (typeof raw !== "string" || !raw) return undefined;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const num = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) ? x : d);
    return { x: num(v.x, 0.5), y: num(v.y, 0.5), zoom: Math.min(8, Math.max(1, num(v.zoom, 1))) };
  } catch {
    return undefined;
  }
}

export async function putPhoto(
  userId: string,
  bytes: Buffer,
  mime: "image/png" | "image/jpeg",
  opts: { kind?: "crop" | "original"; originalAssetId?: string; crop?: PhotoCrop } = {},
): Promise<string> {
  const assetId = assetIdFor(bytes);
  await query(
    `INSERT INTO photo_uploads (user_id, asset_id, kind, mime, size_bytes, bytes, original_asset_id, crop)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (user_id, asset_id) DO UPDATE
        SET original_asset_id = EXCLUDED.original_asset_id,
            crop              = EXCLUDED.crop`,
    [
      userId,
      assetId,
      opts.kind ?? "crop",
      mime,
      bytes.byteLength,
      bytes,
      opts.originalAssetId ?? null,
      opts.crop ? JSON.stringify(opts.crop) : null,
    ],
  );
  return assetId;
}

export type PhotoRow = {
  bytes: Buffer;
  mime: string;
  kind: string;
  crop: PhotoCrop | null;
  originalAssetId: string | null;
};

/** Egalik SQL da — begona foydalanuvchi suratini olib bo'lmaydi. */
export async function getPhoto(userId: string, assetId: string): Promise<PhotoRow | null> {
  if (!/^[0-9a-f]{24}$/i.test(assetId)) return null;
  const row = await queryOne<{
    bytes: Buffer;
    mime: string;
    kind: string;
    crop: PhotoCrop | null;
    original_asset_id: string | null;
  }>(
    `SELECT bytes, mime, kind, crop, original_asset_id FROM photo_uploads WHERE user_id = $1 AND asset_id = $2`,
    [userId, assetId],
  );
  if (!row) return null;
  return { bytes: row.bytes, mime: row.mime, kind: row.kind, crop: row.crop, originalAssetId: row.original_asset_id };
}

/**
 * Worker `photoAssetId` ni `data:` URL ga aylantiradi (`logoDataUrl`
 * naqshi). Topilmasa `undefined` — XATO EMAS: rezyume suratsiz chiqadi,
 * ish yiqilmaydi.
 */
export async function photoDataUrl(
  userId: string,
  assetId: string,
): Promise<{ url: string; assetId: string; shape: "circle" | "square"; crop?: PhotoCrop; originalAssetId?: string } | undefined> {
  if (!userId || !assetId) return undefined;
  const row = await getPhoto(userId, assetId).catch(() => null);
  if (!row) return undefined;
  return {
    url: `data:${row.mime};base64,${row.bytes.toString("base64")}`,
    assetId,
    // Doira nusxasi shaffoflik uchun doim PNG bo'lib keladi.
    shape: row.mime === "image/png" ? "circle" : "square",
    ...(row.crop ? { crop: row.crop } : {}),
    ...(row.originalAssetId ? { originalAssetId: row.originalAssetId } : {}),
  };
}

/**
 * So'rovdan kesilgan (va ixtiyoriy asl) suratni o'qib saqlaydi.
 *
 * Autentifikatsiya route'da qoladi (`logo.ts` dagi izoh) — bu funksiya
 * oddiy `Request` bilan ishlaydi va test uni Next konteksti kerak
 * bo'lmasdan chaqira oladi.
 *
 * Maydonlar: `file` (kesilgan, majburiy), `original` (asl, ixtiyoriy),
 * `crop` (JSON), `shape` ("circle" | "square").
 */
export async function uploadPhoto(req: Request, userId: string): Promise<PhotoUploadResult> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > 2 * PHOTO_MAX_BYTES + 64 * 1024) {
    throw new ApiError("Fayl 5 MB dan katta", 413);
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw new ApiError("Fayl yuborilmadi", 400);
  if (file.size === 0) throw new ApiError("Fayl bo'sh", 400);
  if (file.size > PHOTO_MAX_BYTES) throw new ApiError("Fayl 5 MB dan katta", 413);

  const bytes = Buffer.from(await file.arrayBuffer());
  const type = sniffImageType(bytes);
  if (!type) throw new ApiError("Faqat PNG yoki JPEG qabul qilinadi", 415);
  const dims = imageDims(bytes);
  if (dims && (dims.w > PHOTO_CROP_MAX_SIDE || dims.h > PHOTO_CROP_MAX_SIDE)) {
    throw new ApiError("Kesilgan surat 1200 pikseldan katta bo'lmasin", 422);
  }
  const crop = parseCrop(form?.get("crop"));
  const shape = form?.get("shape") === "square" ? "square" : "circle";

  // Asl nusxa ixtiyoriy: uni saqlash «markazlash» uchun, generatsiya
  // uchun emas — shuning uchun xatosi butun yuklashni yiqitmaydi.
  let originalAssetId: string | undefined;
  const original = form?.get("original");
  if (original instanceof File && original.size > 0 && original.size <= PHOTO_MAX_BYTES) {
    const ob = Buffer.from(await original.arrayBuffer());
    const ot = sniffImageType(ob);
    if (ot) originalAssetId = await putPhoto(userId, ob, ot === "png" ? "image/png" : "image/jpeg", { kind: "original" });
  }

  const mime = type === "png" ? "image/png" : "image/jpeg";
  const assetId = await putPhoto(userId, bytes, mime, { kind: "crop", originalAssetId, crop });
  return { assetId, mime, size: bytes.byteLength, shape, ...(originalAssetId ? { originalAssetId } : {}), ...(crop ? { crop } : {}) };
}

/**
 * Eski suratlarni tozalaydi (worker `housekeeping`).
 *
 * Manba fayllar naqshi: surat — shaxsiy ma'lumot, uni abadiy saqlash
 * keraksiz yuk. 90 kun: foydalanuvchi rezyumesini mavsumiy yangilashi
 * normal, lekin generatsiyaga tushgan nusxa allaqachon `generation_assets`
 * da — bu jadval faqat FORMA uchun ishlaydi.
 */
export async function purgeOldPhotos(days = 90): Promise<number> {
  const res = await query<{ asset_id: string }>(
    `DELETE FROM photo_uploads WHERE created_at < now() - ($1 || ' days')::interval RETURNING asset_id`,
    [String(days)],
  );
  return res.length;
}
