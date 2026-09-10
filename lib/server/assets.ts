import "server-only";
import { createHash } from "node:crypto";
import { query, queryOne } from "./db";
import type { AcademicDoc } from "../generation/types";
import type { ImageBytes } from "../generation/slide-images";

/**
 * `data:` URL larni saqlanadigan aktivga aylantiradi.
 *
 * PPTX/DOCX allaqachon rasmni ichiga olgan bo'ladi — bu yerda faqat
 * ko'ruvchi (viewer) uchun kerak bo'lgan nusxa qoladi.
 */

const DATA_URL = /^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/;

export type PendingAsset = { assetId: string; mime: string; bytes: Buffer };

/** Bir xil rasm ikki slaydda bo'lsa — bitta aktiv. */
function assetIdFor(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 24);
}

export function assetUrl(generationId: string, assetId: string): string {
  return `/api/generations/${generationId}/assets/${assetId}`;
}

/**
 * `data:` URL ni parslaydi va aktivga aylanadigan bayt/`assetId`ni
 * qaytaradi. Bo'sh baytli yoki formati mos kelmagan URL uchun `null`.
 *
 * `extractAssets` ichidagi `swap` bilan BIR XIL SHA-256 hisoblanadi —
 * shu tufayli bir xil rasm ikki joyda alohida yuklansa ham bitta
 * aktivga tushadi (`putAssetBytes` ham shundan foydalanadi).
 */
export function assetFromDataUrl(url: string): { assetId: string; mime: string; bytes: Buffer } | null {
  const m = DATA_URL.exec(url);
  if (!m) return null;
  const bytes = Buffer.from(m[2], "base64");
  if (!bytes.byteLength) return null;
  return { assetId: assetIdFor(bytes), mime: m[1], bytes };
}

/**
 * Hujjatdagi barcha `data:` URL larni havolaga almashtiradi va
 * saqlanishi kerak bo'lgan baytlarni qaytaradi.
 */
export function extractAssets(
  generationId: string,
  doc: AcademicDoc | null,
  html: string,
): { doc: AcademicDoc | null; html: string; assets: PendingAsset[] } {
  const assets = new Map<string, PendingAsset>();

  const swap = (url: string | undefined): string | undefined => {
    if (!url) return url;
    const found = assetFromDataUrl(url);
    if (!found) return url;
    if (!assets.has(found.assetId)) assets.set(found.assetId, found);
    return assetUrl(generationId, found.assetId);
  };

  let nextDoc = doc;
  if (doc) {
    nextDoc = {
      ...doc,
      slides: doc.slides?.map((s) =>
        s.image?.url ? { ...s, image: { ...s.image, url: swap(s.image.url) ?? s.image.url } } : s,
      ),
      images: doc.images?.map((im) => ({ ...im, url: swap(im.url) ?? im.url })),
      // Logotip `logo_uploads`dan `data:` URL sifatida keladi
      // (`lib/server/logo.ts` `logoDataUrl`). PPTX uni build vaqtida
      // shu `data:` dan o'qigan bo'ladi, ko'ruvchi esa — hamma boshqa
      // rasm kabi — aktivdan (`slides[].image.url` naqshi).
      slideLogo: doc.slideLogo?.url
        ? { ...doc.slideLogo, url: swap(doc.slideLogo.url) ?? doc.slideLogo.url }
        : doc.slideLogo,
      // «O'z shablonim» fonlari — har rol PNG si aktivga (bir xil rasm bir marta).
      customTemplate: doc.customTemplate
        ? {
            ...doc.customTemplate,
            previews: Object.fromEntries(
              Object.entries(doc.customTemplate.previews).map(([role, p]) => [role, p ? { ...p, png: swap(p.png) ?? p.png } : p]),
            ),
          }
        : doc.customTemplate,
    };
  }

  // HTML dagi qolgan data: URL lar (masalan `<img src="data:...">`).
  const nextHtml = html.replace(
    /data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/=]{64,})/g,
    (full) => swap(full) ?? full,
  );

  return { doc: nextDoc, html: nextHtml, assets: [...assets.values()] };
}

/** Muddatsiz saqlanadi (`011_no_expiry.sql`) — generatsiya o'chsa CASCADE bilan ketadi. */
export async function putAssets(generationId: string, assets: PendingAsset[]): Promise<void> {
  if (!assets.length) return;
  for (const a of assets) {
    await query(
      `INSERT INTO generation_assets (generation_id, asset_id, mime, size_bytes, bytes, expires_at)
       VALUES ($1, $2, $3, $4, $5, NULL)
       ON CONFLICT (generation_id, asset_id) DO NOTHING`,
      [generationId, a.assetId, a.mime, a.bytes.byteLength, a.bytes],
    );
  }
}

/**
 * Bitta rasm baytini to'g'ridan-to'g'ri aktivga yozadi (masalan qayta
 * chizilgan/yuklangan slayd rasmi) va `assetId` qaytaradi.
 *
 * `assetIdFor` bilan bir xil SHA-256 — bir xil bayt ikki marta
 * yuklansa `ON CONFLICT DO NOTHING` tufayli bitta qator qoladi.
 */
export async function putAssetBytes(generationId: string, mime: string, bytes: Buffer): Promise<string> {
  const assetId = assetIdFor(bytes);
  await putAssets(generationId, [{ assetId, mime, bytes }]);
  return assetId;
}

/** O'z generatsiyasining aktiv URL naqshi — boshqa `id` bilan mos kelmaydi. */
export const ASSET_URL_RE = /^\/api\/generations\/([^/]+)\/assets\/([0-9a-f]+)$/;

/** Faqat SHU `generationId`ga tegishli aktiv URL bilan mos keladigan regex. */
export function ownAssetUrlRe(generationId: string): RegExp {
  return new RegExp(`^/api/generations/${generationId}/assets/([0-9a-f]+)$`);
}

/**
 * Tahrirdan keyingi PPTX qayta render uchun rasm hal qiluvchi.
 *
 * Faqat `/api/generations/{SHU genId}/assets/{hex}` naqshiga mos URL
 * `getAsset` (egalik SQL) bilan o'qiladi — boshqa URL (begona generatsiya,
 * `https:`, ...) `null` qaytaradi va `getAsset` UMUMAN chaqirilmaydi
 * (SSRF/IDOR himoyasi — `render-pptx.ts` `opts.resolveImage`).
 */
export function assetImageResolver(
  generationId: string,
  userId: string,
): (url: string) => Promise<ImageBytes | null> {
  const re = ownAssetUrlRe(generationId);
  return async (url: string): Promise<ImageBytes | null> => {
    const m = re.exec(url);
    if (!m) return null;
    const assetId = m[1];
    const asset = await getAsset(generationId, assetId, userId);
    if (!asset) return null;
    const type: "jpg" | "png" = asset.mime === "image/png" ? "png" : "jpg";
    const mime = type === "png" ? "image/png" : "image/jpeg";
    return { data: `${mime};base64,${asset.bytes.toString("base64")}`, type };
  };
}

/** Egalik SQL da tekshiriladi — begona hujjat rasmini ololmaydi. */
export async function getAsset(
  generationId: string,
  assetId: string,
  userId: string,
): Promise<{ bytes: Buffer; mime: string } | null> {
  const row = await queryOne<{ bytes: Buffer; mime: string }>(
    `SELECT a.bytes, a.mime
       FROM generation_assets a
       JOIN generations g ON g.id = a.generation_id
      WHERE a.generation_id = $1 AND a.asset_id = $2 AND g.user_id = $3`,
    [generationId, assetId, userId],
  );
  return row ?? null;
}

/** Bitta generatsiyaning barcha aktivlarini o'chiradi. */
export async function deleteAssets(generationId: string): Promise<void> {
  await query("DELETE FROM generation_assets WHERE generation_id = $1", [generationId]);
}
