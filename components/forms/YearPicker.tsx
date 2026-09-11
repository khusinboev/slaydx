"use client";

import { Switch } from "./compact";

/**
 * YIL tanlagich (Rezyume 2, AUDIT-16) — ta'lim va sertifikat uchun.
 *
 * Nega `MonthPicker` emas: o'quv yili O'zbekistonda sentabrda boshlanadi
 * va iyun-iyulda tugaydi — oy so'rash foydalanuvchiga ikkita ortiqcha
 * tanlov va xatolik manbai, rezyumeda esa baribir «2015 – 2019»
 * ko'rinishida chiqadi. Sertifikatda ham yil yetarli (ilgari u erkin
 * matn edi va «2021-yil», «avgust 2021» kabi qiymatlar modelga
 * tushardi).
 *
 * Qiymat: `"YYYY" | "now" | ""` — modeldagi `normalizeYear` bilan bir xil.
 */

const YEAR_MIN = 1960;
const YEAR_MAX = new Date().getFullYear() + 6;

/** Kamayish tartibida: oxirgi yillar ro'yxat boshida turadi. */
export const PICKER_YEARS = Array.from({ length: YEAR_MAX - YEAR_MIN + 1 }, (_, i) => String(YEAR_MAX - i));

export function YearPicker({
  value,
  onChange,
  allowNow,
  label,
  nowLabel = "Hozir o‘qiyapman",
}: {
  value: string;
  onChange: (v: string) => void;
  /** Tugash yili uchun — «hozir o'qiyapman». Sertifikatda YO'Q. */
  allowNow?: boolean;
  /** `aria-label` — satrlar ko'p bo'lgani uchun to'liq yozuv beriladi. */
  label: string;
  nowLabel?: string;
}) {
  const now = value === "now";
  const year = now ? "" : /^\d{4}$/.test(value) ? value : "";

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <select
        aria-label={label}
        value={year}
        disabled={now}
        onChange={(e) => onChange(e.target.value)}
        className="border-input bg-card focus:ring-ring h-8 rounded-lg border px-1.5 text-[12px] outline-none focus:ring-2 disabled:opacity-40"
      >
        <option value="">yil —</option>
        {PICKER_YEARS.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
      {allowNow ? (
        <span className="text-muted-foreground inline-flex items-center gap-1.5 text-[12px]">
          <Switch checked={now} onChange={(on) => onChange(on ? "now" : "")} ariaLabel={nowLabel} />
          hozir
        </span>
      ) : null}
    </span>
  );
}
