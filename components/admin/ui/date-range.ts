import { addDaysIso, diffDaysIso, isIsoDate, todayTashkent } from "@/lib/admin-format";

/** Inclusive calendar-day range in Asia/Tashkent, both `YYYY-MM-DD`. */
export type DateRange = { from: string; to: string };

export const MAX_RANGE_DAYS = 366;

export type PresetId = "today" | "yesterday" | "7d" | "30d" | "month" | "lastMonth";

export const DATE_PRESETS: ReadonlyArray<{ id: PresetId; label: string }> = [
  { id: "today", label: "Bugun" },
  { id: "yesterday", label: "Kecha" },
  { id: "7d", label: "7 kun" },
  { id: "30d", label: "30 kun" },
  { id: "month", label: "Shu oy" },
  { id: "lastMonth", label: "O'tgan oy" },
];

/** Range for a preset, relative to the given Tashkent calendar day (`today`). */
export function presetRange(id: PresetId, today: string = todayTashkent()): DateRange {
  switch (id) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const y = addDaysIso(today, -1);
      return { from: y, to: y };
    }
    case "7d":
      return { from: addDaysIso(today, -6), to: today };
    case "30d":
      return { from: addDaysIso(today, -29), to: today };
    case "month":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case "lastMonth": {
      const firstThis = `${today.slice(0, 7)}-01`;
      const last = addDaysIso(firstThis, -1);
      return { from: `${last.slice(0, 7)}-01`, to: last };
    }
  }
}

/** The preset a range equals (so its button can show as active), or `null` for a custom range. */
export function matchPreset(range: DateRange, today: string = todayTashkent()): PresetId | null {
  for (const p of DATE_PRESETS) {
    const r = presetRange(p.id, today);
    if (r.from === range.from && r.to === range.to) return p.id;
  }
  return null;
}

/** Number of calendar days in the inclusive range. */
export function rangeDays(range: DateRange): number {
  return diffDaysIso(range.from, range.to) + 1;
}

/** Same-length range immediately before this one (for "oldingi davr" deltas). */
export function previousRange(range: DateRange): DateRange {
  const n = rangeDays(range);
  return { from: addDaysIso(range.from, -n), to: addDaysIso(range.from, -1) };
}

/** Uzbek error text, or `null` when the range is valid. */
export function validateRange(range: DateRange, maxDays: number = MAX_RANGE_DAYS): string | null {
  if (!isIsoDate(range.from) || !isIsoDate(range.to)) return "Sana noto'g'ri";
  if (range.from > range.to) return "Boshlanish sanasi tugash sanasidan keyin bo'lishi mumkin emas";
  if (rangeDays(range) > maxDays) return `Oraliq ${maxDays} kundan oshmasligi kerak`;
  return null;
}

export const MONTH_NAMES = [
  "Yanvar",
  "Fevral",
  "Mart",
  "Aprel",
  "May",
  "Iyun",
  "Iyul",
  "Avgust",
  "Sentabr",
  "Oktabr",
  "Noyabr",
  "Dekabr",
] as const;

export type DateParts = { d: string; m: string; y: string };

export function splitIso(iso: string): DateParts {
  return isIsoDate(iso) ? { y: iso.slice(0, 4), m: iso.slice(5, 7), d: iso.slice(8, 10) } : { d: "", m: "", y: "" };
}

/** `YYYY-MM-DD` when all three parts are set and form a real day, else `""`. */
export function joinParts(p: DateParts): string {
  if (!p.d || !p.m || !p.y) return "";
  const iso = `${p.y}-${p.m}-${p.d}`;
  return isIsoDate(iso) ? iso : "";
}
