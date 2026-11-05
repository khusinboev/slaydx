/**
 * How much of a work the shop window shows (docs/market/PLAN.md §3.1). Pure: the raster builder and the item page read
 * the same rule. At most half of the work is ever readable; a work of one page is shown only in part (`PARTIAL_SHARE`).
 */

/** Share of the page left readable when one page is the whole work; the rest is blurred. */
export const PARTIAL_SHARE = 0.4;

/** Readable pages of a work of `total` pages when the setting allows `allowed`; an unknown length shows one. */
export function readablePages(allowed: number, total: number | null): number {
  if (!total || total < 1) return 1;
  return Math.min(allowed, Math.max(1, Math.floor(total / 2)));
}

/** One page IS the work: showing it whole would give it away. */
export const isPartialPreview = (total: number): boolean => total <= 1;
