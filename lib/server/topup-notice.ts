import { queryOne } from "./db";
import { log } from "./log";
import { formatPoints } from "../referral";
import type { Lang } from "./bot/i18n";

/**
 * «Balansingiz to'ldirildi» — the payer's bot message after a credited top-up (Click, Payme, Paynet).
 *
 * `settleOrderInTx` returns a `TopupPaid` ONLY when that very call wrote the top-up credit of a `topup` order (a replay /
 * `already_paid`, a cancelled or expired order and a stray ledger duplicate give null), so the message goes out exactly
 * once per credited order. The callers fire it AFTER COMMIT with `void` — the provider's webhook answer never waits for
 * Telegram — and it never throws: a failed or skipped message costs nothing but a log line.
 *
 * Same shape as `notifyAmbassador` (the referrer's DM); the bot / Telegram layer is imported lazily so the payment
 * webhooks' static import graph stays free of it.
 */
export type TopupPaid = {
  userId: string;
  orderId: string;
  /** The money paid (so'm == balance points credited). */
  amountSoum: number;
  /** The payment bonus paid with this top-up (bonus so'm), 0 when none. */
  bonusPoints: number;
};

/** Messages still in flight in this process: tests (and a graceful shutdown) can wait for them. */
const inflight = new Set<Promise<void>>();

/** Resolves when every top-up message started so far has finished (sent, skipped or failed). Never rejects. */
export async function flushTopupNotices(): Promise<void> {
  await Promise.allSettled([...inflight]);
}

/** Best-effort DM to the payer, AFTER the settlement committed. Never throws (the returned promise always resolves). */
export function notifyTopup(p: TopupPaid | null | undefined): Promise<void> {
  if (!p) return Promise.resolve();
  const run: Promise<void> = sendTopupDm(p).finally(() => {
    inflight.delete(run);
  });
  inflight.add(run);
  return run;
}

async function sendTopupDm(p: TopupPaid): Promise<void> {
  try {
    // Read AFTER the commit: the balance shown is the one the wallet shows now (points + quota + balance).
    const u = await queryOne<{ telegram_id: string | null; language: string | null; points: string; quota: string; balance: string }>(
      `SELECT telegram_id::text AS telegram_id, language, points, quota, balance
         FROM users
        WHERE id = $1 AND NOT is_blocked AND bot_blocked_at IS NULL`,
      [p.userId],
    );
    if (!u?.telegram_id) return;
    const total = (Number(u.points) || 0) + (Number(u.quota) || 0) + (Number(u.balance) || 0);
    // Lazy: keeps the bot / Telegram layer out of the payment webhooks' static import graph.
    const [{ sendUserDm }, { t }] = await Promise.all([import("./bot-dm"), import("./bot/i18n")]);
    await sendUserDm({ userId: p.userId, telegramId: u.telegram_id, language: u.language }, (lang: Lang) => {
      const lines = [t(lang, "topup.dm", { n: formatPoints(p.amountSoum) })];
      if (p.bonusPoints > 0) lines.push(t(lang, "topup.dmBonus", { n: formatPoints(p.bonusPoints) }));
      lines.push(t(lang, "topup.dmBalance", { n: formatPoints(total) }));
      return { text: lines.join("\n") };
    });
  } catch (e) {
    log("warn", "[topup] DM failed", { userId: p.userId, orderId: p.orderId, error: e instanceof Error ? e.message : String(e) });
  }
}
