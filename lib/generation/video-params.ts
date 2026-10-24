/**
 * «VIDEO YARATISH» FORMA PARAMETRLARI REYESTRI (program-17 item 5).
 *
 * Rule shared with every other tool ("every param must work"): each field the form shows is declared here and
 * `tests/video-params.test.mts` locks it with a differential probe -- the probe builds the provider request twice with
 * value A and value B (no network) and every DECLARED impact must differ. A field that changes nothing turns the test red.
 */
import type { FormValues } from "../types";

export type VideoParamImpact =
  /** The HTTP request sent to the provider (`adapters/*.buildRequest`): URL, headers or body. */
  | "request"
  /** The price (`priceFor`). */
  | "price";

export type VideoParam = {
  id: string;
  probeA: FormValues[string];
  probeB: FormValues[string];
  impacts: readonly VideoParamImpact[];
  /** Probe this param on top of these values (e.g. Kling ignores `aspect` for an image start, so probe it text-to-video). */
  probeWith?: FormValues;
};

export const VIDEO_PARAMS: VideoParam[] = [
  { id: "provider", probeA: "veo", probeB: "kling", impacts: ["request", "price"] },
  { id: "prompt", probeA: "Tong chog‘ida Registon maydoni", probeB: "Orol dengizi bo‘yida to‘lqinlar", impacts: ["request"] },
  // 5 and 8 are valid for the default provider (veo); `tests/video-params.test.mts` also probes every provider's own lengths.
  { id: "seconds", probeA: 5, probeB: 8, impacts: ["request", "price"], probeWith: { provider: "veo" } },
  { id: "aspect", probeA: "16:9", probeB: "9:16", impacts: ["request"] },
  // Two different 24-hex ids; the probe resolves each to different bytes (the worker does this from `photo_uploads`).
  { id: "imageAssetId", probeA: "", probeB: "0123456789abcdef01234567", impacts: ["request"] },
];

/** Form field names (`VideoComposer` draws exactly these, one `data-field` each). */
export const VIDEO_FORM_FIELDS = VIDEO_PARAMS.map((p) => p.id);
