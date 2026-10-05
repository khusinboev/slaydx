"use client";

import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useCoarsePointer } from "@/lib/hooks/useCoarsePointer";
import type { FieldOption } from "@/lib/types";

/**
 * IXCHAM forma primitivlari (Formalar 2).
 *
 * Eski slayd formalari 3 400–3 900 px edi: har parametr «sarlavha + izoh
 * + chiplar» bloki bo'lib turardi. Bu yerdagi bo'laklar bitta qoidaga
 * bo'ysunadi: **bir parametr — bir qator** (chapda yorliq, o'ngda
 * boshqaruv), izoh esa `title` tooltip'da (ⓘ). Uzun ro'yxatlar
 * (auditoriya 14, tur 9) `<select>`, qisqalari `Segmented`, Ha/Yo'q —
 * `Switch`. Kartalar (`Card`) bo'limlarni ajratadi.
 *
 * Sensorli ekran (mobile sprint P12, O5): boshqaruvlar `pointer-coarse:`
 * variantlari bilan >= 44 px bo'ladi (sichqoncha ko'rinishi o'zgarmaydi);
 * `title` tooltip sensorda yo'q, shuning uchun `Row` ⓘ belgisi bosilganda
 * izohni qator ostida ochadi (`aria-expanded`).
 */

export function Card({
  title,
  aside,
  children,
  className,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("bg-card mb-3 rounded-2xl border p-4", className)}>
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-muted-foreground pointer-coarse:text-xs text-[11.5px] font-semibold tracking-wide uppercase">{title}</h2>
        {aside ? <div className="text-[13px]">{aside}</div> : null}
      </header>
      {children}
    </section>
  );
}

/**
 * Bitta parametr qatori: yorliq (+ izoh) | boshqaruv. `wide` — ikki ustunli to'rda butun kenglik.
 *
 * Izoh (`hint`): sichqonchada ⓘ ustida `title` tooltip; sensorli ekranda (tooltip yo'q)
 * ⓘ — 44 px tugma (`aria-expanded`), bosilganda izoh matni qator OSTIDA ko'rinadi.
 */
export function Row({
  label,
  hint,
  wide,
  children,
}: {
  label: string;
  hint?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  const coarse = useCoarsePointer();
  const [open, setOpen] = useState(false);
  const hintId = useId();
  const touchHint = coarse && Boolean(hint);
  return (
    <div className={cn("grid grid-cols-1 items-center gap-1.5 py-1.5 sm:grid-cols-[7.5rem_1fr] sm:gap-3", wide && "sm:col-span-2")}>
      <span className="flex items-center gap-1 text-[13px] font-medium">
        {label}
        {hint && !coarse ? (
          <span title={hint} aria-label={hint} className="text-muted-foreground cursor-help text-[11px] leading-none">
            ⓘ
          </span>
        ) : null}
        {touchHint ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={hintId}
            aria-label={`${label}: izoh`}
            onClick={() => setOpen((v) => !v)}
            className={cn(
              "text-muted-foreground -m-3 grid size-11 shrink-0 place-items-center text-[14px] leading-none",
              open && "text-foreground",
            )}
          >
            ⓘ
          </button>
        ) : null}
      </span>
      <div className="min-w-0">{children}</div>
      {touchHint && open ? (
        <p id={hintId} data-hint className="bg-muted/60 text-muted-foreground rounded-lg px-3 py-2 text-xs leading-snug sm:col-span-2">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** `Segmented` uchun variant — AUDIT-25 P4: `disabled` bilan boyitilgan (sig'imdan katta qiymatlarni o'chirish). */
export type SegmentedOption = FieldOption & {
  /** `true` bo'lsa tugma `disabled` + `aria-disabled` bilan o'chadi va kulrang bo'ladi (bosilmaydi). Standart: yoqilgan. */
  disabled?: boolean;
};

/** Qisqa tanlov (3–6 variant) — kichik segment tugmalar. `disabled` variantlar (AUDIT-25) o'chadi, lekin ko'rinib turadi. */
export function Segmented({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: SegmentedOption[];
  value: string;
  onChange: (v: string) => void;
  ariaLabel?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="bg-muted/60 inline-flex max-w-full flex-wrap gap-0.5 rounded-lg p-0.5">
      {options.map((o) => {
        const on = value === o.value;
        const disabled = o.disabled === true;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-disabled={disabled || undefined}
            disabled={disabled}
            onClick={() => !disabled && onChange(o.value)}
            className={cn(
              "pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:px-3 pointer-coarse:text-[13px] rounded-md px-2.5 py-1 text-xs whitespace-nowrap transition-colors",
              disabled
                ? "text-muted-foreground/40 cursor-not-allowed"
                : on
                  ? "bg-card text-foreground shadow-sm font-medium"
                  : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Uzun ro'yxat (auditoriya, tur) — brauzerning o'z `<select>` i: ixcham va klaviaturaga qulay. */
export function SelectField({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: FieldOption[];
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="border-input bg-card focus:ring-ring pointer-coarse:h-11 h-8 w-full max-w-xs rounded-lg border px-2 text-[13px] outline-none focus:ring-2"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Ha/Yo'q — kalit. */
export function Switch({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className="pointer-coarse:h-11 pointer-coarse:w-14 pointer-coarse:justify-center inline-flex shrink-0 items-center"
    >
      <span
        className={cn(
          "pointer-coarse:h-7 pointer-coarse:w-12 relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
          checked ? "bg-primary" : "bg-muted-foreground/30",
        )}
      >
        <span
          className={cn(
            "bg-card pointer-coarse:size-6 inline-block size-4 rounded-full shadow transition-transform",
            checked ? "pointer-coarse:translate-x-[22px] translate-x-[18px]" : "translate-x-0.5",
          )}
        />
      </span>
    </button>
  );
}

/** Yig'iq «Sozlamalar» sarlavhasidagi joriy tanlovlar. */
export function SummaryChips({ items }: { items: string[] }) {
  return (
    <span className="text-muted-foreground pointer-coarse:text-xs flex min-w-0 flex-wrap gap-1 text-[11px] font-normal" data-summary-chips>
      {items.map((t, i) => (
        <span key={`${t}-${i}`} className="bg-muted rounded-md px-1.5 py-0.5 whitespace-nowrap">
          {t}
        </span>
      ))}
    </span>
  );
}
