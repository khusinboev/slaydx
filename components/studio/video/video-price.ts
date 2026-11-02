import { normalize, type ClientEntry } from "@/lib/studio-core";
import { applyPriceAdjust, getClientPriceAdjust, type PriceAdjust } from "@/lib/price-adjust";
import { studioEntryPrice } from "@/lib/media/studio-pricing";
import { groupDigits } from "@/lib/format";
import type { ToolId } from "@/lib/types";
import type { StudioPricing } from "../studio-types";

/**
 * Video tab price preview — the browser side of `priceFor(studio-video, values)` (docs/studio/P3-SPEC.md). NOT a second
 * formula: the base is `studioEntryPrice`, the function the server's `basePriceFor` → `studioVideoPrice` charges with,
 * fed the catalog endpoint's entry + `pricing` block; then the session's `tool_pricing` % of `studio-video`. The
 * request carries it as `expectedPrice`: a mismatch is a 409, nothing is charged.
 */
export const STUDIO_VIDEO_TOOL_ID: ToolId = "studio-video";
/** The tool's slug (`POST /api/generations` takes slugs). */
export const STUDIO_VIDEO_SLUG = "studio-video";

type Values = Readonly<Record<string, unknown>>;

export function studioVideoClientPrice(entry: ClientEntry, values: Values, pricing: StudioPricing, adjust: PriceAdjust | undefined = getClientPriceAdjust(STUDIO_VIDEO_TOOL_ID)): number {
  return applyPriceAdjust(studioEntryPrice(entry, values, pricing), adjust);
}

/** An effect template (one photo → a fixed clip). */
export const isEffect = (e: Pick<ClientEntry, "capabilities">): boolean => e.capabilities.includes("effect");

/** Clip length the values ask for (`seconds`), `null` for a model without one (an effect: fixed length). */
export function clipSeconds(entry: ClientEntry, values: Values): number | null {
  if (!entry.params.some((p) => p.name === "seconds")) return null;
  const n = Number(normalize(entry.params, values).seconds);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Card text of a model in the picker: the price of the clip at the form's current values («~10 700 so'm / 5 s»). */
export function videoCardPrice(entry: ClientEntry, values: Values, pricing: StudioPricing): string {
  const secs = clipSeconds(entry, values);
  return `~${groupDigits(studioVideoClientPrice(entry, values, pricing))} so'm${secs ? ` / ${secs} s` : ""}`;
}
