import "server-only";
import type { PoolClient } from "pg";

/**
 * To'liq qaytarishning TRANZAKSIYA ICHIDAGI varianti (`chargeInTx` ga juft).
 *
 * `credits.ts` `refund` o'z tranzaksiyasini ochadi — holat o'zgarishi
 * (masalan navbat muddati o'tgan ish → FAILED, `queue-ttl.ts`) va pul
 * qaytarish esa BITTA tranzaksiyada bo'lishi shart: aks holda ish FAILED
 * bo'lib, qaytarish yiqilsa pul yo'qolardi (yoki teskarisi).
 *
 * Qoida `credits.ts` `refundRatio` (ratio = 1) bilan AYNAN bir xil:
 *   - shu `reference` uchun `refund` qatori bo'lsa — hech narsa qilmaydi
 *     (idempotent; `transactions_ref_idx` UNIQUE (kind, reference) — ikkinchi
 *     to'siq);
 *   - `charge` qatori yo'q yoki nol bo'lsa — `false`;
 *   - aks holda aynan olingan hamyonlarga (`points`/`quota`/`balance`) qaytaradi.
 * Qaytaradi: pul haqiqatan qaytdimi.
 */
export async function refundInTx(
  client: PoolClient,
  userId: string,
  reference: string,
  note = "",
): Promise<boolean> {
  const done = await client.query("SELECT 1 FROM transactions WHERE kind = 'refund' AND reference = $1", [
    reference,
  ]);
  if (done.rows[0]) return false;

  const charged = await client.query<{ points_delta: string; quota_delta: string; balance_delta: string }>(
    "SELECT points_delta, quota_delta, balance_delta FROM transactions WHERE kind = 'charge' AND reference = $1",
    [reference],
  );
  const row = charged.rows[0];
  if (!row) return false;

  const points = -Number(row.points_delta);
  const quota = -Number(row.quota_delta);
  const balance = -Number(row.balance_delta);
  if (points + quota + balance === 0) return false;

  await client.query("SELECT 1 FROM users WHERE id = $1 FOR UPDATE", [userId]);
  await client.query(
    `UPDATE users
        SET points = points + $2, quota = quota + $3, balance = balance + $4, updated_at = now()
      WHERE id = $1`,
    [userId, points, quota, balance],
  );
  await client.query(
    `INSERT INTO transactions (user_id, kind, points_delta, quota_delta, balance_delta, reference, note)
     VALUES ($1, 'refund', $2, $3, $4, $5, $6)`,
    [userId, points, quota, balance, reference, note],
  );
  return true;
}
