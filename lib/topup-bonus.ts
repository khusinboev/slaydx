/**
 * First top-up bonus of Bonus 2 (docs/bonus/PLAN.md, 2026-10-08) — HISTORY ONLY.
 *
 * Replaced by the payment bonus (C-Q4, `lib/payment-bonus.ts`): new payments no longer earn it.
 * The rows it already wrote stay in the ledger and still read correctly: reference
 * `first-topup:<userId>`, note «Birinchi to‘ldirish bonusi (10%)».
 */

/** Ledger reference of a first top-up bonus row (one per user). */
export function firstTopupRef(userId: string): string {
  return `first-topup:${userId}`;
}

/**
 * Prefix of the first top-up bonus note (`transactions.note`). The web wallet
 * (`components/wallet/wallet-model.ts`) and the bot title such a row «Birinchi to‘ldirish bonusi».
 */
export const FIRST_TOPUP_NOTE_PREFIX = "Birinchi to‘ldirish bonusi";
