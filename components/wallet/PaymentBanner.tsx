"use client";

import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import type { PaymentReturn } from "./usePaymentReturn";

/**
 * The banner after the return from Click/Payme (`usePaymentReturn`):
 * paid → «qabul qilindi», cancelled → «bekor qilindi», no answer after the
 * polling budget → an explanation + «Tekshirish», otherwise «tasdiqlanmoqda».
 * Nothing without `?order=` (or before the first order list arrives).
 */
export function PaymentBanner({ pay, className }: { pay: PaymentReturn; className?: string }) {
  const { orderId, orders, orderState, check, recheck } = pay;
  const box = "flex gap-3 rounded-2xl border px-4 py-3 text-[15px] leading-snug";

  if (orderState === "paid") {
    return (
      <div
        data-pay-banner="paid"
        role="status"
        className={cn(box, "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300", className)}
      >
        <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <p>To&apos;lov qabul qilindi — hisobingiz yangilandi.</p>
      </div>
    );
  }
  if (orderState === "cancelled") {
    return (
      <div data-pay-banner="cancelled" role="status" className={cn(box, "border-destructive/30 bg-destructive/10 text-destructive", className)}>
        <XCircle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <p>To&apos;lov bekor qilindi — hisob o&apos;zgarmadi. Xohlasangiz, qaytadan to&apos;lashingiz mumkin.</p>
      </div>
    );
  }
  if (!orderId || !orders) return null;
  if (check === "stalled") {
    return (
      <div
        data-pay-banner="stalled"
        role="status"
        className={cn(box, "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200", className)}
      >
        <Clock className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <p>
            To&apos;lov tasdig&apos;i hali kelmadi. To&apos;lov tizimi xabarni kechiktirishi mumkin: pul yechilgan bo&apos;lsa, u
            hisobingizga o&apos;zi tushadi — qayta to&apos;lamang. 10 daqiqadan keyin ham tushmasa, to&apos;lov chekini saqlab,
            administratorga murojaat qiling.
          </p>
          <button
            type="button"
            onClick={recheck}
            className="focus-visible:ring-ring mt-2 h-11 rounded-full border border-amber-600/40 px-5 text-[15px] font-medium hover:bg-amber-500/15 focus-visible:ring-2 focus-visible:outline-none"
          >
            Tekshirish
          </button>
        </div>
      </div>
    );
  }
  return (
    <div
      data-pay-banner="pending"
      role="status"
      className={cn(box, "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200", className)}
    >
      <Clock className="mt-0.5 size-5 shrink-0 motion-safe:animate-pulse" aria-hidden="true" />
      <p>To&apos;lov tasdiqlanmoqda... Odatda bir necha soniya, ba&apos;zan 1–2 daqiqa oladi.</p>
    </div>
  );
}
