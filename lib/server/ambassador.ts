import type { PoolClient } from "pg";
import { queryOne } from "./db";
import { topUpInTx } from "./credits";
import { log } from "./log";
import { getSettingInTx } from "./settings";
import { AMBASSADOR_KEY, ambassadorNote, ambassadorPoints, ambassadorRef } from "../ambassador";
import { formatPoints } from "../referral";
import type { Lang } from "./bot/i18n";

/**
 * Ambassador bonus — server side (owner decision D4; pure rules in `lib/ambassador.ts`).
 * Called by `settleOrderInTx` right after the payer's top-up was credited.
 *
 * Failure isolation: the whole step runs inside a SAVEPOINT and EVERY error rolls back only that
 * savepoint (logged) — the payer's top-up, payment bonus and `paid` state are kept. This differs
 * on purpose from the payment bonus (which lets non-duplicate errors abort the settlement): the
 * payer paid real money, a side bonus for a third party must never undo it.
 *
 * Once per order: ledger reference `ambassador:<orderId>` (`transactions_ref_idx`), checked by
 * `topUpInTx` under the referrer's row lock; the order lock + `paid` state already make a replay
 * `already_paid`.
 *
 * Lock order: the payer's row is locked first (their own top-up), then the referrer's. The
 * referral graph is a forest ordered by account age (a referee is created AFTER its referrer, and
 * `referrals_not_self` forbids self-links), so every transaction locks "newer account -> older
 * ancestor"; two settlements can never wait on each other in a cycle (A->B and B->A cannot both
 * exist). The referrer is locked once here, with no further user lock taken after it.
 *
 * Never reversed: the external-refund clawback debits only the order's own `topup` credit.
 */
export type AmbassadorPaid = { referrerId: string; points: number; percent: number };

export async function payAmbassadorInTx(
  client: PoolClient,
  o: { id: string; userId: string; purpose: string; amountSoum: number },
): Promise<AmbassadorPaid | null> {
  if (o.purpose !== "topup") return null;
  let savepoint = false;
  // What a manual replay needs if the step fails (the order is `paid` by then, so a re-delivered callback never retries it).
  const ctx: { orderId: string; payerId: string; amountSoum: number; percent?: number; points?: number; referrerId?: string | null } =
    { orderId: o.id, payerId: o.userId, amountSoum: o.amountSoum };
  try {
    await client.query("SAVEPOINT ambassador");
    savepoint = true;
    const percent = await getSettingInTx(client, AMBASSADOR_KEY);
    const points = ambassadorPoints(o.amountSoum, percent);
    ctx.percent = percent;
    ctx.points = points;
    if (points < 1) {
      await client.query("RELEASE SAVEPOINT ambassador");
      return null;
    }
    const ref = await client.query<{ referrer: string | null }>(
      "SELECT referrer_user_id::text AS referrer FROM referrals WHERE referee_user_id = $1",
      [o.userId],
    );
    const referrerId = ref.rows[0]?.referrer ?? null;
    ctx.referrerId = referrerId;
    if (!referrerId || referrerId === o.userId) {
      await client.query("RELEASE SAVEPOINT ambassador");
      return null;
    }
    const locked = await client.query<{ is_blocked: boolean }>("SELECT is_blocked FROM users WHERE id = $1 FOR UPDATE", [referrerId]);
    if (!locked.rows[0] || locked.rows[0].is_blocked) {
      await client.query("RELEASE SAVEPOINT ambassador");
      return null;
    }
    const paid = await topUpInTx(client, referrerId, { points }, ambassadorRef(o.id), "bonus", ambassadorNote(percent));
    await client.query("RELEASE SAVEPOINT ambassador");
    return paid ? { referrerId, points, percent } : null;
  } catch (e) {
    if (savepoint) {
      try {
        await client.query("ROLLBACK TO SAVEPOINT ambassador");
      } catch (e2) {
        // The transaction itself is gone (connection error): the caller's next statement fails and rolls everything back.
        log("error", "[ambassador] savepoint rollback failed", { orderId: o.id, error: e2 instanceof Error ? e2.message : String(e2) });
        throw e2;
      }
    }
    const code = (e as { code?: unknown } | null)?.code;
    log("error", "[ambassador] bonus skipped, settlement kept", {
      ...ctx,
      sqlstate: typeof code === "string" ? code : undefined,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/** Best-effort DM to the referrer, AFTER the settlement committed. Never throws. */
export async function notifyAmbassador(p: AmbassadorPaid | null | undefined): Promise<void> {
  if (!p) return;
  try {
    const u = await queryOne<{ telegram_id: string | null; language: string | null }>(
      "SELECT telegram_id::text AS telegram_id, language FROM users WHERE id = $1 AND is_blocked = false",
      [p.referrerId],
    );
    if (!u?.telegram_id) return;
    // Lazy: keeps the bot / Telegram layer out of the payment webhooks' static import graph.
    const [{ sendUserDm }, { t }, { esc }] = await Promise.all([import("./bot-dm"), import("./bot/i18n"), import("./bot/ui")]);
    await sendUserDm({ userId: p.referrerId, telegramId: u.telegram_id, language: u.language }, (lang: Lang) => ({
      text: esc(t(lang, "ambassador.dm", { n: formatPoints(p.points) })),
    }));
  } catch (e) {
    log("warn", "[ambassador] DM failed", { referrerId: p.referrerId, error: e instanceof Error ? e.message : String(e) });
  }
}
