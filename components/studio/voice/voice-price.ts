import type { ClientEntry } from "@/lib/studio-core";
import { applyPriceAdjust, getClientPriceAdjust, type PriceAdjust } from "@/lib/price-adjust";
import { speechEntryPrice, estimatedSeconds, speechTextParam } from "@/lib/media/studio-speech";
import { groupDigits } from "@/lib/format";
import type { ToolId } from "@/lib/types";
import type { StudioPricing } from "../studio-types";

/**
 * «Ovoz» tab price preview — the browser side of `priceFor(studio-speech / studio-voice, values)`
 * (docs/studio/P5-SPEC.md). NOT a second formula: speech is `speechEntryPrice` (= `studioEntryPrice`, what the server's
 * `basePriceFor` → `studioSpeechPrice` charges with) over the catalog endpoint's entry + `pricing` block, then the
 * session's `tool_pricing` % of `studio-speech`; the clone is the server's `studio.clone_price` (voices endpoint) + the
 * `studio-voice` %. The request carries it as `expectedPrice`: a mismatch is a 409, nothing is charged.
 */
export const STUDIO_SPEECH_TOOL_ID: ToolId = "studio-speech";
export const STUDIO_SPEECH_SLUG = "studio-speech";
export const STUDIO_VOICE_TOOL_ID: ToolId = "studio-voice";
export const STUDIO_VOICE_SLUG = "studio-voice";

type Values = Readonly<Record<string, unknown>>;

export function speechClientPrice(entry: ClientEntry, values: Values, pricing: StudioPricing, adjust: PriceAdjust | undefined = getClientPriceAdjust(STUDIO_SPEECH_TOOL_ID)): number {
  return applyPriceAdjust(speechEntryPrice(entry, values, pricing), adjust);
}

export function cloneClientPrice(base: number, adjust: PriceAdjust | undefined = getClientPriceAdjust(STUDIO_VOICE_TOOL_ID)): number {
  return applyPriceAdjust(base, adjust);
}

/** The spoken text of the values (`text` or the dialogue `script`), as typed. */
export function spokenText(entry: ClientEntry, values: Values): string {
  return String(values[speechTextParam(entry)] ?? "");
}

/** Picker card line: the price of 1 000 characters on that model («~2 100 so'm / 1 000 belgi»). */
export function speechCardPrice(entry: ClientEntry, pricing: StudioPricing): string {
  const values = { [speechTextParam(entry)]: "x".repeat(1000) };
  return `~${groupDigits(speechClientPrice(entry, values, pricing))} so'm / 1 000 belgi`;
}

/** «123 / 4 000 belgi · ~8 s». */
export function charLine(chars: number, max: number): string {
  const secs = estimatedSeconds(chars);
  return `${groupDigits(chars)} / ${groupDigits(max)} belgi${secs ? ` · ~${secs} s` : ""}`;
}
