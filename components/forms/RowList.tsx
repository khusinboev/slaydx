"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Takrorlanuvchi satrlar ro'yxati (Rezyume 2, 3–4-bandlar): ish joylari,
 * ta'lim, sertifikat, til, havola.
 *
 * Eski forma bularni BITTA erkin matn maydonida so'rardi — natijada
 * modelga kompaniya, sana va vazifalar aralashib tushardi va uni faqat
 * taxmin bilan ajratish mumkin edi. Endi har satr — alohida obyekt,
 * tartibi ham foydalanuvchi qo'lida.
 */

export function reorder<T>(rows: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= rows.length || to >= rows.length) return rows;
  const next = rows.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function RowList<T>({
  rows,
  onChange,
  render,
  add,
  addLabel,
  max,
  empty,
  name,
}: {
  rows: T[];
  onChange: (rows: T[]) => void;
  render: (row: T, set: (patch: Partial<T>) => void, index: number) => ReactNode;
  add: () => T;
  addLabel: string;
  max: number;
  empty?: ReactNode;
  /** `data-rowlist` qiymati — testlar va smoke shu bo'yicha topadi. */
  name: string;
}) {
  const set = (i: number, patch: Partial<T>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => onChange(rows.filter((_, j) => j !== i));
  const move = (i: number, d: -1 | 1) => onChange(reorder(rows, i, i + d));

  return (
    <div data-rowlist={name}>
      {rows.length === 0 && empty ? <p className="text-muted-foreground mb-2 text-[12px]">{empty}</p> : null}
      <div className="flex flex-col gap-2">
        {rows.map((row, i) => (
          <div key={i} data-row className="bg-muted/40 rounded-xl border p-2.5">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-muted-foreground text-[11px] font-medium">{i + 1}</span>
              <span className="flex items-center gap-0.5">
                <IconBtn label="Yuqoriga" disabled={i === 0} onClick={() => move(i, -1)}>
                  ↑
                </IconBtn>
                <IconBtn label="Pastga" disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
                  ↓
                </IconBtn>
                <IconBtn label="O'chirish" onClick={() => remove(i)}>
                  ×
                </IconBtn>
              </span>
            </div>
            {render(row, (patch) => set(i, patch), i)}
          </div>
        ))}
      </div>
      <button
        type="button"
        disabled={rows.length >= max}
        onClick={() => onChange([...rows, add()])}
        className="text-primary mt-2 text-[12px] font-medium disabled:opacity-40"
      >
        + {addLabel}
      </button>
    </div>
  );
}

function IconBtn({
  children,
  label,
  onClick,
  disabled,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "text-muted-foreground hover:bg-muted hover:text-foreground flex size-6 items-center justify-center rounded-md text-[13px]",
        disabled && "opacity-30",
      )}
    >
      {children}
    </button>
  );
}
