import { ApiError } from "@/lib/admin-api/core";
import { fmtNumber } from "@/lib/admin-format";
import type { ChargeSplit, WalletId } from "@/lib/admin-api/money";

/** Uzbek names of the three wallets. */
export const WALLET_LABEL: Record<WalletId, string> = {
  points: "Bonus ball",
  quota: "Pro kvota",
  balance: "Balans",
};

/**
 * Typed-confirmation text: the grouped number with REGULAR spaces, because
 * nobody can type the NBSP `fmtNumber` renders. The server ignores the kind of
 * separator when it checks `confirm`.
 */
export function confirmText(n: number): string {
  return fmtNumber(Math.abs(n)).replace(/ /g, " ");
}

/** `inputMode=numeric` text → non-negative integer, or `null` when not a valid whole number. */
export function parseWholeNumber(raw: string): number | null {
  const s = raw.replace(/[\s  ]/g, "");
  if (!/^\d{1,15}$/.test(s)) return null;
  return Number(s);
}

/** `+1 000 tanga` style summary of a refund split; `null` → "pul qaytarilmadi". */
export function refundText(split: ChargeSplit | null): string {
  if (!split) return "pul qaytarilmadi";
  const parts = (Object.keys(WALLET_LABEL) as WalletId[])
    .filter((w) => split[w] > 0)
    .map((w) => `${fmtNumber(split[w])} ${WALLET_LABEL[w].toLowerCase()}`);
  return parts.length ? `qaytarildi: ${parts.join(", ")}` : "pul qaytarilmadi";
}

/**
 * Maps the money error codes to inline messages the admin can act on; other
 * errors are rethrown as they are (the dialog shows the server's Uzbek text).
 */
export function moneyError(e: unknown): unknown {
  if (!(e instanceof ApiError)) return e;
  const code = typeof e.data.code === "string" ? e.data.code : "";
  if (code === "insufficient") {
    const available = typeof e.data.available === "number" ? e.data.available : null;
    return new ApiError(`Mablag' yetarli emas. Mavjud: ${available === null ? "—" : fmtNumber(available)}`, e.status, e.data);
  }
  if (code === "idempotency_conflict") {
    return new ApiError("Bu Idempotency-Key boshqa so'rov uchun ishlatilgan. Dialogni yopib, qaytadan oching.", e.status, e.data);
  }
  if (code === "self") return new ApiError("O'z hamyoningizni tuzata olmaysiz.", e.status, e.data);
  if (code === "amount") {
    const remaining = typeof e.data.remaining === "number" ? e.data.remaining : null;
    return new ApiError(`Summa qolgan miqdordan oshmasligi kerak. Qolgan: ${remaining === null ? "—" : fmtNumber(remaining)} so'm`, e.status, e.data);
  }
  return e;
}

export const FIELD_CLASS =
  "border-input bg-card focus:ring-ring h-9 w-full rounded-lg border px-2.5 text-[13px] outline-none focus:ring-2 disabled:opacity-60";
export const LABEL_CLASS = "flex flex-col gap-1.5 text-[12.5px] font-semibold";
