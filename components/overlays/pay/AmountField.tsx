"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/cn";
import { groupDigits } from "@/lib/format";
import { MAX_TOPUP_SOUM, MIN_TOPUP_SOUM, topupAmountError } from "@/lib/topup-limits";
import { DEFAULT_TOPUP, TOPUP_PRESETS } from "../pay-amount";
import { fieldError, inputCls, sectionLabel } from "./ui";

/** Longest typed amount: `10 000 000` has 8 digits; one spare digit lets the error message show. */
const MAX_DIGITS = 9;

/**
 * «Summa»: the preset cards plus a free amount input (owner decision 2026-10-09:
 * 1 000 – 10 000 000 so'm). The input shows grouped digits (`25 000`) and validates
 * inline; the parent disables the payment methods while `topupAmountError` is set.
 */
export function AmountField({ amount, onChange }: { amount: number; onChange: (v: number) => void }) {
  const id = useId();
  const [touched, setTouched] = useState(false);
  const err = topupAmountError(amount);
  const showErr = err !== null && (amount > 0 || touched);

  return (
    <fieldset className="mb-5">
      <legend className={sectionLabel}>Summa</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-pay-presets>
        {TOPUP_PRESETS.map((v) => {
          const on = amount === v;
          const best = v === DEFAULT_TOPUP;
          return (
            <button
              key={v}
              type="button"
              aria-pressed={on}
              data-pay-amount={v}
              aria-label={`${groupDigits(v)} so'm${best ? ", eng qulay" : ""}`}
              onClick={() => onChange(v)}
              className={cn(
                "focus-visible:ring-ring flex min-h-16 flex-col items-center justify-center rounded-[16px] border px-2 py-2 text-center tabular-nums outline-none transition-colors focus-visible:ring-2",
                on ? "border-primary bg-accent-soft shadow-[inset_0_0_0_1px_var(--primary)]" : "bg-card hover:bg-accent",
              )}
            >
              <span className="text-[17px] leading-tight font-bold">{groupDigits(v)}</span>
              <span className={cn("text-[12.5px] leading-tight", best ? "text-accent-soft-foreground font-semibold" : "text-muted-foreground")}>
                {best ? "eng qulay" : "so'm"}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-3">
        <label htmlFor={id} className="text-muted-foreground mb-1.5 block text-[14.5px] font-medium">
          Boshqa summa
        </label>
        <div className="relative">
          <input
            id={id}
            data-pay-input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            enterKeyHint="done"
            placeholder={groupDigits(DEFAULT_TOPUP)}
            value={amount > 0 ? groupDigits(amount) : ""}
            aria-invalid={showErr}
            aria-describedby={`${id}-hint`}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, "").slice(0, MAX_DIGITS);
              onChange(digits ? Number(digits) : 0);
            }}
            onBlur={() => setTouched(true)}
            className={cn(inputCls, "pr-14")}
          />
          <span aria-hidden className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-[14.5px]">
            so&apos;m
          </span>
        </div>
        {showErr ? (
          <p id={`${id}-hint`} role="alert" data-pay-amount-error className={fieldError}>
            {err}
          </p>
        ) : (
          <p id={`${id}-hint`} className="text-muted-foreground mt-1.5 text-[13px]">
            {groupDigits(MIN_TOPUP_SOUM)} — {groupDigits(MAX_TOPUP_SOUM)} so&apos;m
          </p>
        )}
      </div>
    </fieldset>
  );
}
