import "server-only";
import { query, queryOne } from "./db";
import { env } from "./env";

/**
 * Yaratilgan fayl bayti.
 *
 * Ilgari fayl faqat brauzerdagi IndexedDB da edi — boshqa qurilmadan
 * kirilsa yo'q, brauzer tozalansa yo'q. Endi bayt bazada turadi va
 * `expires_at` bo'yicha avtomatik o'chadi (REJA.md, 5-bosqich TTL).
 */

/** Bazaga yoziladigan eng katta fayl. Kattaroq PPTX odatda rasm sifati muammosi. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export type StoredFileMeta = {
  fileName: string;
  mime: string;
  sizeBytes: number;
  expiresAt: string;
};

export async function putGenerationFile(
  generationId: string,
  file: { bytes: Uint8Array; mime: string; fileName: string },
): Promise<StoredFileMeta> {
  if (file.bytes.byteLength > MAX_FILE_BYTES) {
    throw new Error(
      `Fayl juda katta (${Math.round(file.bytes.byteLength / 1024 / 1024)} MB). ` +
        `Chegara — ${MAX_FILE_BYTES / 1024 / 1024} MB.`,
    );
  }
  const expiresAt = new Date(Date.now() + env.fileTtlHours * 3_600_000);
  await query(
    `INSERT INTO generation_files (generation_id, file_name, mime, size_bytes, bytes, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (generation_id) DO UPDATE
        SET file_name = EXCLUDED.file_name,
            mime      = EXCLUDED.mime,
            size_bytes = EXCLUDED.size_bytes,
            bytes     = EXCLUDED.bytes,
            expires_at = EXCLUDED.expires_at`,
    [generationId, file.fileName, file.mime, file.bytes.byteLength, Buffer.from(file.bytes), expiresAt],
  );
  return {
    fileName: file.fileName,
    mime: file.mime,
    sizeBytes: file.bytes.byteLength,
    expiresAt: expiresAt.toISOString(),
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
        AND g.user_id = $2
        AND f.expires_at > now()`,
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
      WHERE f.generation_id = $1 AND g.user_id = $2 AND f.expires_at > now()`,
    [generationId, userId],
  );
  return Boolean(row);
}

export async function deleteGenerationFile(generationId: string): Promise<void> {
  await query("DELETE FROM generation_files WHERE generation_id = $1", [generationId]);
}

/** Muddati o'tgan fayllarni o'chiradi. Cron chaqiradi. */
export async function purgeExpiredFiles(): Promise<number> {
  const rows = await query<{ count: string }>(
    `WITH gone AS (DELETE FROM generation_files WHERE expires_at < now() RETURNING 1)
     SELECT count(*)::text AS count FROM gone`,
  );
  return Number(rows[0]?.count ?? 0);
}
