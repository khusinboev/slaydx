/**
 * First top-up bonus (owner decision 2026-10-08, docs/bonus/PLAN.md «Bonus 2»):
 * the user's FIRST paid top-up of at least 50 000 so'm earns 10 % of it as bonus
 * points, at most 20 000, once per user. Pure rules — the server applies them in
 * the payment transaction (`lib/server/topup-bonus.ts`), the bot and the web show them.
 */
export const FIRST_TOPUP_MIN_SOUM = 50_000;
export const FIRST_TOPUP_PERCENT = 10;
export const FIRST_TOPUP_MAX_POINTS = 20_000;

/** Bonus points for a first top-up of `amountSoum` (0 below the minimum). */
export function firstTopupBonus(amountSoum: number): number {
  if (!Number.isFinite(amountSoum) || amountSoum < FIRST_TOPUP_MIN_SOUM) return 0;
  return Math.min(FIRST_TOPUP_MAX_POINTS, Math.floor((amountSoum * FIRST_TOPUP_PERCENT) / 100));
}

/** Ledger reference of the first top-up bonus (unique per user → paid at most once). */
export function firstTopupRef(userId: string): string {
  return `first-topup:${userId}`;
}
