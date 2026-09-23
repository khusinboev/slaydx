import "server-only";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { pool, query, transaction } from "./db";
import { ApiError } from "./api";

/**
 * Foydalanuvchi yuklamalari uchun SAQLASH KVOTASI (C13: DB-02).
 *
 * Ilgari yuklash route'larida faqat chastota chegarasi bor edi: bitta
 * bepul hisob soatiga ≈ 5.6 GB `bytea` yoza olardi (manba 20 MB, surat
 * + asl nusxa, shablon + rasterlar, logotip, slayd rasmi), logotip va
 * shablonlar esa hech qachon tozalanmasdi — baza turgan disk esa yana
 * ikki loyiha bilan umumiy.
 *
 * Endi har yozishdan OLDIN foydalanuvchining tirik qatorlari sanaladi:
 *   • umumiy hajm (barcha yuklama jadvallari + tayyor hujjatga keyin
 *     yuklangan rasmlar) — `totalBytes`;
 *   • har tur bo'yicha soni — `count`;
 *   • bitta tayyor hujjatga keyin yuklangan rasmlar soni — `perGeneration`.
 *
 * Tekshiruv va yozish BITTA tranzaksiyada, foydalanuvchi bo'yicha
 * `pg_advisory_xact_lock` ostida — parallel yuklamalar chegaradan
 * birgalikda o'tib keta olmaydi. Qimmat ish (tahlil, rasterlash)
 * oldidan esa qulfsiz `assertUploadQuota` — kvotadan oshgan yuklama
 * CPU ham yemasin.
 *
 * Sonlar — egasi tasdiqlashi kerak bo'lgan taklif (yakuniy hisobotda).
 */

const MB = 1024 * 1024;

export const UPLOAD_QUOTA = {
  /** Bitta foydalanuvchining barcha yuklamalari (bayt). */
  totalBytes: 200 * MB,
  count: {
    /** Rezyume suratlari (kesilgan + asl — ikkalasi ham qator). */
    photo: 50,
    logo: 20,
    template: 20,
    source: 30,
  },
  /** Bitta tayyor hujjatga keyin yuklangan rasmlar (slayd rasmi, rezyume surati). */
  perGeneration: 60,
} as const;

export type UploadKind = "photo" | "logo" | "template" | "source" | "generation";

export type IncomingUpload = {
  /** Yoziladigan `asset_id` lar — shu nomli mavjud qator ALMASHADI, qo'shilmaydi. */
  assetIds: string[];
  /** Yangi qatorlarning jami hajmi (bayt). */
  bytes: number;
  /** Faqat `generation` uchun. */
  generationId?: string;
};

const LABEL: Record<UploadKind, string> = {
  photo: "Suratlar",
  logo: "Logotiplar",
  template: "Shablonlar",
  source: "Manba fayllar",
  generation: "Bu hujjatga yuklangan rasmlar",
};

type Exec = Pick<PoolClient, "query">;

/*
 * Tayyor hujjatga KEYIN yuklangan rasm = `created_at > finished_at`.
 * Worker yaratgan rasmlar (Gemini, sxemalar) hujjat tugashidan oldin
 * yoziladi va kvotaga kirmaydi — ular pullik ish natijasi.
 */
const USAGE_SQL = `
  WITH u AS (
    SELECT 'logo' AS kind, asset_id AS id, size_bytes AS bytes
      FROM logo_uploads WHERE user_id = $1
    UNION ALL
    SELECT 'photo', asset_id, size_bytes
      FROM photo_uploads WHERE user_id = $1
    UNION ALL
    SELECT 'template', asset_id, size_bytes + COALESCE(pg_column_size(previews), 0)
      FROM template_uploads WHERE user_id = $1
    UNION ALL
    SELECT 'source', asset_id, size_bytes + COALESCE(pg_column_size(text), 0)
      FROM source_uploads WHERE user_id = $1
    UNION ALL
    SELECT 'generation', a.generation_id::text || ':' || a.asset_id, a.size_bytes
      FROM generation_assets a
      JOIN generations g ON g.id = a.generation_id
     WHERE g.user_id = $1 AND a.created_at > COALESCE(g.finished_at, g.created_at)
  )
  SELECT COALESCE(sum(bytes), 0)::bigint AS total_bytes,
         (count(*) FILTER (WHERE kind = $2))::int AS kind_count,
         (count(*) FILTER (WHERE kind = 'generation' AND id LIKE $4 || ':%'))::int AS gen_count
    FROM u
   WHERE NOT (kind = $2 AND id = ANY($3::text[]))`;

/** Chegara tekshiruvi — `exec` tranzaksiya mijozi yoki umumiy hovuz. */
async function check(exec: Exec, userId: string, kind: UploadKind, incoming: IncomingUpload): Promise<void> {
  const genId = incoming.generationId ?? "";
  const ids = [...new Set(incoming.assetIds)].map((id) => (kind === "generation" ? `${genId}:${id}` : id));

  if (kind === "generation") {
    // Egalik YOZISHDAN OLDIN (BEA-03): begona hujjatga bayt tushmaydi.
    const own = await exec.query(`SELECT 1 FROM generations WHERE id = $1 AND user_id = $2`, [genId, userId]);
    if (!own.rows.length) throw new ApiError("Hujjat topilmadi", 404);
  }

  const res = await exec.query<{ total_bytes: string; kind_count: number; gen_count: number }>(USAGE_SQL, [
    userId,
    kind,
    ids,
    genId,
  ]);
  const row = res.rows[0];
  const total = Number(row?.total_bytes ?? 0);

  const count = kind === "generation" ? Number(row?.gen_count ?? 0) : Number(row?.kind_count ?? 0);
  const max = kind === "generation" ? UPLOAD_QUOTA.perGeneration : UPLOAD_QUOTA.count[kind];
  if (count + ids.length > max) {
    throw new ApiError(
      `${LABEL[kind]} soni chegaraga yetdi (${max} ta). Keraksizlarini o'chiring — foydalanilmagan fayllar 90 kundan keyin o'zi tozalanadi.`,
      413,
      { code: "quota", kind, limit: max },
    );
  }
  if (total + incoming.bytes > UPLOAD_QUOTA.totalBytes) {
    throw new ApiError(
      `Yuklangan fayllaringiz hajmi chegaraga yetdi (${UPLOAD_QUOTA.totalBytes / MB} MB). Keraksiz fayllarni o'chiring yoki keyinroq urinib ko'ring.`,
      413,
      { code: "quota", kind, limitBytes: UPLOAD_QUOTA.totalBytes },
    );
  }
}

/**
 * Qulfsiz oldindan tekshiruv — QIMMAT ishdan (tahlil, rasterlash) oldin.
 * Yakuniy, poyga-xavfsiz tekshiruv baribir `withUploadQuota` da.
 */
export async function assertUploadQuota(userId: string, kind: UploadKind, incoming: IncomingUpload): Promise<void> {
  await check(pool(), userId, kind, incoming);
}

/**
 * Kvota tekshiruvi + yozish BITTA tranzaksiyada, foydalanuvchi qulfi ostida.
 * `store` AYNAN shu `client` bilan yozishi shart: aks holda qulfni ushlab
 * turgan ulanish hovuzdan ikkinchisini kutib qolardi.
 */
export async function withUploadQuota<T>(
  userId: string,
  kind: UploadKind,
  incoming: IncomingUpload,
  store: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('upload-quota'), hashtext($1))", [String(userId)]);
    await check(client, userId, kind, incoming);
    return store(client);
  });
}

/** `assets.ts` `assetIdFor` bilan bir xil formula — bir xil bayt, bitta qator. */
export function uploadAssetId(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 24);
}

/**
 * Tayyor hujjatga foydalanuvchi rasmini yozadi — kvota va egalik bilan.
 *
 * `assets.ts` `putAssets` bilan bir xil INSERT, lekin kvota qulfini
 * ushlab turgan o'sha tranzaksiya mijozi orqali (yuqoridagi izoh).
 */
export async function putGenerationUpload(
  generationId: string,
  userId: string,
  mime: string,
  bytes: Buffer,
): Promise<string> {
  const assetId = uploadAssetId(bytes);
  await withUploadQuota(userId, "generation", { assetIds: [assetId], bytes: bytes.byteLength, generationId }, (c) =>
    c.query(
      `INSERT INTO generation_assets (generation_id, asset_id, mime, size_bytes, bytes, expires_at)
       VALUES ($1, $2, $3, $4, $5, NULL)
       ON CONFLICT (generation_id, asset_id) DO NOTHING`,
      [generationId, assetId, mime, bytes.byteLength, bytes],
    ),
  );
  return assetId;
}

/**
 * Foydalanilmagan eski logotip va shablonlarni tozalaydi (worker `housekeeping`).
 *
 * «Foydalanilmoqda» = foydalanuvchining biror generatsiyasi (`values_json`,
 * shablon uchun `doc_json.customTemplate` ham) yoki forma qoralamasi
 * (`form_drafts`) shu `asset_id` ga ishora qiladi. Ishora qilingan qator
 * yoshidan qat'i nazar QOLADI: tahrirdan keyingi qayta render namunaning
 * baytini o'qiydi (`edit-adapters.ts`).
 */
export async function purgeUnusedUploads(days = 90): Promise<{ logos: number; templates: number }> {
  const age = String(Math.max(1, Math.floor(days)));
  const logos = await query<{ asset_id: string }>(
    `DELETE FROM logo_uploads l
      WHERE l.created_at < now() - ($1 || ' days')::interval
        AND NOT EXISTS (SELECT 1 FROM generations g
                         WHERE g.user_id = l.user_id AND lower(g.values_json->>'logoAssetId') = l.asset_id)
        AND NOT EXISTS (SELECT 1 FROM form_drafts d
                         WHERE d.user_id = l.user_id AND lower(d.data->>'logoAssetId') = l.asset_id)
      RETURNING l.asset_id`,
    [age],
  );
  const templates = await query<{ asset_id: string }>(
    `DELETE FROM template_uploads t
      WHERE t.created_at < now() - ($1 || ' days')::interval
        AND NOT EXISTS (SELECT 1 FROM generations g
                         WHERE g.user_id = t.user_id
                           AND (lower(g.values_json->>'templateAssetId') = t.asset_id
                                OR lower(g.doc_json->'customTemplate'->>'assetId') = t.asset_id))
        AND NOT EXISTS (SELECT 1 FROM form_drafts d
                         WHERE d.user_id = t.user_id AND lower(d.data->>'templateAssetId') = t.asset_id)
      RETURNING t.asset_id`,
    [age],
  );
  return { logos: logos.length, templates: templates.length };
}
