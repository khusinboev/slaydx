import "server-only";
import { query, queryOne, transaction } from "./db";
import { refundInTx } from "./refund-tx";

/**
 * Yiqilgan ish pulini tiklash — xavfsizlik to'ri (AUDIT prod-readiness,
 * W2-D2 review N3, re-review RR1).
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
 * ORQAGA TEGMASLIK (orkestrator qarori, RR1): faqat SHU kod chiqqandan
 * KEYINGI xatolar — `finished_at >= 022_retention.sql qo'llangan payt`
 * (`schema_migrations.applied_at`) VA oxirgi 2 kun. Tarixiy «FAILED, pul
 * qaytmagan» ishlar avtomatik qaytarilmaydi — egasi ularni pastdagi
 * faqat-o'qish so'rovi bilan qo'lda ko'rib chiqadi. 022 qatori topilmasa —
 * hech narsa qilinmaydi (ogohlantirish yoziladi): chegarasiz ishlash
 * xavfliroq.
 *
 * `graceSec` — endigina yiqilgan ishni oddiy yo'lga qoldiradi (u o'zi
 * qaytaradi va jurnalga to'g'ri izoh yozadi).
 *
 * ---------------------------------------------------------------------------
 * EGASI UCHUN: tarixiy FAILED + charge + refund yo'q ishlar ro'yxati
 * (FAQAT O'QISH — hech narsani o'zgartirmaydi; prod'da `psql` bilan):
 *
 *   SELECT g.id, g.user_id, u.username, g.tool_id, g.created_at, g.finished_at, g.error,
 *          -t.points_delta  AS points_charged,
 *          -t.quota_delta   AS quota_charged,
 *          -t.balance_delta AS balance_charged,
 *          g.finished_at < (SELECT applied_at FROM schema_migrations
 *                            WHERE name = '022_retention.sql') AS before_022
 *     FROM generations g
 *     JOIN transactions t ON t.kind = 'charge' AND t.reference = g.id::text AND t.user_id = g.user_id
 *     JOIN users u ON u.id = g.user_id
 *    WHERE g.status = 'FAILED'
 *      AND (t.points_delta + t.quota_delta + t.balance_delta) < 0
 *      AND NOT EXISTS (SELECT 1 FROM transactions r
 *                       WHERE r.kind = 'refund' AND r.reference = g.id::text)
 *    ORDER BY g.finished_at DESC;
 *
 * Qaytarishga qaror qilinsa — `credits.ts` `refund(userId, generationId, note)`
 * orqali (jurnal bilan, idempotent), UPDATE bilan qo'lda EMAS.
 * ---------------------------------------------------------------------------
 */

export const RECONCILE_NOTE = "Xatolik — pul qaytarildi";

/** Faqat oxirgi shuncha kun ichida yiqilgan ishlar (RR1). O'zgartirilmaydi. */
const WINDOW_DAYS = 2;

export type ReconcileOptions = {
  graceSec?: number;
  limit?: number;
  /** Faqat shu foydalanuvchi (sinov izolyatsiyasi / qo'lda tekshiruv) — tanlovni faqat TORAYTIRADI. */
  userId?: string;
};

/** Qaytaradi: shu chaqiruvda puli qaytarilgan ishlar id si. */
export async function refundUnrefundedFailed(opts: ReconcileOptions = {}): Promise<string[]> {
  const graceSec = Math.max(0, Math.trunc(opts.graceSec ?? 120));
  const limit = Math.max(1, Math.trunc(opts.limit ?? 100));

  const mig = await queryOne<{ applied_at: Date }>(
    "SELECT applied_at FROM schema_migrations WHERE name = '022_retention.sql'",
  );
  if (!mig?.applied_at) {
    console.warn("[reconcile] 022_retention.sql qo'llanmagan — pulni tiklash o'tkazib yuborildi");
    return [];
  }

  const candidates = await query<{ id: string }>(
    `SELECT g.id
       FROM generations g
      WHERE g.status = 'FAILED' AND g.finished_at < now() - $1::int * interval '1 second'
        AND g.finished_at > now() - make_interval(days => $2::int)
        AND g.finished_at >= $5::timestamptz
        AND EXISTS (SELECT 1 FROM transactions t
                     WHERE t.kind = 'charge' AND t.reference = g.id::text AND t.user_id = g.user_id)
        AND NOT EXISTS (SELECT 1 FROM transactions t
                         WHERE t.kind = 'refund' AND t.reference = g.id::text)
        AND ($4::bigint IS NULL OR g.user_id = $4::bigint)
      ORDER BY g.finished_at
      LIMIT $3`,
    [graceSec, WINDOW_DAYS, limit, opts.userId ?? null, mig.applied_at],
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
