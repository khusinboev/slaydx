"use client";

import { normalize, type ClientEntry } from "@/lib/studio-core";
import { request } from "@/lib/api-client";
import { groupDigits } from "@/lib/format";
import { applyPriceAdjust, getClientPriceAdjust, type PriceAdjust } from "@/lib/price-adjust";
import { audioEntryPrice } from "@/lib/media/studio-audio";
import { takesAudioInput } from "@/lib/media/catalog-audio";
import type { ToolId } from "@/lib/types";
import type { StudioPricing } from "../studio-types";
import { lengthText } from "../model-specs";
import { requestValues, type RawValues } from "../studio-values";

/**
 * «Audio» tab glue (docs/studio/P6-SPEC.md): the price preview — NOT a second formula: `audioEntryPrice`
 * (= `studioEntryPrice`, what the server's `basePriceFor` → `studioAudioPrice` charges with) over the catalog
 * endpoint's entry + `pricing` block, then the session's `tool_pricing` % of `studio-audio` — and the input upload.
 */
export const STUDIO_AUDIO_TOOL_ID: ToolId = "studio-audio";
export const STUDIO_AUDIO_SLUG = "studio-audio";

export function audioClientPrice(
  entry: ClientEntry,
  values: Readonly<Record<string, unknown>>,
  pricing: StudioPricing,
  adjust: PriceAdjust | undefined = getClientPriceAdjust(STUDIO_AUDIO_TOOL_ID),
): number {
  return applyPriceAdjust(audioEntryPrice(entry, values, pricing), adjust);
}

/** A model card's unit for an audio-input model: one minute of input (the price is per billed second). */
export const AUDIO_CARD_INPUT_SECONDS = 60;

/**
 * The model card's price line of an «Audio» mode (P11 §D): the job at the form's current values on THAT model — one
 * music track of the chosen length («~2 100 so'm / 30 s»), the effect of the chosen seconds, a minute of input for the
 * voice changer / isolator («~1 300 so'm / 1 daq»). The same `audioClientPrice` as the button.
 */
export function audioCardPrice(entry: ClientEntry, raw: RawValues, pricing: StudioPricing): string {
  if (takesAudioInput(entry)) {
    const values = requestValues(entry, { ...raw, inputId: "0".repeat(24), inputSeconds: AUDIO_CARD_INPUT_SECONDS });
    return `~${groupDigits(audioClientPrice(entry, values, pricing))} so'm / 1 daq`;
  }
  const values = requestValues(entry, raw);
  const n = normalize(entry.params, raw);
  const unit = typeof n.duration === "number" ? lengthText(n.duration) : typeof n.length === "string" && /^\d+$/.test(n.length) ? lengthText(Number(n.length)) : null;
  return `~${groupDigits(audioClientPrice(entry, values, pricing))} so'm${unit ? ` / ${unit}` : ""}`;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

async function uploadInput(blob: Blob, fileName: string, kind: "audio" | "video"): Promise<{ id: string; seconds: number }> {
  const form = new FormData();
  form.append("file", blob, fileName);
  if (kind === "video") form.append("kind", "video");
  const r = await request<unknown>("/api/media/audio-inputs", { method: "POST", body: form, timeoutMs: 120_000 });
  const id = isObj(r) && typeof r.id === "string" && /^[0-9a-f]{24}$/.test(r.id) ? r.id : null;
  const seconds = isObj(r) && typeof r.seconds === "number" && Number.isInteger(r.seconds) ? r.seconds : null;
  if (!id || seconds === null) throw new Error(kind === "video" ? "Video yuklanmadi" : "Audio yuklanmadi");
  return { id, seconds };
}

/** The converted recording / upload → `{ id, seconds }` (`seconds` = the billed whole seconds the server prices with). */
export function uploadAudioInput(blob: Blob, fileName: string): Promise<{ id: string; seconds: number }> {
  return uploadInput(blob, fileName, "audio");
}

/** The longest video a speech tool takes (the same bound the server holds: 3 minutes) and the upload size cap. */
export const VIDEO_INPUT_MAX_SECONDS = 180;
export const VIDEO_INPUT_MAX_BYTES = 25 * 1024 * 1024;

/** Why a picked video cannot be uploaded (Uzbek), `null` when it can — the server's limits, checked first in the browser. */
export function videoBlocker(file: Pick<File, "size" | "type" | "name">): string | null {
  if (!(file.type === "video/mp4" || /\.(mp4|m4v)$/i.test(file.name))) return "Faqat MP4 video qabul qilinadi.";
  if (file.size > VIDEO_INPUT_MAX_BYTES) return "Video 25 MB dan katta.";
  return null;
}

/** P11 §D: the user's own MP4 for «Dublyaj» / «Transkripsiya» — the same upload path as the audio inputs, `kind=video`. */
export function uploadVideoInput(file: Blob, fileName: string): Promise<{ id: string; seconds: number }> {
  return uploadInput(file, fileName, "video");
}
