"use client";

import Link from "next/link";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { formatTanga } from "@/lib/tools";
import { creditTotal, useAppStore } from "@/lib/store";
import { DraftNotice } from "./DraftNotice";

/**
 * Serverning 402 matni (`app/api/generations/route.ts`: «Balans yetarli
 * emas. Kerak: …, mavjud: …»). Formalar faqat `e.message` ni uzatadi —
 * shu sababli matn bo'yicha taniladi; qo'shimcha ravishda store dagi
 * balans narxdan kam bo'lsa ham (quyida) havola chiqadi.
 */
const INSUFFICIENT_RE = /balans yetarli emas/i;

export function ToolChrome({
  title,
  children,
  extra,
  extraOpen,
  onExtra,
  submitLabel,
  price,
  disabled,
  loading,
  onSubmit,
  error,
}: {
  title: string;
  children: React.ReactNode;
  extra?: React.ReactNode;
  extraOpen?: boolean;
  onExtra?: () => void;
  submitLabel: string;
  /** `undefined` — narx hali ma'noga ega emas (masalan sehrgarning oraliq bosqichi). */
  price?: number;
  disabled?: boolean;
  loading?: boolean;
  onSubmit: () => void;
  error?: string | null;
}) {
  const loggedIn = useAppStore((s) => s.loggedIn);
  const user = useAppStore((s) => s.user);
  const total = creditTotal(user);
  // UX-03: narx ma'lum va balans yetmaydi — yuborishdan OLDIN aytiladi.
  const short = loggedIn && user !== null && price !== undefined && price > total;
  const balanceError = Boolean(error && (INSUFFICIENT_RE.test(error) || short));
  const topUp = (
    <Link href="/uz/purchase" data-topup className="text-primary font-medium whitespace-nowrap underline underline-offset-2">
      Balansni to‘ldirish →
    </Link>
  );
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 pb-28">
      <nav className="mb-6 flex items-center gap-2.5">
        <Link
          href="/uz/create"
          aria-label="Orqaga"
          className="text-muted-foreground hover:text-foreground hover:bg-muted -ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      </nav>

      {children}

      {/* FE-17: qoralama saqlanmadi / fayl qayta biriktirilsin — har formada. */}
      <DraftNotice />

      {extra ? (
        <button
          type="button"
          onClick={onExtra}
          className="text-muted-foreground hover:text-foreground mb-8 flex items-center gap-1 text-sm"
        >
          Qoʼshimcha (ixtiyoriy)
          <ChevronDown className={`size-4 transition ${extraOpen ? "rotate-180" : ""}`} />
        </button>
      ) : null}
      {extra && extraOpen ? <div className="mb-8">{extra}</div> : null}

      {/*
       * UX-03: «Balans yetarli emas» endi o'lik matn emas — yonida to'ldirish
       * sahifasiga havola. Ilgari foydalanuvchi profil → Tariflar yo'lini
       * o'zi topishi kerak edi.
       */}
      {error ? (
        <p role="alert" className="text-destructive mb-4 text-sm">
          {error}
          {balanceError ? <> {topUp}</> : null}
        </p>
      ) : short ? (
        <p className="text-muted-foreground mb-4 text-sm" data-balance-short>
          Balansingiz: {formatTanga(total)} — bu hujjat uchun {formatTanga(price ?? 0)} kerak. {topUp}
        </p>
      ) : null}

      <div className="bg-[var(--page-bg)]/90 sticky bottom-0 -mx-4 border-t px-4 py-3 backdrop-blur">
        <button
          type="button"
          disabled={disabled || loading}
          onClick={onSubmit}
          className="bg-primary text-primary-foreground disabled:opacity-50 flex h-12 w-full items-center justify-center gap-3 rounded-2xl text-[15px] font-medium"
        >
          <span>{loading ? "Yaratilmoqda..." : submitLabel}</span>
          {price === undefined ? null : (
            <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-sm" data-price-total>
              {formatTanga(price)}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
