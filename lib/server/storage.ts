import "server-only";
import type { PoolClient } from "pg";
import { query, queryOne } from "./db";

/**
 * Yaratilgan fayl bayti.
 *
 * Ilgari fayl faqat brauzerdagi IndexedDB da edi — boshqa qurilmadan
 * kirilsa yo'q, brauzer tozalansa yo'q. Endi bayt bazada, MUDDATSIZ
 * turadi — foydalanuvchi so'rovi bilan avtomatik muddat (edi: 72 soat)
 * olib tashlandi (`011_no_expiry.sql`). Fayl faqat foydalanuvchi o'zi
 * o'chirsa (`deleteGenerationFile`) yoki generatsiya o'chirilsa
 * (`ON DELETE CASCADE`) yo'qoladi.
 */

/** Bazaga yoziladigan eng katta fayl. Kattaroq PPTX odatda rasm sifati muammosi. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export type StoredFileMeta = {
  fileName: string;
  mime: string;
  sizeBytes: number;
};

/**
 * `client` — tahrirdan keyingi qayta render (`rebuildFile`) bitta
 * tranzaksiya ichida `markFileVersion` bilan birga yozishi uchun
 * (advisory lock ostida) ixtiyoriy `PoolClient`; berilmasa hovuzning
 * o'zi ishlatiladi (mavjud xatti-harakat o'zgarmaydi).
 */
export async function putGenerationFile(
  generationId: string,
  file: { bytes: Uint8Array; mime: string; fileName: string },
  client?: PoolClient,
): Promise<StoredFileMeta> {
  if (file.bytes.byteLength > MAX_FILE_BYTES) {
    throw new Error(
      `Fayl juda katta (${Math.round(file.bytes.byteLength / 1024 / 1024)} MB). ` +
        `Chegara — ${MAX_FILE_BYTES / 1024 / 1024} MB.`,
    );
  }
  const sql = `INSERT INTO generation_files (generation_id, file_name, mime, size_bytes, bytes, expires_at)
     VALUES ($1, $2, $3, $4, $5, NULL)
     ON CONFLICT (generation_id) DO UPDATE
        SET file_name = EXCLUDED.file_name,
            mime      = EXCLUDED.mime,
            size_bytes = EXCLUDED.size_bytes,
            bytes     = EXCLUDED.bytes,
            expires_at = NULL`;
  const params = [generationId, file.fileName, file.mime, file.bytes.byteLength, Buffer.from(file.bytes)];
  if (client) {
    await client.query(sql, params);
  } else {
    await query(sql, params);
  }
  return {
    fileName: file.fileName,
    mime: file.mime,
    sizeBytes: file.bytes.byteLength,
  };
}

/**
 * Faylni egasi tekshirilgan holda oladi.
 *
 * `user_id` shartsiz so'rov IDOR bo'lardi: id ni bilgan har kim
 * begona hujjatni yuklab olardi.
 */
export async function getGenerationFile(
  generationId: string,
  userId: string,
): Promise<{ bytes: Buffer; fileName: string; mime: string } | null> {
  const row = await queryOne<{ bytes: Buffer; file_name: string; mime: string }>(
    `SELECT f.bytes, f.file_name, f.mime
       FROM generation_files f
       JOIN generations g ON g.id = f.generation_id
      WHERE f.generation_id = $1
        AND g.user_id = $2`,
    [generationId, userId],
  );
  if (!row) return null;
  void query("UPDATE generation_files SET downloads = downloads + 1 WHERE generation_id = $1", [
    generationId,
  ]).catch(() => {});
  return { bytes: row.bytes, fileName: row.file_name, mime: row.mime };
}

export async function hasGenerationFile(generationId: string, userId: string): Promise<boolean> {
  const row = await queryOne(
    `SELECT 1
       FROM generation_files f
       JOIN generations g ON g.id = f.generation_id
      WHERE f.generation_id = $1 AND g.user_id = $2`,
    [generationId, userId],
  );
  return Boolean(row);
}

/**
 * Faylni o'chiradi — **egasi tekshirilgan holda**.
 *
 * `userId` MAJBURIY. Ilgari bu funksiya yolg'iz `generationId` ni olardi,
 * `getGenerationFile` va `hasGenerationFile` esa allaqachon egalikni
 * so'rardi — ya'ni naqsh bor edi, shu funksiya undan chetda qolgan edi.
 * Natijada `DELETE /api/generations/{id}` egalik tekshiruvidan OLDIN uni
 * chaqirar va begona `id` bilan kelgan so'rov 409 olsa ham, fayl
 * allaqachon o'chgan bo'lardi.
 *
 * `randomUUID` ni topib bo'lmasligi himoya emas, tasodif — shuning
 * uchun to'siq SQL darajasida turadi.
 */
export async function deleteGenerationFile(generationId: string, userId: string): Promise<void> {
  await query(
    `DELETE FROM generation_files f
      USING generations g
      WHERE f.generation_id = $1
        AND g.id = f.generation_id
        AND g.user_id = $2`,
    [generationId, userId],
  );
}
