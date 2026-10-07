"use client";

import { useId, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";
import { TOOL_ICONS } from "@/components/shell/icons";
import { PAY_RETURN_PATH } from "@/components/overlays/pay-amount";
import { TOOLS, TOOL_BY_SLUG, formatTanga } from "@/lib/tools";
import type { ToolConfig } from "@/lib/types";
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

/** Submit bar bottom padding: 12 px, or the home indicator when larger (Telegram's `--tg-safe-bottom` first). */
export const SUBMIT_BAR_PB = "pb-[max(0.75rem,var(--tg-safe-bottom,env(safe-area-inset-bottom,0px)))]";

/**
 * The tool of this form: the route's slug (`/uz/<slug>`), else the one whose
 * `pageTitle` is `title` (tests and previews render without a route).
 */
function useChromeTool(title: string): ToolConfig | undefined {
  const pathname = usePathname();
  const slug = pathname?.match(/^\/uz\/([^/]+)$/)?.[1];
  const bySlug = slug ? TOOL_BY_SLUG[slug as keyof typeof TOOL_BY_SLUG] : undefined;
  return bySlug ?? TOOLS.find((t) => t.pageTitle === title);
}

/**
 * Tool form chrome (redesign W5, variant A): the page header (`PageHeader`:
 * «←» to the parent `/uz/create`, the tool's icon chip in its colour `tc`,
 * the title and the tool's one-line description), the form, and the sticky
 * submit bar — a floating rounded card with the price and the primary
 * button above the home indicator. While typing on a phone the bar drops
 * into the flow (`useKeyboardInset`, mobile P3) — unchanged.
 */
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
  const tool = useChromeTool(title);
  const Icon = tool ? TOOL_ICONS[tool.icon] : undefined;
  const priceId = useId();
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
      href={PAY_RETURN_PATH}
      data-topup
      className="text-accent-soft-foreground pointer-coarse:mt-1 pointer-coarse:flex pointer-coarse:min-h-11 pointer-coarse:w-fit pointer-coarse:items-center font-semibold whitespace-nowrap underline underline-offset-2"
    >
      Balansni to‘ldirish →
    </Link>
  );
  return (
    <>
      <PageHeader
        back
        title={
          <span className="flex min-w-0 items-center gap-2.5">
            {tool && Icon ? (
              <span
                aria-hidden
                data-tool-chip={tool.id}
                className="flex size-9 shrink-0 items-center justify-center rounded-[12px] bg-[rgb(var(--tc)/0.14)]"
                style={{ ["--tc" as string]: tool.tc }}
              >
                <Icon className="size-5 text-[rgb(var(--tc))]" />
              </span>
            ) : null}
            <span className="truncate text-[21px] sm:text-[24px]" data-tool-title>
              {title}
            </span>
          </span>
        }
        subtitle={tool?.description}
      />
      <div ref={rootRef} data-tool-chrome className="mx-auto w-full max-w-3xl px-4 pt-2 pb-6">
        {children}

        {/* FE-17: qoralama saqlanmadi / fayl qayta biriktirilsin — har formada. */}
        <DraftNotice />

        {extra ? (
          <button
            type="button"
            onClick={onExtra}
            className="text-muted-foreground hover:text-foreground pointer-coarse:min-h-11 mb-8 flex items-center gap-1 text-[15px]"
          >
            Qoʼshimcha (ixtiyoriy)
            <ChevronDown className={`size-4 transition ${extraOpen ? "rotate-180" : ""}`} />
          </button>
        ) : null}
        {extra && extraOpen ? <div className="mb-8">{extra}</div> : null}

        {/*
         * UX-03: «Balans yetarli emas» endi o'lik matn emas — yonida to'ldirish
         * sahifasiga (Hamyon) havola. Ilgari foydalanuvchi profil → to'ldirish
         * yo'lini o'zi topishi kerak edi.
         */}
        {error ? (
          <p role="alert" className="text-destructive mb-4 text-[14.5px] leading-snug">
            {error}
            {balanceError ? <> {topUp}</> : null}
          </p>
        ) : short ? (
          <p className="text-muted-foreground mb-4 text-[14.5px] leading-snug" data-balance-short>
            Balansingiz: {formatTanga(total)} — bu hujjat uchun {formatTanga(price ?? 0)} kerak. {topUp}
          </p>
        ) : null}

        {/*
         * `data-submit-bar` also drives `#main`'s scroll padding (AppShell), so
         * focus and caret reveals never stop behind the bar. The bottom padding
         * keeps the card above the home indicator; the page colour fades in
         * behind the floating card so the form never shows through its edges.
         */}
        <div
          data-submit-bar={typing ? "inline" : "sticky"}
          // z-10: positioned form content (template previews) must not paint over the floating card.
          className={`-mx-2 bg-gradient-to-t from-[var(--page-bg)] from-60% to-transparent px-0 pt-3 ${SUBMIT_BAR_PB} ${
            typing ? "static" : "sticky bottom-0 z-10"
          }`}
        >
          <div
            data-submit-card
            className="bg-card flex items-center gap-3 rounded-[22px] border p-2 shadow-[var(--shadow-bar)]"
          >
            {price === undefined ? null : (
              <div className="min-w-0 shrink-0 pl-2.5">
                <span className="text-muted-foreground block text-[12.5px] leading-tight">Narxi</span>
                <span id={priceId} className="block text-[17px] leading-tight font-bold whitespace-nowrap tabular-nums" data-price-total>
                  {formatTanga(price)}
                </span>
              </div>
            )}
            <button
              type="button"
              disabled={disabled || loading}
              onClick={onSubmit}
              aria-describedby={price === undefined ? undefined : priceId}
              className="bg-primary text-primary-foreground focus-visible:ring-ring flex h-12 min-w-0 flex-1 items-center justify-center rounded-[16px] px-4 text-[16px] font-semibold outline-none transition-[filter,transform] hover:brightness-95 focus-visible:ring-2 focus-visible:ring-offset-2 active:scale-[0.98] disabled:opacity-50 motion-reduce:transform-none"
            >
              <span className="truncate">{loading ? "Yaratilmoqda..." : submitLabel}</span>
            </button>
          </div>
        </div>
      </div>
    </>
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
          className="bg-card text-muted-foreground hover:text-foreground hover:border-foreground/30 pointer-coarse:min-h-11 pointer-coarse:max-w-[80%] pointer-coarse:shrink-0 pointer-coarse:truncate pointer-coarse:px-3.5 pointer-coarse:text-[14px] rounded-full border px-3 py-1 text-left text-[13px]"
        >
          {ex}
        </button>
      ))}
    </div>
  );
}
