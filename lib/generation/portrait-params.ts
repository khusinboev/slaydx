/**
 * «BITIRUVCHI PORTRETI» FORMA PARAMETRLARI REYESTRI (program-17 item 14).
 *
 * Rule shared with every other tool ("every param must work"): each field the form shows is declared
 * here and `tests/portrait-params.test.mts` locks it with a differential probe -- the probe builds the
 * portrait twice with value A and value B (provider stubbed) and every DECLARED impact must differ.
 * A field that changes nothing turns the test red.
 */
import type { FormValues } from "../types";

export type PortraitParamImpact =
  /** The text prompt sent to the model. */
  | "prompt"
  /** The source image sent to the model (the selfie bytes). */
  | "input"
  /** How many pictures are requested. */
  | "count"
  /** The price (`priceFor`). */
  | "price";

export type PortraitParam = {
  id: string;
  probeA: FormValues[string];
  probeB: FormValues[string];
  impacts: readonly PortraitParamImpact[];
};

export const PORTRAIT_PARAMS: PortraitParam[] = [
  // Two different 24-hex ids; the probe resolves each to different bytes (the worker does this from `photo_uploads`).
  { id: "photoAssetId", probeA: "0123456789abcdef01234567", probeB: "89abcdef0123456789abcdef", impacts: ["input"] },
  { id: "gown", probeA: "black", probeB: "burgundy", impacts: ["prompt"] },
  { id: "background", probeA: "studio", probeB: "library", impacts: ["prompt"] },
  { id: "sash", probeA: "none", probeB: "gold", impacts: ["prompt"] },
  { id: "variants", probeA: 1, probeB: 2, impacts: ["prompt", "count", "price"] },
];

/** Form field names (`PortraitComposer` draws exactly these, one `data-field` each). */
export const PORTRAIT_FORM_FIELDS = PORTRAIT_PARAMS.map((p) => p.id);
