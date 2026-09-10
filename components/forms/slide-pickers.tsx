"use client";

import { SLIDE_THEMES } from "@/lib/generation/slide-themes";
import { cn } from "@/lib/cn";

/**
 * Rang tanlagichi — `TemplateGallery` ostida (Shablonlar 2). Shablon
 * tanlagich endi galereya (`TemplateGallery.tsx`): haqiqiy `SlideCanvas`
 * renderlari, CSS eskiz emas.
 */

/**
 * Rang — faqat doiralar (Formalar 2): nomi `title` da, tanlangani halqa
 * bilan. Ilgari 15 ta nomli chip ikki qator egallardi.
 */
export function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Rang">
      {SLIDE_THEMES.map((t) => {
        const on = value === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={t.nameUz}
            title={t.nameUz}
            onClick={() => onChange(t.id)}
            className={cn(
              "flex size-6 overflow-hidden rounded-full border transition",
              on ? "ring-primary ring-2 ring-offset-2 ring-offset-card" : "border-input hover:scale-110",
            )}
          >
            <span className="h-full w-1/2" style={{ background: t.titleBg }} />
            <span className="h-full w-1/2" style={{ background: t.accent }} />
          </button>
        );
      })}
    </div>
  );
}
