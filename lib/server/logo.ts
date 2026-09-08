import "server-only";
import { createHash } from "node:crypto";
import { query, queryOne } from "./db";
import { ApiError } from "./api";
import { sniffImageType } from "../generation/slide-images";

/**
 * Slayd logotipi yuklash (WP-F).
 *
 * Forma va klient (`uploadLogo` UI tomonda) WP-G da — bu fayl faqat
 * shartnomaning SERVER yarmi: 2 MB chegara, PNG/JPEG sniff (baytlardan,
 * `content-type`dan emas — `slide-images.ts` dagi izohga qarang), va
 * bir xil fayl ikki marta yuklansa bitta qator qolishi.
 */

/** Klient forma maydoni bilan mos — bu ikkisi shartnoma qismi, o'zgartirmang. */
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

/** Bir xil rasm ikki marta yuklansa — bitta qator (`002_assets.sql`dagi naqsh). */
function assetIdFor(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 24);
}

export type LogoUploadResult = { assetId: string; mime: "image/png" | "image/jpeg"; size: number };

/** `ON CONFLICT DO NOTHING` — ikkinchi marta bir xil bayt kelsa jim o'tadi. */
export async function putLogo(
  userId: string,
  bytes: Buffer,
  mime: "image/png" | "image/jpeg",
): Promise<LogoUploadResult> {
  const assetId = assetIdFor(bytes);
  await query(
    `INSERT INTO logo_uploads (user_id, asset_id, mime, size_bytes, bytes)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, asset_id) DO NOTHING`,
    [userId, assetId, mime, bytes.byteLength, bytes],
  );
  return { assetId, mime, size: bytes.byteLength };
}

/** Egalik SQL da tekshiriladi — begona foydalanuvchi logotipini ololmaydi. */
export async function getLogo(
  userId: string,
  assetId: string,
): Promise<{ bytes: Buffer; mime: string } | null> {
  if (!/^[0-9a-f]{24}$/i.test(assetId)) return null;
  const row = await queryOne<{ bytes: Buffer; mime: string }>(
    `SELECT bytes, mime FROM logo_uploads WHERE user_id = $1 AND asset_id = $2`,
    [userId, assetId],
  );
  return row ?? null;
}

/**
 * Worker shu orqali `logoAssetId`ni `data:` URL ga aylantiradi.
 *
 * `id` bo'sh yoki noto'g'ri, yoki qator topilmasa — `undefined`, XATO
 * EMAS: deka logosiz chiqadi, ish yiqilmaydi (masalan foydalanuvchi
 * eski/o'chirilgan `logoAssetId` bilan qayta generatsiya qilsa).
 */
export async function logoDataUrl(userId: string, assetId: string): Promise<string | undefined> {
  if (!userId || !assetId) return undefined;
  const row = await getLogo(userId, assetId).catch(() => null);
  if (!row) return undefined;
  return `data:${row.mime};base64,${row.bytes.toString("base64")}`;
}

/**
 * So'rovdan logotipni o'qib saqlaydi.
 *
 * Autentifikatsiya (`requireUser`, `limit`) route'da qoladi — Next.js
 * `cookies()` faqat so'rov konteksti ICHIDA ishlaydi va shu sabab test
 * ichida to'g'ridan-to'g'ri chaqirib bo'lmaydi. Qolgan hamma narsa —
 * hajm tekshiruvi, sniff, saqlash — shu yerda: oddiy Web `Request`
 * bilan ishlaydi, shuning uchun test uni Next konteksti kerak bo'lmasdan
 * to'g'ridan-to'g'ri chaqira oladi.
 */
export async function uploadLogo(req: Request, userId: string): Promise<LogoUploadResult> {
  // MUHIM: `req.formData()` butun tanani xotiraga o'qiydi (`extract`
  // route'dagi izohga qarang) — hajm shundan OLDIN, sarlavhadan
  // tekshiriladi.
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > LOGO_MAX_BYTES + 64 * 1024) {
    throw new ApiError("Fayl 2 MB dan katta", 413);
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw new ApiError("Fayl yuborilmadi", 400);
  if (file.size > LOGO_MAX_BYTES) throw new ApiError("Fayl 2 MB dan katta", 413);
  if (file.size === 0) throw new ApiError("Fayl bo'sh", 400);

  const bytes = Buffer.from(await file.arrayBuffer());
  // `content-type` sarlavhasiga ISHONILMAYDI — faqat magic baytlar.
  const type = sniffImageType(bytes);
  if (!type) throw new ApiError("Faqat PNG yoki JPEG qabul qilinadi", 415);

  return putLogo(userId, bytes, type === "png" ? "image/png" : "image/jpeg");
}
