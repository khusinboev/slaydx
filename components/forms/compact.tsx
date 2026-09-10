"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
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
        <h2 className="text-muted-foreground text-[11.5px] font-semibold tracking-wide uppercase">{title}</h2>
        {aside ? <div className="text-[13px]">{aside}</div> : null}
      </header>
      {children}
    </section>
  );
}

/** Bitta parametr qatori: yorliq (+ tooltip) | boshqaruv. `wide` — ikki ustunli to'rda butun kenglik. */
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
  return (
    <div className={cn("grid grid-cols-1 items-center gap-1.5 py-1.5 sm:grid-cols-[7.5rem_1fr] sm:gap-3", wide && "sm:col-span-2")}>
      <span className="flex items-center gap-1 text-[13px] font-medium">
        {label}
        {hint ? (
          <span title={hint} aria-label={hint} className="text-muted-foreground cursor-help text-[11px] leading-none">
            ⓘ
          </span>
        ) : null}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Qisqa tanlov (3–6 variant) — kichik segment tugmalar. */
export function Segmented({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: FieldOption[];
  value: string;
  onChange: (v: string) => void;
  ariaLabel?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="bg-muted/60 inline-flex max-w-full flex-wrap gap-0.5 rounded-lg p-0.5">
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs whitespace-nowrap transition-colors",
              on ? "bg-card text-foreground shadow-sm font-medium" : "text-muted-foreground hover:text-foreground",
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
      className="border-input bg-card focus:ring-ring h-8 w-full max-w-xs rounded-lg border px-2 text-[13px] outline-none focus:ring-2"
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
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
        checked ? "bg-primary" : "bg-muted-foreground/30",
      )}
    >
      <span
        className={cn(
          "bg-card inline-block size-4 rounded-full shadow transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

/** Ixcham matn maydoni (muallif kartasi) — yorliq placeholder sifatida, tepasida kichik nom. */
export function MiniInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block min-w-0">
      <span className="text-muted-foreground mb-1 block text-[11px] font-medium">{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="border-input bg-card focus:ring-ring h-9 w-full rounded-lg border px-2.5 text-[13px] outline-none focus:ring-2"
      />
    </label>
  );
}

/** Yig'iq «Sozlamalar» sarlavhasidagi joriy tanlovlar. */
export function SummaryChips({ items }: { items: string[] }) {
  return (
    <span className="text-muted-foreground flex min-w-0 flex-wrap gap-1 text-[11px] font-normal" data-summary-chips>
      {items.map((t, i) => (
        <span key={`${t}-${i}`} className="bg-muted rounded-md px-1.5 py-0.5 whitespace-nowrap">
          {t}
        </span>
      ))}
    </span>
  );
}
