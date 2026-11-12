"use client";

import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { groupDigits } from "@/lib/format";
import { paymentBonusHint, paymentBonusPoints } from "@/lib/payment-bonus";
import { MAX_TOPUP_SOUM, MIN_TOPUP_SOUM, topupAmountError } from "@/lib/topup-limits";
import { TOPUP_PRESETS } from "../pay-amount";
import { MethodBadge, type PayMethod } from "./methods";
import { fieldError, inputCls, primaryBtn } from "./ui";

/** Longest typed amount: `10 000 000` has 8 digits; one spare digit lets the error message show. */
const MAX_DIGITS = 9;

/**
 * Step 1 «Summa» of the top-up sheet (owner 2026-11-12): the chosen method on top, an EMPTY amount
 * input (numeric keypad, grouped digits, «so'm» suffix) with quick-fill chips that only fill it,
 * inline validation against `lib/topup-limits.ts`, the payment bonus preview (the server's own
 * `paymentBonusPoints` rounding) and «Davom etish», disabled until the amount is valid. Enter
 * submits. `extra` renders under the button (the Click page fallback).
 */
export function AmountStep({
  method,
  amount,
  onChange,
  bonusPercent,
  busy,
  canContinue = true,
  onContinue,
  error,
  extra,
}: {
  method: PayMethod;
  amount: number;
  onChange: (v: number) => void;
  /** `null` / 0: no preview. */
  bonusPercent: number | null;
  busy: boolean;
  /** Extra precondition of the method (Paynet: the user's ID is loaded). */
  canContinue?: boolean;
  onContinue: () => void;
  error: string | null;
  extra?: ReactNode;
}) {
  const id = useId();
  const [touched, setTouched] = useState(false);
  const err = topupAmountError(amount);
  const showErr = err !== null && (amount > 0 || touched);
  const bonus = err ? 0 : paymentBonusPoints(amount, bonusPercent ?? 0);
  const ready = !err && canContinue && !busy;

  return (
    <form
      data-pay-step="amount"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onContinue();
        else setTouched(true);
      }}
    >
      <div className="bg-muted/50 mb-4 flex items-center gap-3 rounded-[16px] px-3 py-2.5" data-pay-chosen={method.id}>
        <MethodBadge id={method.id} className="size-9" />
        <span className="min-w-0">
          <span className="block text-[15px] leading-tight font-semibold">{method.name}</span>
          <span className="text-muted-foreground block truncate text-[12.5px] leading-snug">{method.hint}</span>
        </span>
      </div>

      <label htmlFor={id} className="mb-1.5 block text-[14.5px] font-semibold">
        Qancha to&apos;ldirasiz?
      </label>
      <div className="relative">
        <input
          id={id}
          data-pay-input
          data-pay-amount-input
          data-autofocus
          type="text"
          inputMode="numeric"
          autoComplete="off"
          enterKeyHint="next"
          placeholder="0"
          value={amount > 0 ? groupDigits(amount) : ""}
          aria-invalid={showErr}
          aria-describedby={`${id}-hint`}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, "").slice(0, MAX_DIGITS);
            onChange(digits ? Number(digits) : 0);
          }}
          onBlur={() => setTouched(true)}
          className={cn(inputCls, "h-14 pr-16 text-[22px] font-semibold tracking-[-0.01em]")}
        />
        <span aria-hidden className="text-muted-foreground pointer-events-none absolute inset-y-0 right-4 flex items-center text-[15px] font-medium">
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

      <div className="mt-3 grid grid-cols-4 gap-2" data-pay-presets role="group" aria-label="Tez tanlash">
        {TOPUP_PRESETS.map((v) => {
          const on = amount === v;
          return (
            <button
              key={v}
              type="button"
              aria-pressed={on}
              data-pay-amount={v}
              aria-label={`${groupDigits(v)} so'm`}
              onClick={() => {
                onChange(v);
                setTouched(true);
              }}
              className={cn(
                "focus-visible:ring-ring flex min-h-11 items-center justify-center rounded-full border px-1 text-[14px] font-semibold tabular-nums outline-none transition-colors focus-visible:ring-2",
                on ? "border-primary bg-accent-soft text-accent-soft-foreground" : "bg-card hover:bg-accent",
              )}
            >
              {groupDigits(v)}
            </button>
          );
        })}
      </div>

      {/* The row keeps its height while the amount is invalid: no jump as the user types. */}
      {(bonusPercent ?? 0) > 0 ? (
        <p
          className={cn(
            "mt-3 min-h-11 rounded-[14px] px-3.5 py-2.5 text-[14px] leading-snug tabular-nums",
            bonus > 0 ? "bg-accent-soft text-accent-soft-foreground font-semibold" : "text-muted-foreground bg-muted/40",
          )}
          data-pay-bonus-preview={bonus > 0 ? bonus : ""}
          aria-live="polite"
        >
          {bonus > 0
            ? `+${groupDigits(bonus)} so'm bonus · Balansga jami: ${groupDigits(amount + bonus)} so'm`
            : paymentBonusHint(bonusPercent ?? 0)}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-destructive mt-3 text-[13.5px]">
          {error}
        </p>
      ) : null}

      <button type="submit" data-pay-continue disabled={!ready} className={cn(primaryBtn, "mt-4")}>
        {busy ? "Ochilmoqda..." : "Davom etish"}
      </button>
      {extra}
    </form>
  );
}
