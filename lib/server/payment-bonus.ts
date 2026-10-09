import type { PoolClient } from "pg";
import { ApiError } from "./api";
import { queryOne } from "./db";
import { topUpInTx } from "./credits";
import { log } from "./log";
import { can } from "./admin-rbac";
import type { AuditActor } from "./admin-audit";
import { getSetting, getSettingInTx } from "./settings";
import { PAYMENT_BONUS_KEY, paymentBonusNote, paymentBonusPoints, paymentBonusRef } from "../payment-bonus";
import { firstTopupRef } from "../topup-bonus";

/**
 * Payment bonus — server side (C-Q4, docs/bonus/BONUS3.md; pure rules in `lib/payment-bonus.ts`).
 * One service for the web (admin settings page, wallet, `GET /api/users/me`) and the bot (bonuses
 * message, wallet card, admin panel «💳 To‘lov bonusi») — CLAUDE.md «Bot va web — bitta servis qatlami».
 *
 * Which percent applies: the one in force when the order SETTLES (the provider's Perform /
 * Complete reaches `settleOrder`), read from `app_settings` inside the settlement transaction —
 * not the 15 s settings cache and not the value at order creation. A change therefore applies to
 * every settlement that starts after the change committed, and never to an order already paid.
 *
 * Once per order: the ledger row has the unique reference `payment-bonus:<orderId>`
 * (`transactions_ref_idx` on (kind, reference)); the order row lock and the `paid` state in
 * `settleOrder` already make a replay `already_paid`, the reference is the second guard.
 * A later refund does NOT claw the bonus back (the external-refund clawback debits the order's
 * own `topup` credit from `balance` only) — the same rule as the first top-up bonus had.
 */

/** Effective percent for display (wallet hint, bot task): cached up to 15 s per process. */
export async function getPaymentBonusPercent(): Promise<number> {
  return getSetting(PAYMENT_BONUS_KEY);
}

/** 23505 on `transactions_ref_idx`: the bonus row was committed by another path meanwhile. */
function isDuplicateRef(e: unknown): boolean {
  const err = e as { code?: unknown; constraint?: unknown } | null;
  return Boolean(err) && err!.code === "23505" && err!.constraint === "transactions_ref_idx";
}

/**
 * Inside the settlement transaction, AFTER the order's top-up was credited: credits
 * floor(amount × percent / 100) bonus POINTS (`kind = 'bonus'`, reference
 * `payment-bonus:<orderId>`, note «To‘lov bonusi (N%)»). Returns what was paid (0 when the percent
 * is 0, the amount earns nothing, or the row already exists).
 *
 * A savepoint wraps the write so a unique-index race (another writer committed the same reference
 * between the check and the INSERT) rolls back ONLY the bonus — the top-up and the `paid` state in
 * the same transaction are kept. Any other error propagates and rolls the whole settlement back
 * (the provider retries), so money is never half-written.
 */
export async function payPaymentBonusInTx(
  client: PoolClient,
  p: { userId: string; orderId: string; amountSoum: number },
): Promise<{ points: number; percent: number }> {
  const percent = await getSettingInTx(client, PAYMENT_BONUS_KEY);
  const points = paymentBonusPoints(p.amountSoum, percent);
  if (points <= 0) return { points: 0, percent };
  await client.query("SAVEPOINT payment_bonus");
  try {
    const paid = await topUpInTx(client, p.userId, { points }, paymentBonusRef(p.orderId), "bonus", paymentBonusNote(percent));
    await client.query("RELEASE SAVEPOINT payment_bonus");
    return { points: paid ? points : 0, percent };
  } catch (e) {
    if (!isDuplicateRef(e)) throw e;
    await client.query("ROLLBACK TO SAVEPOINT payment_bonus");
    log("info", "[payment-bonus] bonus already written (race)", { orderId: p.orderId, points });
    return { points: 0, percent };
  }
}

/**
 * Sets the percent (0–50) — the ONE write path of the web admin settings page and the bot admin
 * panel. Permission `settings.edit` is checked HERE too (the routes / bot check it first and write
 * `auth.denied`); the value is validated by the settings catalog (400), the reason by
 * `parseReason` (400); the row and its `settings.update` audit row are written in one transaction.
 */
export async function setPaymentBonusPercent(
  actor: AuditActor & { id: string },
  value: unknown,
  reason: unknown,
  opts: { via?: "bot" } = {},
): Promise<number> {
  if (!can(actor.role ?? "", "settings.edit")) throw new ApiError("Ruxsat yo'q", 403, { code: "forbidden" });
  // Lazy: keeps the admin layer (admin-accounts → telegram → bot) out of the payment webhook's import graph.
  const { updateAdminSetting } = await import("./admin-settings");
  const item = await updateAdminSetting(actor, PAYMENT_BONUS_KEY, { value, reason }, opts);
  return item.value as number;
}

/**
 * The user's bonus earned from payments so far: every `payment-bonus:*` row plus the legacy
 * `first-topup:<user>` row (Bonus 2, history). For the bot's «Sizning bonuslaringiz» summary.
 */
export async function paymentBonusEarned(userId: string): Promise<number> {
  const row = await queryOne<{ p: string }>(
    `SELECT COALESCE(SUM(points_delta), 0)::text AS p
       FROM transactions
      WHERE user_id = $1 AND kind = 'bonus' AND (reference LIKE 'payment-bonus:%' OR reference = $2)`,
    [userId, firstTopupRef(userId)],
  );
  return Math.max(0, Number(row?.p ?? 0));
}
