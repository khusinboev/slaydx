"use client";

import { useId } from "react";
import { cn } from "@/lib/cn";

/**
 * «Majburiy obuna» switch (docs/bonus/BONUS3.md C-Q2): a mandatory channel must be joined before
 * the user creates new work (web and bot); it may still pay a bonus, or none.
 */
export function MandatoryField({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5 text-[12.5px]" data-mandatory-field>
      <span id={id} className="font-semibold">
        Majburiy obuna
      </span>
      <div className="flex min-h-10 items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={value}
          aria-labelledby={id}
          onClick={() => onChange(!value)}
          className={cn(
            "focus-visible:ring-ring relative h-6 w-11 shrink-0 rounded-full border transition-colors outline-none focus-visible:ring-2",
            value ? "border-primary bg-primary" : "border-input bg-muted",
          )}
        >
          <span
            aria-hidden="true"
            className={cn("bg-card absolute top-0.5 left-0.5 size-4.5 rounded-full shadow transition-transform", value ? "translate-x-5" : "translate-x-0")}
          />
        </button>
        <span className="text-[13px] font-medium">
          {value ? "🔒 Majburiy — obunasiz yangi ish yaratib bo'lmaydi" : "Ixtiyoriy — faqat bonus uchun"}
        </span>
      </div>
    </div>
  );
}
