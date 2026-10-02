import { fmtNumber, todayTashkent } from "@/lib/admin-format";
import { presetRange, validateRange, type DateRange } from "@/components/admin/ui/date-range";
import type { KpiDelta } from "@/components/admin/ui/KpiTile";

/**
 * Pure helpers of the dashboard (S3): the period from the URL, "oldingi davr"
 * deltas for the KPI tiles and compact axis labels. No React, no I/O.
 */

/** The dashboard's default period: the last 30 days, today included. */
export const DEFAULT_PRESET = "30d" as const;

/** `from`/`to` from the URL when they form a valid range, else the default 30 days. */
export function rangeFromParams(params: { get(name: string): string | null } | null, today: string = todayTashkent()): {
  range: DateRange;
  fromUrl: boolean;
} {
  const from = params?.get("from") ?? "";
  const to = params?.get("to") ?? "";
  if (from && to && validateRange({ from, to }) === null) return { range: { from, to }, fromUrl: true };
  return { range: presetRange(DEFAULT_PRESET, today), fromUrl: false };
}

/** Is this the dashboard's default period (so "clear filters" has nothing to clear)? */
export function isDefaultRange(range: DateRange, today: string = todayTashkent()): boolean {
  const d = presetRange(DEFAULT_PRESET, today);
  return d.from === range.from && d.to === range.to;
}

/** Which way is good for a KPI: more revenue is good, more refunds are bad. */
export type Polarity = "up-good" | "up-bad";

function toneOf(direction: KpiDelta["direction"], polarity: Polarity): KpiDelta["tone"] {
  if (direction === "flat") return "neutral";
  const good = polarity === "up-good" ? direction === "up" : direction === "down";
  return good ? "good" : "bad";
}

/**
 * Relative change against the previous period: `+12,5%`. When the previous
 * value is 0 a percentage is meaningless, so the text says so instead.
 */
export function percentDelta(current: number, previous: number, polarity: Polarity): KpiDelta {
  if (current === previous) return { text: "0%", direction: "flat", tone: "neutral" };
  const direction = current > previous ? "up" : "down";
  if (previous === 0) return { text: "oldingi davrda 0", direction, tone: toneOf(direction, polarity) };
  const change = ((current - previous) / Math.abs(previous)) * 100;
  const text = `${fmtNumber(change, { digits: Math.abs(change) < 10 ? 1 : 0, sign: true })}%`;
  // A change that rounds to 0 reads as flat.
  if (!/[1-9]/.test(text)) return { text: "0%", direction: "flat", tone: "neutral" };
  return { text, direction, tone: toneOf(direction, polarity) };
}

/** Difference of two percentages in percentage points: `-0,4 p.p.`; `null` when either is unknown. */
export function pointsDelta(current: number | null, previous: number | null, polarity: Polarity): KpiDelta | null {
  if (current === null || previous === null) return null;
  const diff = current - previous;
  const text = `${fmtNumber(diff, { digits: 1, sign: true })} p.p.`;
  if (!/[1-9]/.test(text)) return { text: "0 p.p.", direction: "flat", tone: "neutral" };
  const direction = diff > 0 ? "up" : "down";
  return { text, direction, tone: toneOf(direction, polarity) };
}

/** Short axis label: `1,2 mln`, `350 ming`, `900`. */
export function compactNumber(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${fmtNumber(n / 1_000_000, { digits: 1 })} mln`;
  if (abs >= 1_000) return `${fmtNumber(n / 1_000, { digits: abs >= 10_000 ? 0 : 1 })} ming`;
  return fmtNumber(n, { digits: 2 });
}

/** `2026-03-10` → `10.03` (chart axis). */
export function dayLabel(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
}
