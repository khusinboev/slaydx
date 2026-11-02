/**
 * Price of a Studio video job (docs/studio/P3-SPEC.md), BEFORE the tool's `tool_pricing` % — the same shared pure
 * formula as the «Rasm» tab (`studioEntryPrice`): provider cost (per second × duration, by tier and sound; per clip for
 * an effect) × `media.markup` (the model's admin override wins), rounded UP to 100 so'm. The server prices with the
 * catalog's own entry, the browser with the catalog endpoint's client view of it and the same `pricing` block.
 *
 * Client-safe: no server imports.
 */
import { validate, type CatalogEntry } from "../studio-core";
import { MEDIA_CATALOG, MEDIA_PURPOSES } from "./catalog";
import { STUDIO_VIDEO_PURPOSE } from "./catalog-video";
import { studioEntryPrice, type MediaPricing } from "./studio-pricing";

/** The model a Studio video form asks for: blank = the purpose default; anything else verbatim. */
export function studioVideoModelOf(values: { modelId?: unknown }): string {
  const raw = typeof values.modelId === "string" ? values.modelId.trim() : "";
  return raw || MEDIA_PURPOSES.byId(STUDIO_VIDEO_PURPOSE)!.default;
}

/** The model is one the Studio «Video» tab sells (`studio.video.allowed`); availability now is the server's question. */
export function isStudioVideoModel(id: string): boolean {
  return MEDIA_PURPOSES.byId(STUDIO_VIDEO_PURPOSE)!.allowed.includes(id);
}

/** The catalog entry of a Studio video form, `null` for a model the tab does not sell. */
export function studioVideoEntry(values: { modelId?: unknown }): CatalogEntry | null {
  const id = studioVideoModelOf(values);
  return isStudioVideoModel(id) ? MEDIA_CATALOG.byId(id) : null;
}

/** An effect template (one photo → a fixed clip): the photo is required and there is no prompt. */
export const isEffectEntry = (e: Pick<CatalogEntry, "capabilities">): boolean => e.capabilities.includes("effect");

/** Base price (so'm), `null` when the model is not a Studio video model (the route refuses that before pricing). */
export function studioVideoPrice(values: Readonly<Record<string, unknown>>, pricing: MediaPricing): number | null {
  const entry = studioVideoEntry(values);
  return entry ? studioEntryPrice(entry, values, pricing) : null;
}

/**
 * The request the server must refuse before charging (Uzbek, for a 400), `null` when it is fine: an unknown model, a
 * value the model's ParamSchema rejects, an effect without its photo. Availability RIGHT NOW is checked by the route.
 */
export function studioVideoError(values: Readonly<Record<string, unknown>>): string | null {
  const entry = studioVideoEntry(values);
  if (!entry) return "Noma'lum video modeli — boshqa modelni tanlang.";
  const bad = validate(entry.params, values);
  if (bad) return bad;
  if (isEffectEntry(entry) && !String(values.imageAssetId ?? "").trim()) return "Effekt uchun surat yuklang.";
  return null;
}
