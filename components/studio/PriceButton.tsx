"use client";

import Link from "next/link";
import { PAY_RETURN_PATH } from "@/components/overlays/pay-amount";
import { SUBMIT_BAR_PB } from "@/components/forms/ToolChrome";
import { formatSom } from "@/lib/format";

/** The button's text: «Yaratish · 2 ta rasm · 2 600 so'm» (just «Yaratish» while there is no price to promise). */
export function submitLabel(count: number, price: number | null): string {
  return price === null ? "Yaratish" : `Yaratish · ${count} ta rasm · ${formatSom(price)}`;
}

/**
 * Sticky footer of the Studio form (canvas: the amber «Yaratish · N ta rasm · X so'm» button + the balance line). The
 * price is the live preview of the chosen model and values (`studio-price.ts`); the server re-computes it and refuses
 * the job (nothing charged) if it differs. A balance below the price says so BEFORE the press, with the top-up link.
 *
 * `data-submit-bar` is the shell's hook (`AppShell`): sticky while the keyboard is closed, «inline» (in the flow) while
 * typing on a phone, exactly as the tool forms' bar.
 */
export function PriceButton({
  count,
  price,
  balance,
  loading,
  disabled,
  typing,
  onSubmit,
  label,
  paidOnly = false,
}: {
  count: number;
  price: number | null;
  /** Spendable balance; `null` while signed out / not loaded. */
  balance: number | null;
  loading: boolean;
  disabled: boolean;
  typing: boolean;
  onSubmit: () => void;
  /** The button text when priced (the Video tab: «Yaratish · 5 soniya · X so'm»); default = the Rasm tab's `submitLabel`. */
  label?: string;
  /** Video: the balance shown is the PAID one (bonus so'm never pays for video). */
  paidOnly?: boolean;
}) {
  const short = balance !== null && price !== null && price > balance;
  return (
    <div
      data-submit-bar={typing ? "inline" : "sticky"}
      className={`-mx-2 bg-gradient-to-t from-[var(--page-bg)] from-60% to-transparent px-0 pt-3 ${SUBMIT_BAR_PB} ${typing ? "static" : "sticky bottom-0 z-10"}`}
    >
      <div data-submit-card className="bg-card rounded-[22px] border p-2 shadow-[var(--shadow-bar)]">
        <button
          type="button"
          data-studio-submit
          disabled={disabled || loading}
          onClick={onSubmit}
          className="bg-primary text-primary-foreground focus-visible:ring-ring flex h-14 w-full items-center justify-center rounded-[18px] px-4 text-[17px] font-bold outline-none transition-[filter,transform] hover:brightness-95 focus-visible:ring-2 focus-visible:ring-offset-2 active:scale-[0.98] disabled:opacity-50 motion-reduce:transform-none"
        >
          <PriceText text={loading ? "Yaratilmoqda..." : price !== null && label ? label : submitLabel(count, price)} />
        </button>
        {balance === null ? null : short ? (
          <p className="text-muted-foreground px-2 pt-1.5 text-center text-[13px] leading-snug" data-balance-short>
            {paidOnly ? "To‘langan balansingiz" : "Balansingiz"}: {formatSom(balance)} — {formatSom(price ?? 0)} kerak.{" "}
            <Link
              href={PAY_RETURN_PATH}
              data-topup
              className="text-accent-soft-foreground pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center font-semibold whitespace-nowrap underline underline-offset-2"
            >
              Balansni to‘ldirish →
            </Link>
          </p>
        ) : (
          <p className="text-muted-foreground px-2 pt-1.5 text-center text-[12.5px]" data-studio-balance>
            {paidOnly ? "To‘langan balans" : "Balans"}: {formatSom(balance)}
          </p>
        )}
      </div>
    </div>
  );
}

/** The button's text on one line: on a narrow phone the words give way, the price after the last « · » never does. */
function PriceText({ text }: { text: string }) {
  const cut = text.lastIndexOf(" · ");
  if (cut < 0) {
    return (
      <span className="truncate" data-price-total>
        {text}
      </span>
    );
  }
  return (
    <span className="flex min-w-0 max-w-full" data-price-total>
      <span className="truncate">{text.slice(0, cut)}</span>
      <span className="shrink-0 whitespace-pre" data-price-tail>
        {text.slice(cut)}
      </span>
    </span>
  );
}
