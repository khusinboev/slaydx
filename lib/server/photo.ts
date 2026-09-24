import "server-only";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { query, queryOne } from "./db";
import { ApiError } from "./api";
import { readUploadForm } from "./upload-body";
import { withUploadQuota } from "./upload-quota";
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

type PhotoOpts = { kind?: "crop" | "original"; originalAssetId?: string; crop?: PhotoCrop };

/**
 * Bitta surat qatori — kvota tranzaksiyasi ichida (`client`).
 *
 * Bir xil bayt (xesh) — o'sha qator: `created_at` YANGILANADI (BEA-19).
 * Aks holda 89-kuni qayta tanlangan surat ertasi kuni `purgeOldPhotos`
 * bilan o'chib, forma singan rasm ko'rsatardi.
 */
async function insertPhoto(
  client: PoolClient,
  userId: string,
  bytes: Buffer,
  mime: "image/png" | "image/jpeg",
  opts: PhotoOpts,
): Promise<string> {
  const assetId = assetIdFor(bytes);
  await client.query(
    `INSERT INTO photo_uploads (user_id, asset_id, kind, mime, size_bytes, bytes, original_asset_id, crop)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (user_id, asset_id) DO UPDATE
        SET original_asset_id = EXCLUDED.original_asset_id,
            crop              = EXCLUDED.crop,
            created_at        = now()`,
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

/** Bitta suratni foydalanuvchi kvotasi ostida saqlaydi (C13). */
export async function putPhoto(
  userId: string,
  bytes: Buffer,
  mime: "image/png" | "image/jpeg",
  opts: PhotoOpts = {},
): Promise<string> {
  return withUploadQuota(userId, "photo", { assetIds: [assetIdFor(bytes)], bytes: bytes.byteLength }, (c) =>
    insertPhoto(c, userId, bytes, mime, opts),
  );
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
  // Hajm tana o'qilayotganda — chunked so'rovda ham (SECB-05).
  const form = await readUploadForm(req, 2 * PHOTO_MAX_BYTES + 64 * 1024, "Fayl 5 MB dan katta");
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
  // uchun emas — shuning uchun yaroqsiz asl nusxa butun yuklashni yiqitmaydi.
  let orig: { bytes: Buffer; mime: "image/png" | "image/jpeg" } | undefined;
  const original = form?.get("original");
  if (original instanceof File && original.size > 0 && original.size <= PHOTO_MAX_BYTES) {
    const ob = Buffer.from(await original.arrayBuffer());
    const ot = sniffImageType(ob);
    if (ot) orig = { bytes: ob, mime: ot === "png" ? "image/png" : "image/jpeg" };
  }

  const mime = type === "png" ? "image/png" : "image/jpeg";
  // Juftlik BITTA kvota tekshiruvi va tranzaksiyada: sig'masa ikkalasi ham yozilmaydi.
  const ids = [assetIdFor(bytes), ...(orig ? [assetIdFor(orig.bytes)] : [])];
  const incoming = bytes.byteLength + (orig?.bytes.byteLength ?? 0);
  const { assetId, originalAssetId } = await withUploadQuota(userId, "photo", { assetIds: ids, bytes: incoming }, async (c) => {
    const originalId = orig ? await insertPhoto(c, userId, orig.bytes, orig.mime, { kind: "original" }) : undefined;
    const cropId = await insertPhoto(c, userId, bytes, mime, { kind: "crop", originalAssetId: originalId, crop });
    return { assetId: cropId, originalAssetId: originalId };
  });
  return { assetId, mime, size: bytes.byteLength, shape, ...(originalAssetId ? { originalAssetId } : {}), ...(crop ? { crop } : {}) };
}

/**
 * Eski suratlarni tozalaydi (worker `housekeeping`).
 *
 * Manba fayllar naqshi: surat — shaxsiy ma'lumot, uni abadiy saqlash
 * keraksiz yuk. 90 kun: foydalanuvchi rezyumesini mavsumiy yangilashi
 * normal, lekin generatsiyaga tushgan nusxa allaqachon `generation_assets`
 * da — bu jadval faqat FORMA uchun ishlaydi.
 *
 * ISHORA QILINGAN surat yoshidan qat'i nazar QOLADI (C41, BEA-19):
 *   • forma qoralamasi (`form_drafts.data` — `photoAssetId`,
 *     `photoOriginalAssetId`) — tiklangan qoralama singan rasm
 *     ko'rsatmasin va shu qoralamadan to'langan rezyume jimgina suratsiz
 *     chiqmasin (worker suratni `values.photoAssetId` dan o'qiydi);
 *   • foydalanuvchining navbatdagi, ishlayotgan yoki TAYYOR rezyumesi
 *     (`values_json.photoAssetId`, `doc_json.resume.photo.assetId` /
 *     `originalAssetId`) — navbatga qaytgan ish ham, «Markazlash» ham
 *     shu qatorni o'qiydi;
 *   • saqlanayotgan kesilgan nusxaning asli (`original_asset_id`).
 * FAILED/REVOKED ish suratni ushlab turmaydi (pul qaytarilgan).
 *
 * Ishoralar faqat eski surati bor foydalanuvchilar bo'yicha yig'iladi —
 * butun `generations` jadvali har kuni ko'rilmaydi.
 */
export async function purgeOldPhotos(days = 90): Promise<number> {
  const res = await query<{ asset_id: string }>(
    `WITH stale AS (
       SELECT DISTINCT user_id FROM photo_uploads WHERE created_at < now() - ($1 || ' days')::interval
     ), refs AS (
       SELECT d.user_id, lower(x.v) AS asset_id
         FROM form_drafts d
         JOIN stale s ON s.user_id = d.user_id
         CROSS JOIN LATERAL (VALUES (d.data->>'photoAssetId'), (d.data->>'photoOriginalAssetId')) AS x(v)
        WHERE x.v IS NOT NULL AND x.v <> ''
       UNION
       SELECT g.user_id, lower(x.v)
         FROM generations g
         JOIN stale s ON s.user_id = g.user_id
         CROSS JOIN LATERAL (VALUES (g.values_json->>'photoAssetId'),
                                    (g.doc_json->'resume'->'photo'->>'assetId'),
                                    (g.doc_json->'resume'->'photo'->>'originalAssetId')) AS x(v)
        WHERE g.tool_id = 'resume' AND g.status IN ('QUEUED', 'IN_PROGRESS', 'COMPLETED')
          AND x.v IS NOT NULL AND x.v <> ''
     ), kept AS (
       SELECT user_id, asset_id FROM refs
       UNION
       SELECT p.user_id, p.original_asset_id
         FROM photo_uploads p
         JOIN refs r ON r.user_id = p.user_id AND r.asset_id = p.asset_id
        WHERE p.original_asset_id IS NOT NULL
     )
     DELETE FROM photo_uploads p
      WHERE p.created_at < now() - ($1 || ' days')::interval
        AND NOT EXISTS (SELECT 1 FROM kept k WHERE k.user_id = p.user_id AND k.asset_id = p.asset_id)
      RETURNING p.asset_id`,
    [String(days)],
  );
  return res.length;
}
