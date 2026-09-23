import "server-only";
import { query, transaction } from "./db";
import { refundInTx } from "./refund-tx";

/**
 * Yiqilgan ish pulini tiklash — xavfsizlik to'ri (AUDIT prod-readiness,
 * W2-D2 review N3).
 *
 * Har FAILED yo'li to'liq qaytarishni nazarda tutadi (`failAndCleanup`,
 * «Noma'lum vosita», `reclaimStaleJobs` → `housekeeping`, `queue-ttl`).
 * Lekin `reclaimStaleJobs` ishni FAILED qilib COMMIT qiladi va pul KEYIN
 * alohida tranzaksiyada qaytadi; `failAndCleanup` ham shunday. Ikkinchi
 * qadam yiqilsa (ulanish uzilishi, process o'limi) ish abadiy «FAILED,
 * pul qaytmagan» bo'lib qolardi — hech kim qayta urinmasdi.
 *
 * Bu funksiya FAILED + `charge` bor + `refund` yo'q ishlarga pulni qaytaradi.
 * AYNAN BIR MARTA:
 *   - har ish o'z tranzaksiyasida, generatsiya qatori `FOR UPDATE` bilan
 *     qulflanadi va holat qayta tekshiriladi;
 *   - `refundInTx` refund qatorini tekshiradi, UNIQUE (kind, reference)
 *     esa ikkinchi to'siq — oddiy yo'l bilan poyga bo'lsa ham ikkinchisi
 *     rollback bo'ladi.
 *
 * `graceSec` — endigina yiqilgan ishni oddiy yo'lga qoldiradi (u o'zi
 * qaytaradi va jurnalga to'g'ri izoh yozadi). `windowDays` — skaner
 * `generations_failed_idx` bo'yicha faqat yaqin oynani ko'radi, butun
 * tarixni har daqiqada emas.
 */

export const RECONCILE_NOTE = "Xatolik — pul qaytarildi";

export type ReconcileOptions = {
  graceSec?: number;
  windowDays?: number;
  limit?: number;
};

/** Qaytaradi: shu chaqiruvda puli qaytarilgan ishlar id si. */
export async function refundUnrefundedFailed(opts: ReconcileOptions = {}): Promise<string[]> {
  const graceSec = Math.max(0, Math.trunc(opts.graceSec ?? 120));
  const windowDays = Math.max(1, Math.trunc(opts.windowDays ?? 7));
  const limit = Math.max(1, Math.trunc(opts.limit ?? 100));

  const candidates = await query<{ id: string }>(
    `SELECT g.id
       FROM generations g
      WHERE g.status = 'FAILED' AND g.finished_at < now() - $1::int * interval '1 second'
        AND g.finished_at > now() - make_interval(days => $2::int)
        AND EXISTS (SELECT 1 FROM transactions t
                     WHERE t.kind = 'charge' AND t.reference = g.id::text AND t.user_id = g.user_id)
        AND NOT EXISTS (SELECT 1 FROM transactions t
                         WHERE t.kind = 'refund' AND t.reference = g.id::text)
      ORDER BY g.finished_at
      LIMIT $3`,
    [graceSec, windowDays, limit],
  );

  const refunded: string[] = [];
  for (const { id } of candidates) {
    try {
      const done = await transaction(async (client) => {
        const row = await client.query<{ user_id: string }>(
          "SELECT user_id FROM generations WHERE id = $1 AND status = 'FAILED' FOR UPDATE",
          [id],
        );
        if (!row.rows[0]) return false;
        const ok = await refundInTx(client, String(row.rows[0].user_id), id, RECONCILE_NOTE);
        if (!ok) return false; // Boshqa yo'l allaqachon qaytargan.
        // FAILED ishda fayl/aktiv qolmasin (C03) — oddiy yo'lning tozalashi ham yiqilgan bo'lishi mumkin.
        await client.query("DELETE FROM generation_files WHERE generation_id = $1", [id]);
        await client.query("DELETE FROM generation_assets WHERE generation_id = $1", [id]);
        return true;
      });
      if (done) refunded.push(id);
    } catch (e) {
      console.error(`[reconcile] ${id}:`, e instanceof Error ? e.message : e);
    }
  }
  if (refunded.length) console.warn(`[reconcile] ${refunded.length} ta yiqilgan ishga pul qaytarildi (tiklash)`);
  return refunded;
}
