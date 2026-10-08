import type { PoolClient } from "pg";
import { queryOne } from "./db";
import { topUpInTx } from "./credits";
import { log } from "./log";
import { FIRST_TOPUP_NOTE, firstTopupBonus, firstTopupRef } from "../topup-bonus";

/**
 * First top-up bonus — server side (docs/bonus/PLAN.md «Bonus 2», B2-Q1; rules in `lib/topup-bonus.ts`).
 *
 * «First» is decided on the user's PAID TOP-UP ORDERS, not on the amount:
 *   a counted paid top-up = a `payment_orders` row of the user with `purpose = 'topup'` and
 *   `state = 'paid'` that is not fully refunded (`SUM(payment_refunds.amount_soum) < amount_soum`).
 *   Not counted: created/pending/cancelled orders, legacy `pro` orders, admin manual credits
 *   (`admin_credit` ledger rows, `scripts/topup.mts` `bonus` rows), generation refunds (`refund`).
 * The order being settled is the first one iff no OTHER counted paid top-up exists. The bonus is
 * then `firstTopupBonus(amount)` — 0 below 50 000 so'm, so a first top-up under the minimum uses up
 * the chance: the next top-ups are no longer first and never earn it (owner rule «birinchi
 * to'ldirish … 50 000 dan»; the lead confirms the reading with the owner).
 * Once per user: the ledger row has the unique reference `first-topup:<userId>`.
 * A later refund does NOT claw the bonus back (the external-refund clawback debits the order's
 * own `topup` credit from `balance` only).
 */

/** Counted paid top-ups of user `$1`, except order `$2` (NULL → none excluded). */
const COUNTED_PAID_TOPUP_SQL = `
  SELECT 1
    FROM payment_orders o
   WHERE o.user_id = $1
     AND o.purpose = 'topup'
     AND o.state = 'paid'
     AND ($2::uuid IS NULL OR o.id <> $2::uuid)
     AND COALESCE((SELECT SUM(r.amount_soum) FROM payment_refunds r WHERE r.order_id = o.id), 0) < o.amount_soum
   LIMIT 1`;

/**
 * Whether the user already got the first top-up bonus (and how much). Contract for the bot's
 * «Sizning bonuslaringiz» screen; the bonus is paid inside the payment transaction (`settleOrder`).
 */
export async function firstTopupStatus(userId: string): Promise<{ paid: boolean; points: number }> {
  const row = await queryOne<{ p: string }>(
    "SELECT points_delta::text AS p FROM transactions WHERE user_id = $1 AND kind = 'bonus' AND reference = $2",
    [userId, firstTopupRef(userId)],
  );
  return row ? { paid: true, points: Number(row.p) } : { paid: false, points: 0 };
}

/**
 * Whether the user's next paid top-up can still earn the bonus: no counted paid top-up yet and no
 * bonus row. The web wallet shows the «+10%» hint by it (`GET /api/users/me` `firstTopupEligible`).
 */
export async function firstTopupEligible(userId: string): Promise<boolean> {
  const row = await queryOne<{ prior: boolean; paid: boolean }>(
    `SELECT EXISTS (${COUNTED_PAID_TOPUP_SQL}) AS prior,
            EXISTS (SELECT 1 FROM transactions WHERE kind = 'bonus' AND reference = $3) AS paid`,
    [userId, null, firstTopupRef(userId)],
  );
  return !!row && !row.prior && !row.paid;
}

/**
 * Inside the settlement transaction, BEFORE the top-up is credited: the bonus points this order
 * earns (0 when it is not the user's first paid top-up or is below the minimum).
 *
 * The user row is locked first (lock order payment_orders → users, as in `settleOrder`) so two
 * orders of one user settling at the same time decide one after the other: the second one waits
 * here, then sees the first one `paid` (READ COMMITTED: each statement takes a fresh snapshot) and
 * is not «first». Without the lock both could read «no paid top-up» before either committed.
 */
export async function firstTopupBonusDueInTx(
  client: PoolClient,
  userId: string,
  orderId: string,
  amountSoum: number,
): Promise<number> {
  await client.query("SELECT 1 FROM users WHERE id = $1 FOR UPDATE", [userId]);
  const prior = await client.query(COUNTED_PAID_TOPUP_SQL, [userId, orderId]);
  if (prior.rows[0]) return 0;
  return firstTopupBonus(amountSoum);
}

/** 23505 on `transactions_ref_idx`: the bonus row was committed by another path meanwhile. */
function isDuplicateRef(e: unknown): boolean {
  const err = e as { code?: unknown; constraint?: unknown } | null;
  return Boolean(err) && err!.code === "23505" && err!.constraint === "transactions_ref_idx";
}

/**
 * Credits the first top-up bonus as POINTS (`kind = 'bonus'`, reference `first-topup:<userId>`)
 * inside the settlement transaction. Idempotent: an existing row → `false`, nothing written.
 *
 * A savepoint wraps the write so a unique-index race (another writer committed the same reference
 * between our check and our INSERT) rolls back ONLY the bonus — the top-up and the `paid` state in
 * the same transaction are kept. Any other error propagates and rolls the whole settlement back
 * (the provider retries), so money is never half-written.
 */
export async function payFirstTopupBonusInTx(client: PoolClient, userId: string, points: number): Promise<boolean> {
  if (!(points > 0)) return false;
  await client.query("SAVEPOINT first_topup_bonus");
  try {
    const paid = await topUpInTx(client, userId, { points }, firstTopupRef(userId), "bonus", FIRST_TOPUP_NOTE);
    await client.query("RELEASE SAVEPOINT first_topup_bonus");
    return paid;
  } catch (e) {
    if (!isDuplicateRef(e)) throw e;
    await client.query("ROLLBACK TO SAVEPOINT first_topup_bonus");
    log("info", "[topup-bonus] first top-up bonus already written (race)", { userId, points });
    return false;
  }
}
