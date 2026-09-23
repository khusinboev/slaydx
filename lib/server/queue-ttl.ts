import "server-only";
import { query, transaction } from "./db";
import { env } from "./env";
import { refundInTx } from "./refund-tx";

/**
 * Navbat muddati (AUDIT prod-readiness, `audit/designs/capacity.md` §4).
 *
 * Pul navbatga qo'yishda yechiladi. Ilgari QUEUED qator HECH QACHON
 * eskirmasdi: sig'im yetmasa foydalanuvchi soatlab «Navbatda» ko'rib,
 * puli esa band bo'lib turardi. Endi `QUEUE_TTL_SEC` (standart 45 daqiqa)
 * dan uzoq kutgan ish FAILED bo'ladi va pul qaytariladi.
 *
 * Yosh `created_at` dan o'lchanadi — foydalanuvchi aynan shu paytdan beri
 * kutyapti. `reclaimStaleJobs` qayta navbatga qo'ygan ish ham shu hisobga
 * kiradi: u allaqachon bir marta yiqilgan, muddat o'tgan bo'lsa qayta
 * urinish o'rniga pul qaytadi.
 *
 * FAQAT BIR MARTA (ikki worker `housekeeping`i parallel yursa ham):
 *   - holat o'zgarishi `WHERE status = 'QUEUED'` bilan — ikkinchi
 *     tranzaksiya qator qulfini kutadi, so'ng shartni qayta tekshiradi va
 *     0 qator oladi, ya'ni pulga umuman tegmaydi;
 *   - `claimJob` bilan poyga ham shu shart bilan yopiq: worker birinchi
 *     olsa ish IN_PROGRESS, bu yerdagi UPDATE hech narsa qilmaydi;
 *   - qaytarish holat bilan BITTA tranzaksiyada (`refundInTx`) — biri
 *     yiqilsa ikkalasi ham bekor, ish QUEUED bo'lib qoladi va keyingi
 *     daqiqada qayta uriniladi.
 */

export const QUEUE_TTL_MESSAGE = "Navbat juda uzun edi — pul qaytarildi";

/** Bitta chaqiruvda nechta ish (har biri o'z tranzaksiyasida). */
const MAX_PER_RUN = 100;

export type ExpireOptions = {
  /** Soniya (standart `env.queue.ttlSec`). */
  ttlSec?: number;
  limit?: number;
};

/** Muddati o'tgan QUEUED ishlarni FAILED qiladi va pulini qaytaradi. Qaytaradi: shu chaqiruv yakunlagan ishlar id si. */
export async function expireQueuedJobs(opts: ExpireOptions = {}): Promise<string[]> {
  const ttlSec = Math.max(1, Math.trunc(opts.ttlSec ?? env.queue.ttlSec));
  const limit = Math.max(1, Math.trunc(opts.limit ?? MAX_PER_RUN));
  const candidates = await query<{ id: string }>(
    `SELECT id FROM generations
      WHERE status = 'QUEUED' AND created_at < now() - $1::int * interval '1 second'
      ORDER BY created_at
      LIMIT $2`,
    [ttlSec, limit],
  );

  const expired: string[] = [];
  for (const { id } of candidates) {
    try {
      const won = await transaction(async (client) => {
        const res = await client.query<{ user_id: string }>(
          `UPDATE generations
              SET status = 'FAILED', progress = 100, step = 'Xatolik',
                  error = $2, finished_at = now(),
                  locked_by = NULL, locked_at = NULL, live_json = NULL
            WHERE id = $1 AND status = 'QUEUED'
              AND created_at < now() - $3::int * interval '1 second'
            RETURNING user_id`,
          [id, QUEUE_TTL_MESSAGE, ttlSec],
        );
        const row = res.rows[0];
        if (!row) return false; // Boshqa housekeeper yoki worker oldinroq oldi.
        await refundInTx(client, String(row.user_id), id, QUEUE_TTL_MESSAGE);
        // Qayta navbatga tushgan ishda o'lgan urinishning fayl/aktivi qolgan
        // bo'lishi mumkin (C03) — FAILED ishda ular kerak emas.
        await client.query("DELETE FROM generation_files WHERE generation_id = $1", [id]);
        await client.query("DELETE FROM generation_assets WHERE generation_id = $1", [id]);
        return true;
      });
      if (won) expired.push(id);
    } catch (e) {
      // Bitta qator (masalan buzuq jurnal) qolganlarini to'xtatmasin; tranzaksiya
      // bekor bo'lgan — ish QUEUED qoladi va keyingi chaqiruvda qayta uriniladi.
      console.error(`[queue-ttl] ${id}:`, e instanceof Error ? e.message : e);
    }
  }
  if (expired.length) console.warn(`[queue-ttl] ${expired.length} ta ish navbatda eskirdi — pul qaytarildi`);
  return expired;
}
