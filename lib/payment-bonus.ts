/**
 * Payment bonus (owner decision C-Q4, docs/bonus/BONUS3.md): EVERY paid top-up of ANY amount earns
 * N % of it as bonus points, no cap. N is the runtime setting `payment_bonus_percent` (0–50, default
 * 10, 0 = off) that the admin changes in the web admin panel or the bot admin panel
 * (`lib/server/payment-bonus.ts`). Pure rules — the server applies them in the payment transaction
 * (`lib/server/payments.ts settleOrder`), the bot and the web show them.
 *
 * Replaces the «first top-up only, ≥ 50 000, at most 20 000» rule of Bonus 2 for new payments;
 * the already-paid `first-topup:<user>` rows stay (`lib/topup-bonus.ts`, history only).
 */

/** `app_settings` key of the percent. */
export const PAYMENT_BONUS_KEY = "payment_bonus_percent";
export const PAYMENT_BONUS_MIN = 0;
export const PAYMENT_BONUS_MAX = 50;
export const PAYMENT_BONUS_DEFAULT = 10;

/** Whether `v` is an allowed percent (an integer 0–50). */
export function isPaymentBonusPercent(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= PAYMENT_BONUS_MIN && v <= PAYMENT_BONUS_MAX;
}

/**
 * Bonus points for a paid top-up of `amountSoum` at `percent`: floor(amount × percent / 100).
 * 0 for a non-positive / non-integer amount and for a percent outside 1–50 (never more than the
 * setting allows, whatever reaches this function).
 */
export function paymentBonusPoints(amountSoum: number, percent: number): number {
  if (!Number.isSafeInteger(amountSoum) || amountSoum <= 0) return 0;
  if (!isPaymentBonusPercent(percent) || percent <= 0) return 0;
  return Math.floor((amountSoum * percent) / 100);
}

/** Ledger reference of an order's payment bonus (unique per order → paid at most once). */
export function paymentBonusRef(orderId: string): string {
  return `payment-bonus:${orderId}`;
}

/**
 * Ledger note of a payment bonus row (`transactions.note`): «To‘lov bonusi (N%)». The web wallet
 * (`components/wallet/wallet-model.ts`) and the bot (`bot/screens.ts ledgerLabel`) title the row by
 * this prefix.
 */
export const PAYMENT_BONUS_NOTE_PREFIX = "To‘lov bonusi";
export function paymentBonusNote(percent: number): string {
  return `${PAYMENT_BONUS_NOTE_PREFIX} (${percent}%)`;
}

/** The wallet hint (web): «Har bir to‘ldirishga +N% bonus». */
export function paymentBonusHint(percent: number): string {
  return `Har bir to‘ldirishga +${percent}% bonus`;
}
