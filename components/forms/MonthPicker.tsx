"use client";

import { Switch } from "./compact";

/**
 * Oy/yil tanlagich (Rezyume 2, 3-band).
 *
 * Qiymat `"YYYY-MM" | "YYYY" | "now" | ""` — modeldagi bilan bir xil
 * (`normalizeDate`). Nega to'liq sana emas: rezyumeda kun hech qachon
 * yozilmaydi, `<input type="month">` esa brauzerlarda turlicha
 * ko'rinadi va o'zbekcha oy nomlarini bermaydi.
 */

const MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];
const YEAR_MAX = new Date().getFullYear() + 6;
const YEARS = Array.from({ length: YEAR_MAX - 1960 + 1 }, (_, i) => String(YEAR_MAX - i));

function parse(v: string): { year: string; month: string } {
  const m = /^(\d{4})(?:-(\d{2}))?$/.exec(v || "");
  return { year: m?.[1] ?? "", month: m?.[2] ?? "" };
}

export function MonthPicker({
  value,
  onChange,
  allowNow,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  allowNow?: boolean;
  label: string;
}) {
  const now = value === "now";
  const { year, month } = parse(now ? "" : value);

  function setYear(y: string) {
    onChange(y ? (month ? `${y}-${month}` : y) : "");
  }
  function setMonth(mo: string) {
    if (!year) return onChange(mo ? "" : "");
    onChange(mo ? `${year}-${mo}` : year);
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <select
        aria-label={`${label} — oy`}
        value={month}
        disabled={now}
        onChange={(e) => setMonth(e.target.value)}
        className="border-input bg-card focus:ring-ring h-8 rounded-lg border px-1.5 text-[12px] outline-none focus:ring-2 disabled:opacity-40"
      >
        <option value="">oy —</option>
        {MONTHS.map((m, i) => (
          <option key={m} value={String(i + 1).padStart(2, "0")}>
            {m}
          </option>
        ))}
      </select>
      <select
        aria-label={`${label} — yil`}
        value={year}
        disabled={now}
        onChange={(e) => setYear(e.target.value)}
        className="border-input bg-card focus:ring-ring h-8 rounded-lg border px-1.5 text-[12px] outline-none focus:ring-2 disabled:opacity-40"
      >
        <option value="">yil —</option>
        {YEARS.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
      {allowNow ? (
        <span className="text-muted-foreground inline-flex items-center gap-1.5 text-[12px]">
          <Switch checked={now} onChange={(on) => onChange(on ? "now" : "")} ariaLabel="Hozir ishlayman" />
          hozir
        </span>
      ) : null}
    </span>
  );
}
