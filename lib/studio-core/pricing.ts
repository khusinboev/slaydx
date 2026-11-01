import { costUsd, type CostRule } from "./cost";
import type { NormalizedParams } from "./params";

/**
 * Price of one job in the host's currency (docs/studio/P0-SPEC.md §3.4). The core knows no currency, markup or
 * rounding of its own: the host injects them, so another project can sell in dollars with its own margin.
 *
 * Order: a `fixed` override wins (P0 keeps today's hand-set ladders this way); otherwise
 * `round(cost USD × rate × markup)` where the markup is the model's override or the global one. The result is a whole
 * number ≥ 1 — a priced job is never free by rounding.
 *
 * The host applies its own per-tool adjustment (SlaydX: `tool_pricing` %) AFTER this, as it does today.
 */
export type PriceOverride =
  | { mode: "markup"; markup: number }
  | { mode: "fixed"; price: (p: NormalizedParams) => number };

export type PriceCtx = {
  /** Host currency units per USD (SlaydX: so'm, `finance.soum_per_usd`). */
  rate: number;
  /** Global markup (SlaydX: `media.markup`, owner default ×2). */
  markup: number;
  /** Host rounding of the raw price (SlaydX: up to 100 so'm). */
  round: (raw: number) => number;
  override?: PriceOverride | null;
};

export const MARKUP_MIN = 1;
export const MARKUP_MAX = 20;

/** Rejects a markup the admin could not have meant (below cost, or absurd). */
export function isValidMarkup(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= MARKUP_MIN && v <= MARKUP_MAX;
}

export function price(rule: CostRule, p: NormalizedParams, ctx: PriceCtx): number {
  const o = ctx.override;
  if (o?.mode === "fixed") return Math.max(1, Math.round(o.price(p)));
  const markup = o?.mode === "markup" && isValidMarkup(o.markup) ? o.markup : ctx.markup;
  const raw = costUsd(rule, p) * ctx.rate * markup;
  return Math.max(1, Math.round(ctx.round(raw)));
}

/** Rounds UP to a multiple of `step` (never below cost × markup). */
export function roundUpTo(step: number): (raw: number) => number {
  return (raw) => Math.ceil(raw / step - 1e-9) * step;
}
