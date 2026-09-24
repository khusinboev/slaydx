import "server-only";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { pool, query, transaction } from "./db";
import { ApiError } from "./api";
import { THUMB_ASSET_ID } from "./thumb";

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

/**
 * Kvota xabari — har tur uchun ROST (W2-C review R3): chegara va
 * foydalanuvchi HOZIR nima qila olishi. Faqat haqiqatan ishlaydigan yo'llar
 * aytiladi: shablon va tarjima manbasini o'chirish mumkin (API bor),
 * logotipni o'chirish yo'li YO'Q, manbalar 30 kundan va ishlatilmayotgan
 * suratlar 90 kundan keyin worker tomonidan o'chiriladi (`purgeOldSources`/`purgeOldPhotos`).
 * Foydalanilmagan logotip/shablon tozalash (`purgeUnusedUploads`) ulanmagan —
 * shuning uchun va'da qilinmaydi.
 */
export function quotaMessage(kind: UploadKind, reason: "count" | "bytes"): string {
  if (reason === "bytes") {
    return `Yuklangan fayllaringiz jami ${UPLOAD_QUOTA.totalBytes / MB} MB chegarasiga yetdi. Joy bo'shatish uchun keraksiz shablon yoki tarjima manbalarini o'chiring.`;
  }
  switch (kind) {
    case "logo":
      return `Logotiplar chegarasi — ${UPLOAD_QUOTA.count.logo} ta, yangi logotip qabul qilinmaydi. Avval yuklagan logotip faylingizni qayta tanlashingiz mumkin.`;
    case "photo":
      return `Suratlar chegarasi — ${UPLOAD_QUOTA.count.photo} ta. Avval yuklagan suratingizni qayta tanlang; qoralama yoki rezyumeda ishlatilmayotgan surat 90 kundan keyin o'chiriladi.`;
    case "template":
      return `Shablonlar chegarasi — ${UPLOAD_QUOTA.count.template} ta. Yangisini yuklash uchun «O'z shablonim» ro'yxatidan keraksizini o'chiring.`;
    case "source":
      return `Tarjima manbalari chegarasi — ${UPLOAD_QUOTA.count.source} ta. Keraksiz fayllarni ro'yxatdan o'chiring; har fayl yuklangandan 30 kun o'tib o'zi o'chadi.`;
    case "generation":
      return `Bu hujjatga ${UPLOAD_QUOTA.perGeneration} ta rasm yuklangan — chegara hujjat umri davomida amal qiladi (almashtirilgan rasmlar ham sanaladi). Mavjud rasmlardan foydalaning yoki yangi hujjat yarating.`;
  }
}

type Exec = Pick<PoolClient, "query">;

/*
 * Tayyor hujjatga KEYIN yuklangan rasm = `created_at > finished_at`.
 * Worker yaratgan rasmlar (Gemini, sxemalar) hujjat tugashidan oldin
 * yoziladi va kvotaga kirmaydi — ular pullik ish natijasi. Fayl kartasi
 * eskizi (`THUMB_ASSET_ID`, `thumb.ts`) ham tugagandan KEYIN yoziladi,
 * lekin uni TIZIM yozadi — foydalanuvchi yuklamasi emas, kvotaga kirmaydi
 * (W2-C): aks holda har ko'rilgan hujjat ko'rinmas tarzda chegarani yerdi.
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
       AND a.asset_id <> $5
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
    THUMB_ASSET_ID,
  ]);
  const row = res.rows[0];
  const total = Number(row?.total_bytes ?? 0);

  const count = kind === "generation" ? Number(row?.gen_count ?? 0) : Number(row?.kind_count ?? 0);
  const max = kind === "generation" ? UPLOAD_QUOTA.perGeneration : UPLOAD_QUOTA.count[kind];
  if (count + ids.length > max) {
    throw new ApiError(quotaMessage(kind, "count"), 413, { code: "quota", kind, limit: max });
  }
  if (total + incoming.bytes > UPLOAD_QUOTA.totalBytes) {
    throw new ApiError(quotaMessage(kind, "bytes"), 413, { code: "quota", kind, limitBytes: UPLOAD_QUOTA.totalBytes });
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

/** Tayyor hujjatga yoziladigan foydalanuvchi rasmi (hali bazada emas). */
export type PendingUpload = { assetId: string; mime: string; bytes: Buffer };

/** Baytdan `PendingUpload` — `asset_id` baytning xeshi (bir xil bayt, bitta qator). */
export function pendingUpload(mime: string, bytes: Buffer): PendingUpload {
  return { assetId: uploadAssetId(bytes), mime, bytes };
}

/**
 * Tayyor hujjatga foydalanuvchi rasmlarini CHAQIRUVCHINING tranzaksiyasida
 * yozadi — kvota qulfi, egalik va chegara shu `client` da (SECB-03).
 *
 * Nega chaqiruvchining tranzaksiyasi: ko'ruvchidan yuklash rasmni HUJJATGA
 * ishora bilan birga yozadi (`commitDocOps`). Ilgari rasm alohida
 * tranzaksiyada oldin yozilardi — versiya to'qnashuvi (409), maket xatosi
 * (422) yoki juftlikning ikkinchisi kvotaga sig'masa (413) hech kim ishora
 * qilmaydigan «yetim» aktiv qolib, hujjat umri davomida `perGeneration`
 * kvotasini yerdi. Endi hujjat yozilmasa — rasm ham yo'q (ROLLBACK).
 */
export async function storeGenerationUploads(
  client: PoolClient,
  generationId: string,
  userId: string,
  uploads: PendingUpload[],
): Promise<void> {
  if (!uploads.length) return;
  await client.query("SELECT pg_advisory_xact_lock(hashtext('upload-quota'), hashtext($1))", [String(userId)]);
  const unique = [...new Map(uploads.map((u) => [u.assetId, u])).values()];
  const bytes = unique.reduce((n, u) => n + u.bytes.byteLength, 0);
  await check(client, userId, "generation", { assetIds: unique.map((u) => u.assetId), bytes, generationId });
  for (const u of unique) {
    await client.query(
      `INSERT INTO generation_assets (generation_id, asset_id, mime, size_bytes, bytes, expires_at)
       VALUES ($1, $2, $3, $4, $5, NULL)
       ON CONFLICT (generation_id, asset_id) DO NOTHING`,
      [generationId, u.assetId, u.mime, u.bytes.byteLength, u.bytes],
    );
  }
}

/**
 * Tayyor hujjatga bitta foydalanuvchi rasmini O'Z tranzaksiyasida yozadi —
 * kvota va egalik bilan. Ko'ruvchi yuklamalari buni EMAS, hujjat bilan
 * birga yozadigan `commitDocOps(..., { uploads })` ni ishlatadi.
 */
export async function putGenerationUpload(
  generationId: string,
  userId: string,
  mime: string,
  bytes: Buffer,
): Promise<string> {
  const upload = pendingUpload(mime, bytes);
  await transaction((client) => storeGenerationUploads(client, generationId, userId, [upload]));
  return upload.assetId;
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
