/**
 * Studio «Audio» tab rules (docs/studio/P6-SPEC.md), shared by the browser and the server — ONE place for the price and
 * the request check, so the preview, the 400 before charging and the worker agree.
 *
 * Price (owner rule): provider cost (per second × the mode's credit rate on the Creator plan) × `media.markup` (the
 * model's admin override wins), rounded UP to 100 so'm — the shared `studioEntryPrice` — then the tool's `tool_pricing`
 * %. The audio-input modes price `inputSeconds`, which the SERVER sets from the upload row before pricing (the client's
 * number is overwritten; a different preview is a 409 `price_changed`).
 *
 * Client-safe: no server imports.
 */
import { normalize, validate, type CatalogEntry } from "../studio-core";
import { MEDIA_CATALOG } from "./catalog";
import { AUDIO_MODEL_IDS, AUDIO_MODES, MUSIC_MODEL, type AudioMode, takesAudioInput } from "./catalog-audio";
import { CLONE_VOICE_PREFIX, ELEVENLABS_VOICES, cloneIdOf } from "./catalog-speech";
import { studioEntryPrice, type MediaPricing, type PricedEntry } from "./studio-pricing";

/** The ToS line of the voice changer (P5 wording; text, no checkbox — the consent checkbox stays clone-only). */
export const AUDIO_INPUT_TOS = "Faqat o‘zingizning yoki ruxsatingiz bor yozuvni yuklang.";

/** Per user: audio input uploads per hour and per day. */
export const AUDIO_INPUTS_PER_HOUR = 20;
export const AUDIO_INPUTS_PER_DAY = 60;

/** The model an «Audio» form asks for: blank = «Musiqa» (the first mode); anything else verbatim. */
export function studioAudioModelOf(values: { modelId?: unknown }): string {
  const raw = typeof values.modelId === "string" ? values.modelId.trim() : "";
  return raw || MUSIC_MODEL;
}

export function isStudioAudioModel(id: string): boolean {
  return AUDIO_MODEL_IDS.includes(id);
}

export function studioAudioEntry(values: { modelId?: unknown }): CatalogEntry | null {
  const id = studioAudioModelOf(values);
  return isStudioAudioModel(id) ? MEDIA_CATALOG.byId(id) : null;
}

/** The purpose a job of this model runs under (`studio.music`, …). */
export function studioAudioPurposeOf(modelId: string): string | null {
  return AUDIO_MODES.find((m) => m.model === modelId)?.purpose ?? null;
}

export function studioAudioModeOf(modelId: string): AudioMode | null {
  return AUDIO_MODES.find((m) => m.model === modelId)?.mode ?? null;
}

/** Base price (so'm) of an «Audio» job; `null` for a model the tab does not sell (the route refuses it first). */
export function studioAudioPrice(values: Readonly<Record<string, unknown>>, pricing: MediaPricing): number | null {
  const entry = studioAudioEntry(values);
  return entry ? studioEntryPrice(entry, values, pricing) : null;
}

/** The same formula for an entry the browser holds (the catalog endpoint's client view). */
export function audioEntryPrice(entry: PricedEntry, values: Readonly<Record<string, unknown>>, pricing: MediaPricing): number {
  return studioEntryPrice(entry, values, pricing);
}

/** Billed seconds of a measured input: rounded UP to the whole second (10 ms tolerance for frame quantization). */
export function billedSeconds(measured: number): number {
  return Number.isFinite(measured) && measured > 0 ? Math.max(1, Math.ceil(measured - 0.01)) : 0;
}

/** How many clips the job makes (sound-effect variants; 1 otherwise). */
export function audioOutputCount(entry: Pick<CatalogEntry, "params">, values: Readonly<Record<string, unknown>>): number {
  if (!entry.params.some((p) => p.name === "variants")) return 1;
  return Number(normalize(entry.params, values).variants) || 1;
}

const ELEVEN_IDS = new Set(ELEVENLABS_VOICES.map((v) => v.id));

/**
 * Why the server must refuse an «Audio» request BEFORE charging (Uzbek, a 400), `null` when it is fine: an unknown
 * model, a value its ParamSchema rejects (prompt too short, a duration outside 1–30, an unknown length…), an over-long
 * prompt (refused, never cut — what is priced is what is sent), a malformed input id, an unknown library voice / a
 * malformed clone reference. Ownership of the input and of a clone is the server's SQL check; availability too.
 */
export function studioAudioError(values: Readonly<Record<string, unknown>>): string | null {
  const entry = studioAudioEntry(values);
  if (!entry) return "Noma'lum audio rejimi — boshqasini tanlang.";
  const bad = validate(entry.params, values);
  if (bad) return takesAudioInput(entry) && /Audio fayl/.test(bad) ? "Avval audio faylni yuklang yoki yozib oling." : bad;
  const prompt = entry.params.find((p) => p.name === "prompt");
  if (prompt && prompt.type === "text") {
    const len = String(values.prompt ?? "").replace(/\s+/g, " ").trim().length;
    if (len > prompt.max) return `Tavsif juda uzun: eng ko‘pi ${prompt.max} belgi (hozir ${len}).`;
  }
  if (takesAudioInput(entry) && !/^[0-9a-f]{24}$/.test(String(values.inputId ?? "").trim())) return "Avval audio faylni yuklang yoki yozib oling.";
  if (entry.params.some((p) => p.name === "voice")) {
    const v = String(values.voice ?? "").trim() || String(normalize(entry.params, values).voice ?? "");
    if (!(ELEVEN_IDS.has(v) || cloneIdOf(v))) return v.startsWith(CLONE_VOICE_PREFIX) ? "Tanlangan ovoz topilmadi — qayta tanlang." : "Noma'lum ovoz — ro‘yxatdan tanlang.";
  }
  return null;
}
