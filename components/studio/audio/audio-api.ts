"use client";

import type { ClientEntry } from "@/lib/studio-core";
import { request } from "@/lib/api-client";
import { applyPriceAdjust, getClientPriceAdjust, type PriceAdjust } from "@/lib/price-adjust";
import { audioEntryPrice } from "@/lib/media/studio-audio";
import type { ToolId } from "@/lib/types";
import type { StudioPricing } from "../studio-types";

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

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The converted recording / upload → `{ id, seconds }` (`seconds` = the billed whole seconds the server prices with). */
export async function uploadAudioInput(blob: Blob, fileName: string): Promise<{ id: string; seconds: number }> {
  const form = new FormData();
  form.append("file", blob, fileName);
  const r = await request<unknown>("/api/media/audio-inputs", { method: "POST", body: form, timeoutMs: 120_000 });
  const id = isObj(r) && typeof r.id === "string" && /^[0-9a-f]{24}$/.test(r.id) ? r.id : null;
  const seconds = isObj(r) && typeof r.seconds === "number" && Number.isInteger(r.seconds) ? r.seconds : null;
  if (!id || seconds === null) throw new Error("Audio yuklanmadi");
  return { id, seconds };
}
