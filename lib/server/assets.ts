import "server-only";
import { createHash } from "node:crypto";
import { query, queryOne } from "./db";
import { env } from "./env";
import type { AcademicDoc } from "../generation/types";

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
    const m = DATA_URL.exec(url);
    if (!m) return url;
    const bytes = Buffer.from(m[2], "base64");
    if (!bytes.byteLength) return url;
    const assetId = assetIdFor(bytes);
    if (!assets.has(assetId)) assets.set(assetId, { assetId, mime: m[1], bytes });
    return assetUrl(generationId, assetId);
  };

  let nextDoc = doc;
  if (doc) {
    nextDoc = {
      ...doc,
      slides: doc.slides?.map((s) =>
        s.image?.url ? { ...s, image: { ...s.image, url: swap(s.image.url) ?? s.image.url } } : s,
      ),
      images: doc.images?.map((im) => ({ ...im, url: swap(im.url) ?? im.url })),
    };
  }

  // HTML dagi qolgan data: URL lar (masalan `<img src="data:...">`).
  const nextHtml = html.replace(
    /data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/=]{64,})/g,
    (full) => swap(full) ?? full,
  );

  return { doc: nextDoc, html: nextHtml, assets: [...assets.values()] };
}

export async function putAssets(generationId: string, assets: PendingAsset[]): Promise<void> {
  if (!assets.length) return;
  const expiresAt = new Date(Date.now() + env.fileTtlHours * 3_600_000);
  for (const a of assets) {
    await query(
      `INSERT INTO generation_assets (generation_id, asset_id, mime, size_bytes, bytes, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (generation_id, asset_id) DO NOTHING`,
      [generationId, a.assetId, a.mime, a.bytes.byteLength, a.bytes, expiresAt],
    );
  }
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
      WHERE a.generation_id = $1 AND a.asset_id = $2 AND g.user_id = $3 AND a.expires_at > now()`,
    [generationId, assetId, userId],
  );
  return row ?? null;
}

/** Bitta generatsiyaning barcha aktivlarini o'chiradi. */
export async function deleteAssets(generationId: string): Promise<void> {
  await query("DELETE FROM generation_assets WHERE generation_id = $1", [generationId]);
}

export async function purgeExpiredAssets(): Promise<number> {
  const rows = await query<{ count: string }>(
    `WITH gone AS (DELETE FROM generation_assets WHERE expires_at < now() RETURNING 1)
     SELECT count(*)::text AS count FROM gone`,
  );
  return Number(rows[0]?.count ?? 0);
}
