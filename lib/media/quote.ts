/**
 * Price of one media job, in so'm, BEFORE the tool's admin adjustment (`tool_pricing` %), which the caller applies as
 * for every other tool. Client-safe: the form preview and the server compute the same number.
 *
 * Order (P0-SPEC §3.4): the admin's per-model override, else the P0 legacy ladder, else cost × markup.
 */
import { normalize, price, roundUpTo, type PriceOverride } from "../studio-core";
import { LEGACY_PRICE_OVERRIDES, MEDIA_CATALOG } from "./catalog";

/** Owner decision 2026-11-01: price = provider cost × 2 (one global markup, per-model override in admin). */
export const MEDIA_MARKUP_DEFAULT = 2;
/** Prices are shown and charged in whole hundreds of so'm. */
export const MEDIA_PRICE_STEP = 100;

export type QuoteCtx = { soumPerUsd: number; markup?: number; override?: PriceOverride | null };

/** `null` for an unknown model id (the route rejects it before this). */
export function mediaQuote(modelId: string, values: Readonly<Record<string, unknown>>, ctx: QuoteCtx): number | null {
  const entry = MEDIA_CATALOG.byId(modelId);
  if (!entry) return null;
  return price(entry.cost, normalize(entry.params, values), {
    rate: ctx.soumPerUsd,
    markup: ctx.markup ?? MEDIA_MARKUP_DEFAULT,
    round: roundUpTo(MEDIA_PRICE_STEP),
    override: ctx.override ?? LEGACY_PRICE_OVERRIDES[modelId] ?? null,
  });
}
