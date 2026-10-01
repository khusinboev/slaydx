"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { daysInMonth, todayTashkent } from "@/lib/admin-format";
import {
  DATE_PRESETS,
  MAX_RANGE_DAYS,
  MONTH_NAMES,
  joinParts,
  matchPreset,
  presetRange,
  splitIso,
  validateRange,
  type DateParts,
  type DateRange,
} from "./date-range";

export type { DateRange } from "./date-range";

const SELECT =
  "border-input bg-card focus:ring-ring h-8 rounded-lg border px-1.5 text-[12.5px] outline-none focus:ring-2";

/** Day / month / year selects (no native date input: it follows the browser locale). */
function PartsSelect({
  label,
  parts,
  years,
  onChange,
}: {
  label: string;
  parts: DateParts;
  years: ReadonlyArray<number>;
  onChange: (next: DateParts) => void;
}) {
  const maxDay = parts.y && parts.m ? daysInMonth(Number(parts.y), Number(parts.m)) : 31;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <select aria-label={`${label} — kun`} value={parts.d} onChange={(e) => onChange({ ...parts, d: e.target.value })} className={SELECT}>
        <option value="">kun</option>
        {Array.from({ length: maxDay }, (_, i) => String(i + 1).padStart(2, "0")).map((d) => (
          <option key={d} value={d}>
            {Number(d)}
          </option>
        ))}
      </select>
      <select aria-label={`${label} — oy`} value={parts.m} onChange={(e) => onChange({ ...parts, m: e.target.value })} className={SELECT}>
        <option value="">oy</option>
        {MONTH_NAMES.map((name, i) => (
          <option key={name} value={String(i + 1).padStart(2, "0")}>
            {name}
          </option>
        ))}
      </select>
      <select aria-label={`${label} — yil`} value={parts.y} onChange={(e) => onChange({ ...parts, y: e.target.value })} className={SELECT}>
        <option value="">yil</option>
        {years.map((y) => (
          <option key={y} value={String(y)}>
            {y}
          </option>
        ))}
      </select>
    </span>
  );
}

function CustomRange({
  value,
  maxDays,
  years,
  onChange,
}: {
  value: DateRange;
  maxDays: number;
  years: ReadonlyArray<number>;
  onChange: (range: DateRange) => void;
}) {
  const [from, setFrom] = useState<DateParts>(() => splitIso(value.from));
  const [to, setTo] = useState<DateParts>(() => splitIso(value.to));
  const [error, setError] = useState<string | null>(null);

  // Emit only a complete, valid range; otherwise explain why nothing changed.
  function update(nextFrom: DateParts, nextTo: DateParts) {
    setFrom(nextFrom);
    setTo(nextTo);
    const range = { from: joinParts(nextFrom), to: joinParts(nextTo) };
    const complete = Boolean(range.from && range.to);
    const problem = complete ? validateRange(range, maxDays) : null;
    setError(problem);
    if (complete && !problem) onChange(range);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px]">
        <span className="text-muted-foreground">Dan</span>
        <PartsSelect label="Boshlanish sanasi" parts={from} years={years} onChange={(p) => update(p, to)} />
        <span className="text-muted-foreground">gacha</span>
        <PartsSelect label="Tugash sanasi" parts={to} years={years} onChange={(p) => update(from, p)} />
      </div>
      {error ? (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Period picker: presets (Bugun ... O'tgan oy) plus a custom range, all as
 * Asia/Tashkent calendar days (`YYYY-MM-DD`, inclusive, at most `maxDays`).
 */
export function DateRangePicker({
  value,
  onChange,
  maxDays = MAX_RANGE_DAYS,
  ariaLabel = "Davr",
  now,
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
  maxDays?: number;
  ariaLabel?: string;
  /** Test hook: the instant "today" is computed from. */
  now?: number;
}) {
  const today = todayTashkent(now);
  const active = matchPreset(value, today);
  const [customOpen, setCustomOpen] = useState(false);
  const showCustom = customOpen || active === null;
  const thisYear = Number(today.slice(0, 4));
  const firstYear = Math.min(thisYear - 5, Number(value.from.slice(0, 4)) || thisYear);
  const years: number[] = [];
  for (let y = thisYear; y >= firstYear; y--) years.push(y);

  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-label={ariaLabel} className="bg-muted/60 inline-flex max-w-full flex-wrap gap-0.5 self-start rounded-lg p-0.5">
        {DATE_PRESETS.map((p) => {
          const on = !showCustom && active === p.id;
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={on}
              onClick={() => {
                setCustomOpen(false);
                onChange(presetRange(p.id, today));
              }}
              className={cn(
                "focus-visible:ring-ring rounded-md px-2.5 py-1 text-xs whitespace-nowrap transition-colors outline-none focus-visible:ring-2",
                on ? "bg-card text-foreground font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {p.label}
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={showCustom}
          onClick={() => setCustomOpen((o) => !o)}
          className={cn(
            "focus-visible:ring-ring rounded-md px-2.5 py-1 text-xs whitespace-nowrap transition-colors outline-none focus-visible:ring-2",
            showCustom ? "bg-card text-foreground font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          Boshqa…
        </button>
      </div>
      {showCustom ? (
        // Re-mount when the value changes from outside so the selects follow it.
        <CustomRange key={`${value.from}|${value.to}`} value={value} maxDays={maxDays} years={years} onChange={onChange} />
      ) : null}
    </div>
  );
}
