/**
 * Price of a Studio picture job (docs/studio/P1-SPEC.md «Tool»), BEFORE the tool's `tool_pricing` % — ONE pure function
 * that the server (`effectivePrice`) and the browser preview both call, with the same `MediaPricing` block: the server
 * builds it from the settings + `media_model_overrides` (`lib/server/media/pricing.ts`), the browser receives exactly
 * that block from `GET /api/media/catalog` (`pricing`). Same input, same number: `tests/studio-image.test.mts` proves it.
 *
 * Owner rule (2026-11-01): price = provider cost × markup (`media.markup`, default 2; per-model admin override), rounded
 * UP to 100 so'm — never the P0 legacy ladder of «Rasm» (that tool keeps its 2 000 / 3 500 / 6 000).
 *
 * Client-safe: no server imports.
 */
import { isValidMarkup, normalize, price, roundUpTo, type CatalogEntry, type CostRule } from "../studio-core";
import { MEDIA_CATALOG, MEDIA_PURPOSES, STUDIO_IMAGE_PURPOSE, studioPurposeOf } from "./catalog";
import { MEDIA_MARKUP_DEFAULT, MEDIA_PRICE_STEP } from "./quote";
import { soumPerUsd } from "../generation/llm-pricing";

/** The `pricing` block of `GET /api/media/catalog` (contract, P1-SPEC «Session / API»). */
export type MediaPricing = {
  soumPerUsd: number;
  markup: number;
  step: number;
  overrides: Readonly<Record<string, { markup: number }>>;
  /**
   * Provider cost of ONE unit (one picture) per model, in USD, of the upstream model the route uses RIGHT NOW (the admin
   * `image.gemini` slot / the OpenAI image model, priced by `imagePriceOf`). Absent for a model = the catalog CostRule
   * (the default upstream). The price follows the real spend: a pricier slot model is never sold at the lite price.
   */
  costUsd?: Readonly<Record<string, number>>;
  /** Studio P5: the fixed price of one voice clone (`studio.clone_price`), server side only (the voices endpoint sends it). */
  clonePrice?: number;
};

/** Used only when no pricing is known (a server helper outside a request, the very first render). Never charges. */
export function defaultMediaPricing(): MediaPricing {
  return { soumPerUsd: Math.max(1, Math.round(soumPerUsd())), markup: MEDIA_MARKUP_DEFAULT, step: MEDIA_PRICE_STEP, overrides: {}, costUsd: {} };
}

const isCost = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0 && v < 100;

/** The model's CostRule with the block's live unit cost swapped in (only per-output rules carry a unit price). */
export function liveCostRule(rule: CostRule, unitUsd: number | undefined): CostRule {
  if (rule.per !== "output" || !isCost(unitUsd)) return rule;
  const { by: _by, ...rest } = rule;
  void _by;
  return { ...rest, usd: unitUsd };
}

/** The model a Studio form asks for: blank = the purpose default (as the form starts); anything else verbatim. */
export function studioModelOf(values: { modelId?: unknown }): string {
  const raw = typeof values.modelId === "string" ? values.modelId.trim() : "";
  return raw || MEDIA_PURPOSES.byId(STUDIO_IMAGE_PURPOSE)!.default;
}

/**
 * The model is one the Studio sells: in `studio.image.allowed` or, since P2b, one of the edit / upscale / background
 * purposes (`STUDIO_PURPOSES`, same tool `studio-image`). Availability right now is the server's question.
 */
export function isStudioImageModel(id: string): boolean {
  return studioPurposeOf(id) !== null;
}

/** Effective markup of a model: its admin override when valid, else the global one. */
export function markupOf(pricing: MediaPricing, modelId: string): number {
  const o = pricing.overrides[modelId]?.markup;
  return isValidMarkup(o) ? o : pricing.markup;
}

/**
 * Base price (so'm) of `values` (its `modelId` + the model's ParamSchema values), or `null` when the model is not a
 * Studio model (the route rejects that before pricing). The override is always `markup`: the P0 legacy ladders of the
 * same catalog entries never apply here.
 */
export function studioImagePrice(values: Readonly<Record<string, unknown>>, pricing: MediaPricing): number | null {
  const modelId = studioModelOf(values);
  const entry = isStudioImageModel(modelId) ? MEDIA_CATALOG.byId(modelId) : null;
  return entry ? studioEntryPrice(entry, values, pricing) : null;
}

/** The part of a catalog entry the price reads; the browser has it as the catalog endpoint's client view. */
export type PricedEntry = Pick<CatalogEntry, "id" | "cost" | "params">;

/**
 * THE Studio price formula, for one entry: its cost rule (with the block's live unit cost), its normalized params,
 * × the effective markup, rounded UP to `pricing.step` (the server always sends 100). The server prices with the
 * catalog's own entry (`studioImagePrice`), the browser with the same entry from `GET /api/media/catalog` — one function,
 * one number. The tool's `tool_pricing` % comes after, as for every tool (`applyPriceAdjust`).
 */
export function studioEntryPrice(entry: PricedEntry, values: Readonly<Record<string, unknown>>, pricing: MediaPricing): number {
  const step = Number.isInteger(pricing.step) && pricing.step >= 1 ? pricing.step : MEDIA_PRICE_STEP;
  return price(liveCostRule(entry.cost, pricing.costUsd?.[entry.id]), normalize(entry.params, values), {
    rate: pricing.soumPerUsd,
    markup: pricing.markup,
    round: roundUpTo(step),
    override: { mode: "markup", markup: markupOf(pricing, entry.id) },
  });
}

/** A `pricing` block from the network, validated (`null` when it is not one). */
export function parseMediaPricing(raw: unknown): MediaPricing | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const rate = r.soumPerUsd;
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 1) return null;
  if (!isValidMarkup(r.markup)) return null;
  const overrides: Record<string, { markup: number }> = {};
  if (r.overrides && typeof r.overrides === "object" && !Array.isArray(r.overrides)) {
    for (const [id, o] of Object.entries(r.overrides as Record<string, unknown>)) {
      const m = o && typeof o === "object" ? (o as Record<string, unknown>).markup : undefined;
      if (isValidMarkup(m)) overrides[id] = { markup: m };
    }
  }
  const costUsd: Record<string, number> = {};
  if (r.costUsd && typeof r.costUsd === "object" && !Array.isArray(r.costUsd)) {
    for (const [id, c] of Object.entries(r.costUsd as Record<string, unknown>)) if (isCost(c)) costUsd[id] = c;
  }
  return { soumPerUsd: rate, markup: r.markup, step: MEDIA_PRICE_STEP, overrides, costUsd };
}

/*
 * Browser registry, the `price-adjust.ts` pattern: the Studio page stores the catalog's `pricing` block here so
 * `priceFor(studio-image, values)` shows what the server will charge. Read only in the browser; on the server it is
 * invisible (every server price takes its pricing explicitly).
 */
let clientPricing: MediaPricing | null = null;

/** Replaces the browser's pricing block (validated); returns whether it changed. */
export function setClientMediaPricing(raw: unknown): boolean {
  const next = parseMediaPricing(raw);
  if (JSON.stringify(next) === JSON.stringify(clientPricing)) return false;
  clientPricing = next;
  return true;
}

/** The browser's pricing block; always `null` on the server. */
export function getClientMediaPricing(): MediaPricing | null {
  if (typeof window === "undefined") return null;
  return clientPricing;
}
