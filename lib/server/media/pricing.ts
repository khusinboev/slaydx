import "server-only";
import { MEDIA_PRICE_STEP } from "../../media/quote";
import type { MediaPricing } from "../../media/studio-pricing";
import { getSetting } from "../settings";
import { mediaOverrides } from "./overrides";
import { imagePriceOf } from "../../generation/llm-pricing";
import { geminiImageModel } from "../../generation/image-provider-gemini";
import { openaiImageModel } from "../../generation/image-provider-openai";
import { MEDIA_CATALOG, MEDIA_PURPOSES, STUDIO_PURPOSES } from "../../media/catalog";

/**
 * The upstream model each Studio model is drawn with RIGHT NOW (the same functions the engine routes with: the admin
 * `image.gemini` slot / env for Gemini, the OpenAI image model env). A Studio model missing here keeps its catalog cost.
 */
export const STUDIO_UPSTREAM: Readonly<Record<string, () => string>> = {
  "google/nano-banana": geminiImageModel,
  "openai/gpt-image": openaiImageModel,
  // P2b: the edit twin draws on the same Gemini slot model, so it is priced at that model's live cost too.
  "google/nano-banana-edit": geminiImageModel,
  ...falUpstreams(),
};

/**
 * fal models (P2a): the upstream is the catalog route's fixed endpoint, priced from the same price book row
 * (`IMAGE_PRICES`) as the catalog rule. A model priced by a param table (Ideogram's `quality`) is left out ON PURPOSE:
 * a live unit cost replaces the whole rule (`liveCostRule` drops the table), so its price would stop following the
 * quality the user picked; its catalog rule already IS the fal price.
 */
function falUpstreams(): Record<string, () => string> {
  const out: Record<string, () => string> = {};
  for (const id of studioModels()) {
    const e = MEDIA_CATALOG.byId(id)!;
    if (!e.routes.some((x) => x.provider === "fal")) continue;
    if (e.cost.per === "output" && e.cost.by) continue;
    const endpoint = e.routes[0]!.upstreamModel;
    out[id] = () => endpoint;
  }
  return out;
}

/** Every model a Studio purpose sells (P1 pictures + the P2b edit / utility models), catalog order of each purpose. */
function studioModels(): string[] {
  return STUDIO_PURPOSES.flatMap((p) => MEDIA_PURPOSES.byId(p)!.allowed);
}

/** USD of one picture per Studio model at today's upstream (`imagePriceOf`); unknown upstream → left to the catalog rule. */
export function liveUnitCosts(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of studioModels()) {
    const upstream = STUDIO_UPSTREAM[id]?.();
    const usd = upstream ? imagePriceOf(upstream) : null;
    if (usd !== null && usd > 0) out[id] = usd;
  }
  return out;
}

/**
 * The server's `MediaPricing` block (docs/studio/P1-SPEC.md): the dollar rate (`finance.soum_per_usd`), the global
 * markup (`media.markup`) and the admin's per-model markups. `effectivePrice` prices Studio jobs with it and
 * `GET /api/media/catalog` hands exactly this object to the browser, so the preview is computed from the same numbers.
 * Settings reads never throw (env / default fallback), overrides neither (empty map).
 */
export async function mediaPricing(): Promise<MediaPricing> {
  const [soumPerUsd, markup, overrides] = await Promise.all([getSetting("finance.soum_per_usd"), getSetting("media.markup"), mediaOverrides()]);
  const per: Record<string, { markup: number }> = {};
  for (const [id, o] of overrides) if (o.markup !== null) per[id] = { markup: o.markup };
  return { soumPerUsd, markup, step: MEDIA_PRICE_STEP, overrides: per, costUsd: liveUnitCosts() };
}
