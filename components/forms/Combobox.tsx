"use client";

import { useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";

/**
 * Tavsiyali kiritish maydoni (Rezyume 2, 2-band) — kasb va ko'nikmalar.
 *
 * Talab: foydalanuvchi yozganda mos kasblar chiqadi (uz/ru/en), tanlagani
 * belgilangan «chip» bo'lib qoladi, chipni bosib olib tashlash mumkin,
 * to'liq matn yozib Enter bosilsa ham qabul qilinadi (ro'yxatda bo'lmasa
 * ham — ro'yxat cheklov emas, yordam).
 *
 * ARIA: `combobox` + `listbox` naqshi (`aria-activedescendant` bilan) —
 * klaviatura va ekran o'quvchi uchun. Bu jsdom testida ham tekshiriladi.
 */

export type Suggestion = { id: string; label: string; hint?: string };

type Common = {
  suggest: (q: string) => Suggestion[];
  placeholder?: string;
  ariaLabel: string;
  id?: string;
  max?: number;
};
export type ComboboxProps =
  | (Common & { multi: true; value: string[]; onChange: (v: string[]) => void })
  | (Common & { multi?: false; value: string; onChange: (v: string) => void });

export function Combobox({ value, onChange, suggest, placeholder, multi, ariaLabel, id, max = 40 }: ComboboxProps) {
  const listId = useId();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const chips = useMemo(() => (multi ? ((value as string[]) ?? []) : []), [multi, value]);
  const single = multi ? "" : String(value ?? "");

  const options = useMemo(() => {
    const list = suggest(multi ? q : q || single);
    return multi ? list.filter((o) => !chips.some((c) => c.toLowerCase() === o.label.toLowerCase())) : list;
  }, [suggest, q, single, multi, chips]);

  const emit = (v: string | string[]) => (onChange as unknown as (x: string | string[]) => void)(v);

  function commit(text: string) {
    const t = text.trim();
    if (!t) return;
    if (multi) {
      if (chips.length >= max) return;
      if (!chips.some((c) => c.toLowerCase() === t.toLowerCase())) emit([...chips, t]);
      setQ("");
    } else {
      emit(t);
      setQ("");
    }
    setOpen(false);
    setCursor(0);
  }

  function removeChip(i: number) {
    emit(chips.filter((_, j) => j !== i));
    inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setCursor((c) => Math.min(options.length - 1, c + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      // Ro'yxat ochiq bo'lsa — belgilangan variant; aks holda yozilgan matn.
      const pick = open && options[cursor] ? options[cursor].label : (multi ? q : q || single);
      commit(pick);
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Backspace" && multi && !q && chips.length) {
      removeChip(chips.length - 1);
    }
  }

  return (
    <div className="relative w-full max-w-md" data-combobox>
      <div
        className={cn(
          "border-input bg-card focus-within:ring-ring flex min-h-9 w-full flex-wrap items-center gap-1 rounded-lg border px-1.5 py-1 focus-within:ring-2",
        )}
      >
        {chips.map((c, i) => (
          <button
            key={`${c}-${i}`}
            type="button"
            data-chip
            aria-pressed
            title="Olib tashlash"
            aria-label={`${c} — olib tashlash`}
            onClick={() => removeChip(i)}
            className="bg-primary/10 text-primary hover:bg-primary/20 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px]"
          >
            {c}
            <span aria-hidden className="text-[13px] leading-none">
              ×
            </span>
          </button>
        ))}
        <input
          id={id}
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label={ariaLabel}
          aria-activedescendant={open && options[cursor] ? `${listId}-${cursor}` : undefined}
          value={multi ? q : q || single}
          placeholder={chips.length ? "" : placeholder}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setCursor(0);
            if (!multi) emit(e.target.value);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          className="min-w-[6rem] flex-1 bg-transparent px-1 text-[13px] outline-none"
        />
      </div>
      {open && options.length ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className="bg-card absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border py-1 shadow-lg"
        >
          {options.map((o, i) => (
            <li
              key={o.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === cursor}
              onMouseDown={(e) => {
                e.preventDefault();
                commit(o.label);
              }}
              onMouseEnter={() => setCursor(i)}
              className={cn("cursor-pointer px-2.5 py-1.5 text-[13px]", i === cursor && "bg-muted")}
            >
              {o.label}
              {o.hint ? <span className="text-muted-foreground ml-2 text-[11px]">{o.hint}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
