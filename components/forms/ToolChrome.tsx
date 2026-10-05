"use client";

import { useRef } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { BackLink } from "@/components/nav/BackLink";
import { formatTanga } from "@/lib/tools";
import { creditTotal, useAppStore } from "@/lib/store";
import { DraftNotice } from "./DraftNotice";
import { useKeyboardInset } from "./useKeyboardInset";

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
  // Mobile P3: while typing with the keyboard open the submit bar leaves the
  // bottom edge (it stays in the flow at the end of the form, so nothing
  // shifts) and the focused field is kept in view.
  const rootRef = useRef<HTMLDivElement>(null);
  const { typing } = useKeyboardInset(rootRef);
  // On touch the link drops to its own 44 px row instead of a 20 px inline run.
  const topUp = (
    <Link
      href="/uz/purchase"
      data-topup
      className="text-primary pointer-coarse:mt-1 pointer-coarse:flex pointer-coarse:min-h-11 pointer-coarse:w-fit pointer-coarse:items-center font-medium whitespace-nowrap underline underline-offset-2"
    >
      Balansni to‘ldirish →
    </Link>
  );
  return (
    <div ref={rootRef} className="mx-auto w-full max-w-3xl px-4 py-8 pb-28">
      <nav className="mb-6 flex items-center gap-2.5">
        {/* Parent from `parentOf` (`/uz/create`); a fresh-tab deep link replaces, never leaves the site.
            Touch: a 44 px circle; the negative margins keep the 32 px row and the icon's position. */}
        <BackLink className="text-muted-foreground hover:text-foreground hover:bg-muted pointer-coarse:size-11 pointer-coarse:-my-1.5 pointer-coarse:-ml-2.5 pointer-coarse:-mr-1.5 -ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
          <ArrowLeft className="h-5 w-5" />
        </BackLink>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      </nav>

      {children}

      {/* FE-17: qoralama saqlanmadi / fayl qayta biriktirilsin — har formada. */}
      <DraftNotice />

      {extra ? (
        <button
          type="button"
          onClick={onExtra}
          className="text-muted-foreground hover:text-foreground pointer-coarse:min-h-11 mb-8 flex items-center gap-1 text-sm"
        >
          Qoʼshimcha (ixtiyoriy)
          <ChevronDown className={`size-4 transition ${extraOpen ? "rotate-180" : ""}`} />
        </button>
      ) : null}
      {extra && extraOpen ? <div className="mb-8">{extra}</div> : null}

      {/*
       * UX-03: «Balans yetarli emas» endi o'lik matn emas — yonida to'ldirish
       * sahifasiga havola. Ilgari foydalanuvchi profil → to'ldirish yo'lini
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

      {/*
       * `data-submit-bar` also drives `#main`'s scroll padding (AppShell), so
       * focus and caret reveals never stop behind the bar. The safe-area
       * padding keeps the button above the iOS home indicator.
       */}
      <div
        data-submit-bar={typing ? "inline" : "sticky"}
        className={`bg-[var(--page-bg)]/90 -mx-4 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur ${
          typing ? "static" : "sticky bottom-0"
        }`}
      >
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

/**
 * Topic suggestion chips under a form's topic field (R5 F4/F1). Desktop keeps
 * the wrapping pills. On touch they become ONE horizontally scrollable row of
 * 44 px chips: five wrapped rows of ~23 px pushed the rest of the form down
 * and invited mis-taps. The row scrolls inside itself (no page overflow);
 * a very long example is truncated in the chip and lands whole in the field.
 */
export function TopicChips({ examples, onPick }: { examples: readonly string[]; onPick: (topic: string) => void }) {
  if (examples.length === 0) return null;
  return (
    <div
      data-topic-chips
      className="pointer-coarse:flex-nowrap pointer-coarse:gap-2 pointer-coarse:overflow-x-auto pointer-coarse:overscroll-x-contain pointer-coarse:[scrollbar-width:none] mt-2 flex flex-wrap gap-1.5"
    >
      {examples.map((ex) => (
        <button
          key={ex}
          type="button"
          title={ex}
          onClick={() => onPick(ex)}
          className="text-muted-foreground hover:text-foreground hover:border-foreground/30 pointer-coarse:min-h-11 pointer-coarse:max-w-[80%] pointer-coarse:shrink-0 pointer-coarse:truncate pointer-coarse:px-3.5 pointer-coarse:text-sm rounded-full border px-2.5 py-0.5 text-left text-[11.5px]"
        >
          {ex}
        </button>
      ))}
    </div>
  );
}
