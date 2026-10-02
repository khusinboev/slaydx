import type { Tone } from "@/components/admin/ui";
import type { OrderProvider, OrderPurpose, OrderState, TransactionKind } from "@/lib/admin-api/payments";

/** Uzbek labels and pill tones shared by the payments and finance screens. */

export const ORDER_STATE_LABEL: Record<OrderState, string> = {
  created: "Yaratilgan",
  pending: "Kutilmoqda",
  paid: "To'langan",
  cancelled: "Bekor qilingan",
};

export const ORDER_STATE_TONE: Record<OrderState, Tone> = {
  created: "neutral",
  pending: "warning",
  paid: "success",
  cancelled: "danger",
};

export const PROVIDER_LABEL: Record<OrderProvider, string> = { click: "Click", payme: "Payme" };

export const PURPOSE_LABEL: Record<OrderPurpose, string> = { topup: "Balansni to'ldirish", pro: "Pro obuna (eski)" };

export const KIND_LABEL: Record<TransactionKind, string> = {
  charge: "Yechish",
  refund: "Qaytarish",
  topup: "To'ldirish",
  bonus: "Bonus",
  subscription: "Pro obuna (eski)",
  admin_credit: "Admin: qo'shish",
  admin_debit: "Admin: yechish",
  quota_merge: "Kvota → balans",
};

export const KIND_TONE: Record<TransactionKind, Tone> = {
  charge: "neutral",
  refund: "info",
  topup: "success",
  bonus: "primary",
  subscription: "success",
  admin_credit: "warning",
  admin_debit: "danger",
  quota_merge: "info",
};

/** Payme cancel reasons (Merchant API); other codes are shown as numbers. */
export const CANCEL_REASON_LABEL: Readonly<Record<number, string>> = {
  1: "Qabul qiluvchilardan biri topilmadi",
  2: "Debet operatsiyasida xato",
  3: "Tranzaksiyani bajarishda xato",
  4: "Muddati tugadi",
  5: "Qaytarildi",
  10: "Noma'lum xato",
};

/** Payme sends a reason code; Click's cancel carries its own `error` code (payments/click/route.ts). */
export function cancelReasonText(code: number | null, provider: OrderProvider): string | null {
  if (code === null) return null;
  if (provider === "click") return `Click xato kodi: ${code}`;
  return CANCEL_REASON_LABEL[code] ? `${CANCEL_REASON_LABEL[code]} (${code})` : String(code);
}

/** First 8 characters of a uuid, for dense tables (the full id is in the title and the detail page). */
export function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}
