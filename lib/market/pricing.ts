/**
 * The pure market price formula (docs/market/PLAN.md §4). The server wraps it in `lib/server/market/pricing.ts`; the
 * client never computes a price (house rule: one price source).
 *
 *   raw   = override ?? round(original × percent / 100)
 *   price = max(minPrice, roundTo(raw))
 */

export const MARKET_PERCENT_MIN = 10;
export const MARKET_PERCENT_MAX = 100;
export const MARKET_PERCENT_DEFAULT = 50;
export const MARKET_ROUND_TO = [100, 500, 1000] as const;
export const MARKET_ROUND_TO_DEFAULT = 500;
export const MARKET_MIN_PRICE_DEFAULT = 1000;
export const MARKET_MIN_PRICE_MAX = 20_000;

export type MarketPriceInput = {
  /** Live original price: `effectivePrice` = base × `tool_pricing`. */
  original: number;
  /** Absolute per-item price in so'm; beats every percent. */
  override: number | null;
  /** Per-tool percent, else the global one. */
  percent: number;
  roundTo: number;
  minPrice: number;
};

export function roundToStep(raw: number, step: number): number {
  const s = step > 0 ? step : 1;
  return Math.round(raw / s) * s;
}

export function marketPriceOf(p: MarketPriceInput): number {
  const raw = p.override ?? Math.round((p.original * p.percent) / 100);
  return Math.max(p.minPrice, roundToStep(raw, p.roundTo));
}

/** «−50 %» of the price block; 0 when nothing is discounted. */
export function discountPercent(price: number, original: number): number {
  if (original <= 0 || price >= original) return 0;
  return Math.round(((original - price) / original) * 100);
}
