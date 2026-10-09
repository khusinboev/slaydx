import { groupDigits } from "./format";

/**
 * Wallet top-up limits (so'm). ONE source for the server (`createOrder`, the
 * Payme/Click amount checks) and the wallet dialog's inline validation, so the
 * form and the API can never disagree. Owner decision 2026-10-09: free amount,
 * 1 000 - 10 000 000.
 */
export const MIN_TOPUP_SOUM = 1_000;
export const MAX_TOPUP_SOUM = 10_000_000;

/** The Uzbek range sentence shown by both the API (400) and the dialog. */
export function topupRangeMessage(): string {
  return `Summa ${groupDigits(MIN_TOPUP_SOUM)} — ${groupDigits(MAX_TOPUP_SOUM)} so'm oralig'ida bo'lishi kerak`;
}

/** `null` when `amount` is a valid whole-so'm top-up, else the Uzbek reason. */
export function topupAmountError(amount: number): string | null {
  if (!Number.isFinite(amount) || amount <= 0) return "Summani kiriting";
  if (amount < MIN_TOPUP_SOUM) return `Eng kam summa — ${groupDigits(MIN_TOPUP_SOUM)} so'm`;
  if (amount > MAX_TOPUP_SOUM) return `Eng ko'p summa — ${groupDigits(MAX_TOPUP_SOUM)} so'm`;
  return null;
}
