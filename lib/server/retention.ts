import "server-only";
import { transaction } from "./db";
import { env } from "./env";

/**
 * Saqlash muddati (AUDIT prod-readiness C23, `audit/designs/retention.md`).
 *
 * Egasi qarori (2026-09-23): FAQAT bonus ball (`points`) bilan to'langan
 * tayyor ishning fayli, aktivlari va hujjat matni `RETENTION_BONUS_DAYS`
 * (standart 180) kundan keyin o'chiriladi. `balance` yoki Pro `quota`
 * bilan to'langanlari — muddatsiz.
 *
 * «Faqat bonus» qoidasi `spend.ts` `assertPaidDocument`dagi «pullik»
 * qoidasining TESKARISI (bir xil formula, qaytarishlar AYIRILGAN holda):
 *   - `quota + balance` bo'yicha sof sarf 0 (charge − refund) — ya'ni
 *     «pullik» EMAS;
 *   - `points` bo'yicha sof sarf < 0 — bonus haqiqatan sarflangan.
 * Charge qatori yo'q ish (bepul, admin sinovi) hech qachon tozalanmaydi:
 * xavfsiz standart — shubhali holatda fayl saqlanadi.
 *
 * `generations` qatori O'CHMAYDI (tarix ro'yxati va pul jurnali butun
 * qoladi); `files_purged_at` belgisi qayta ishlashni to'xtatadi.
 */

const BATCH_SIZE = 200;
/**
 * Bitta `housekeeping` chaqiruvida nechta partiya. Bayt o'chirish og'ir
 * (WAL), worker sikli esa shu vaqt davomida yangi ish olmaydi — qolgani
 * keyingi daqiqada davom etadi.
 */
const MAX_BATCHES = 5;

export type PurgeOptions = {
  /** Necha kundan eski (standart `env.retention.bonusDays`). */
  days?: number;
  /** Bitta tranzaksiyadagi qator soni (`LIMIT`). */
  batchSize?: number;
  /** Bitta chaqiruvdagi partiyalar chegarasi. */
  maxBatches?: number;
};

/**
 * Bitta partiya — o'z tranzaksiyasida.
 *
 * `FOR UPDATE OF g SKIP LOCKED` — ikki worker parallel tozalasa bir qatorni
 * ikkalasi olmaydi; `files_purged_at IS NULL` sharti — idempotentlik (qayta
 * chaqiruv tozalangan qatorga tegmaydi).
 *
 * `doc_prev` ham NULL: aks holda «asl holatga qaytarish» o'chirilgan
 * hujjatni qayta tiklab qo'yardi. `preview` ham NULL: undagi `url` va
 * slayd modelidagi rasmlar o'chirilgan aktivlarga ishora qiladi — tarix
 * kartochkasida singan rasm chiqardi, `lines` esa o'chirilgan matnni
 * saqlab qolardi.
 *
 * `doc_version` oshiriladi: tozalashdan OLDIN hujjatni yuklagan tahrir
 * (`updateGenerationDoc`, `doc_version = base` sharti) qator qulfini
 * kutib, keyin `doc_json`ni qaytarib yozib qo'ymasin — endi u 409 oladi.
 * `file_version` yangi `doc_version`gacha suriladi: fayl yo'li
 * (`ensureFreshFile`) yo'q `doc_json`dan qayta yasashga urinib «eski
 * format» 409 bermasin — oddiy «Fayl topilmadi» 404 chiqadi.
 *
 * Amal qilayotgan O'YIN havolasi (`game_sessions`, `expires_at` NULL yoki
 * kelajakda) bor ish tozalanmaydi: ochiq o'yin `doc_json`dan o'qiydi, ya'ni
 * tozalash o'quvchilar o'ynayotgan darsni to'xtatib qo'yardi. Havola
 * muddati (30 kun) o'tgach keyingi skanerda tozalanadi.
 */
async function purgeBatch(days: number, limit: number): Promise<number> {
  return transaction(async (client) => {
    const picked = await client.query<{ id: string }>(
      `SELECT g.id
         FROM generations g
         CROSS JOIN LATERAL (
           SELECT COALESCE(SUM(t.quota_delta + t.balance_delta), 0) AS money,
                  COALESCE(SUM(t.points_delta), 0)                  AS points
             FROM transactions t
            WHERE t.kind IN ('charge', 'refund')
              AND t.reference = g.id::text
              AND t.user_id = g.user_id
         ) m
        WHERE g.status = 'COMPLETED'
          AND g.files_purged_at IS NULL
          AND g.finished_at < now() - make_interval(days => $1::int)
          AND m.money >= 0
          AND m.points < 0
          AND NOT EXISTS (
            SELECT 1 FROM game_sessions s
             WHERE s.generation_id = g.id
               AND (s.expires_at IS NULL OR s.expires_at > now())
          )
        ORDER BY g.finished_at
        LIMIT $2
        FOR UPDATE OF g SKIP LOCKED`,
      [days, limit],
    );
    const ids = picked.rows.map((r) => r.id);
    if (ids.length === 0) return 0;

    await client.query("DELETE FROM generation_files WHERE generation_id = ANY($1::uuid[])", [ids]);
    await client.query("DELETE FROM generation_assets WHERE generation_id = ANY($1::uuid[])", [ids]);
    const done = await client.query(
      `UPDATE generations
          SET doc_json = NULL, html = NULL, doc_prev = NULL, live_json = NULL, preview = NULL,
              doc_version = doc_version + 1,
              file_version = GREATEST(file_version, doc_version + 1),
              files_purged_at = now()
        WHERE id = ANY($1::uuid[]) AND files_purged_at IS NULL`,
      [ids],
    );
    return done.rowCount ?? 0;
  });
}

/**
 * Muddati o'tgan bonus-only fayllarni tozalaydi. Qaytaradi: tozalangan
 * generatsiyalar soni. Partiya `batchSize` dan kam qaytsa — navbat bo'sh.
 */
export async function purgeBonusFiles(opts: PurgeOptions = {}): Promise<number> {
  const days = opts.days ?? env.retention.bonusDays;
  const limit = Math.max(1, Math.trunc(opts.batchSize ?? BATCH_SIZE));
  const maxBatches = Math.max(1, Math.trunc(opts.maxBatches ?? MAX_BATCHES));
  let total = 0;
  for (let i = 0; i < maxBatches; i++) {
    const n = await purgeBatch(days, limit);
    total += n;
    if (n < limit) break;
  }
  if (total > 0) console.log(`[retention] ${total} ta bonus hujjat fayli tozalandi (>${days} kun)`);
  return total;
}
