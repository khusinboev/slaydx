/**
 * Ambassador bonus (owner decision D4, docs/program-17/PLAN.md item 11): when a REFERRED user
 * makes a paid top-up, the person who invited them earns N % of the money actually paid
 * (`payment_orders.amount_soum` — NOT counting the payer's own payment bonus) as bonus so'm.
 * N is the runtime setting `ambassador.percent` (0–50, default 10, 0 = off). Floor rounding,
 * every payment counts, no time limit, never reversed, no cash-out. Pure rules — the server
 * applies them in the settlement transaction (`lib/server/ambassador.ts`).
 */

/** `app_settings` key of the percent. */
export const AMBASSADOR_KEY = "ambassador.percent";
export const AMBASSADOR_MIN = 0;
export const AMBASSADOR_MAX = 50;
export const AMBASSADOR_DEFAULT = 10;

/** Whether `v` is an allowed percent (an integer 0–50). */
export function isAmbassadorPercent(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= AMBASSADOR_MIN && v <= AMBASSADOR_MAX;
}

/** Bonus points for a paid amount: floor(amount × percent / 100); 0 for a bad amount or a percent outside 1–50. */
export function ambassadorPoints(amountSoum: number, percent: number): number {
  if (!Number.isSafeInteger(amountSoum) || amountSoum <= 0) return 0;
  if (!isAmbassadorPercent(percent) || percent <= 0) return 0;
  return Math.floor((amountSoum * percent) / 100);
}

/** Ledger reference of an order's ambassador bonus (unique per order → paid at most once). */
export function ambassadorRef(orderId: string): string {
  return `ambassador:${orderId}`;
}

/** Ledger note prefix; the wallet and the bot title the row by it. No referee name / id in the note. */
export const AMBASSADOR_NOTE_PREFIX = "Do'st to'lovi bonusi";
export function ambassadorNote(percent: number): string {
  return `${AMBASSADOR_NOTE_PREFIX} (${percent}%)`;
}

/** Program name shown to users. */
export const AMBASSADOR_TITLE = "Elchi dasturi";

/** Short rules of the «Elchi dasturi» block (same wording on the web and, shortened, in the bot); [] while the program is off. */
export function ambassadorRules(percent: number): string[] {
  if (!isAmbassadorPercent(percent) || percent <= 0) return [];
  return [
    `Do'stingiz sizning havolangiz orqali kirib, balansini to'ldirsa — har safar to'lov summasining ${percent} % i sizga bonus so'm bo'lib tushadi.`,
    "Bonus har to'lovda, muddatsiz beriladi va hamyoningizga avtomatik qo'shiladi.",
    "Bonus so'mni pulga yechib bo'lmaydi — undan ilovadagi xizmatlar uchun foydalaning.",
  ];
}

/** The rule line of the referral card: «Do'stlaringiz har to'lovidan N % bonus so'm»; "" when the program is off. */
export function ambassadorRuleText(percent: number): string {
  return isAmbassadorPercent(percent) && percent > 0 ? `Do'stlaringiz har to'lovidan ${percent} % bonus so'm` : "";
}
