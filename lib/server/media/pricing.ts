import "server-only";
import { MEDIA_PRICE_STEP } from "../../media/quote";
import type { MediaPricing } from "../../media/studio-pricing";
import { getSetting } from "../settings";
import { mediaOverrides } from "./overrides";

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
  return { soumPerUsd, markup, step: MEDIA_PRICE_STEP, overrides: per };
}
