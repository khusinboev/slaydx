"use client";

import { useId } from "react";
import { cn } from "@/lib/cn";
import type { AmountsDraft } from "./format";

export const FIELD =
  "border-input bg-card focus:ring-ring h-10 w-full rounded-lg border px-2.5 text-[13.5px] tabular-nums outline-none focus:ring-2 disabled:opacity-60";

/** Join bonus, stay bonus and stay days: the three numbers every channel has. */
export function AmountFields({
  draft,
  onChange,
  error,
  disabled = false,
}: {
  draft: AmountsDraft;
  onChange: (next: AmountsDraft) => void;
  /** Shown under the fields (the first invalid one). */
  error: string | null;
  disabled?: boolean;
}) {
  const ids = useId();
  const field = (key: keyof AmountsDraft, label: string, hint: string) => (
    <div className="flex min-w-0 flex-col gap-1.5 text-[12.5px]">
      <label htmlFor={`${ids}-${key}`} className="font-semibold">
        {label}
      </label>
      <input
        id={`${ids}-${key}`}
        name={key}
        value={draft[key]}
        onChange={(e) => onChange({ ...draft, [key]: e.target.value })}
        inputMode="numeric"
        autoComplete="off"
        disabled={disabled}
        aria-invalid={Boolean(error)}
        aria-describedby={`${ids}-error`}
        className={FIELD}
      />
      <span className="text-muted-foreground text-xs">{hint}</span>
    </div>
  );
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="sr-only">Bonus miqdorlari</legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {field("joinBonus", "Obuna bonusi", "Obuna tasdiqlanganda, bir marta")}
        {field("stayBonus", "Qo'shimcha bonus", "Kanalda qolsa; 0 — yo'q")}
        {field("stayDays", "Necha kundan keyin", "1 dan 365 gacha")}
      </div>
      <p id={`${ids}-error`} role={error ? "alert" : undefined} className={cn("text-xs", error ? "text-destructive" : "sr-only")}>
        {error ?? ""}
      </p>
    </fieldset>
  );
}
