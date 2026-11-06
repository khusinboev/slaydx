/**
 * Studio P10 rules (docs/studio/P10-SPEC.md), shared by the browser and the server — ONE place for the price and the
 * request check of «Transkripsiya» (`studio-transcribe`) and «Dublyaj» (`studio-dub`), so the preview, the 400 before
 * charging and the worker agree.
 *
 * Price: `studioEntryPrice` (provider cost per second × `media.markup`, model override wins, rounded up to 100 so'm) over
 * the entry and the request's `sourceSeconds` — which the SERVER sets from the source before pricing (`speech-sources.ts`
 * `prepareSpeechToolRequest`); a different client preview is a 409 `price_changed`. Then the tool's `tool_pricing` %.
 *
 * Client-safe: no server imports.
 */
import { validate, type CatalogEntry } from "../studio-core";
import { MEDIA_CATALOG } from "./catalog";
import { AUTO_LANGUAGE, DUB_MODEL, DUB_MODELS, SPEECH_TOOL_MODES, TRANSCRIBE_MODEL, TRANSCRIBE_MODELS, parseSource, videoOnlySource } from "./catalog-transcribe";
import { studioEntryPrice, type MediaPricing } from "./studio-pricing";

type Values = Readonly<Record<string, unknown>>;

/** The model a request names (blank = the tool's default). */
const namedModel = (values: Values): string => (typeof values.modelId === "string" ? values.modelId.trim() : "");

function chosenEntry(models: readonly string[], fallback: string, values: Values): CatalogEntry {
  const id = namedModel(values);
  return MEDIA_CATALOG.byId(models.includes(id) ? id : fallback)!;
}

/** The chosen «Transkripsiya» model; a request naming another one is refused by `studioTranscribeError`. */
export function transcribeEntry(values: Values = {}): CatalogEntry {
  return chosenEntry(TRANSCRIBE_MODELS, TRANSCRIBE_MODEL, values);
}

/** The chosen «Dublyaj» model; a request naming another one is refused by `studioDubError`. */
export function dubEntry(values: Values = {}): CatalogEntry {
  return chosenEntry(DUB_MODELS, DUB_MODEL, values);
}

/** The tool offers one of `known` (the session's list): its own model list decides, any of its models will do. */
export function speechToolOffered(toolId: "studio-transcribe" | "studio-dub", known: readonly string[]): boolean {
  return SPEECH_TOOL_MODES.find((m) => m.toolId === toolId)!.models.some((id) => known.includes(id));
}

/** Base price (so'm) of a «Transkripsiya» job before the tool's %. */
export function studioTranscribePrice(values: Readonly<Record<string, unknown>>, pricing: MediaPricing): number {
  return studioEntryPrice(transcribeEntry(values), values, pricing);
}

/** Base price (so'm) of a «Dublyaj» job before the tool's %. */
export function studioDubPrice(values: Readonly<Record<string, unknown>>, pricing: MediaPricing): number {
  return studioEntryPrice(dubEntry(values), values, pricing);
}

const SOURCE_MISSING = "Avval manbani tanlang: audio yuklang yoki natijalaringizdan birini tanlang.";

/** The schema check with the source message the user understands (the label alone says «Manba: kamida 31 ta belgi»). */
function schemaError(entry: CatalogEntry, models: readonly string[], values: Readonly<Record<string, unknown>>): string | null {
  if (namedModel(values) && !models.includes(namedModel(values))) return "Noma'lum model — boshqa modelni tanlang.";
  if (!parseSource(values.source)) return SOURCE_MISSING;
  return validate(entry.params, values);
}

/**
 * Why the server must refuse a «Transkripsiya» request BEFORE charging (Uzbek, a 400), `null` when it is fine: a missing
 * / malformed source, a value outside the schema (an unknown language…), «Subtitrni videoga yopishtirish» on an uploaded
 * audio (an upload is always audio). Ownership, kind and length of a result source are the server's SQL check.
 */
export function studioTranscribeError(values: Readonly<Record<string, unknown>>): string | null {
  const bad = schemaError(transcribeEntry(values), TRANSCRIBE_MODELS, values);
  if (bad) return bad;
  const burn = values.burn === true || values.burn === "true";
  if (burn && parseSource(values.source)?.kind === "upload") return "Subtitrni faqat videoga yopishtirish mumkin — video natijani tanlang.";
  return null;
}

/** The same for «Dublyaj»: + the target language must differ from a chosen source language; an upload is audio. */
export function studioDubError(values: Readonly<Record<string, unknown>>): string | null {
  const entry = dubEntry(values);
  const bad = schemaError(entry, DUB_MODELS, values);
  if (bad) return bad;
  if (videoOnlySource(entry.id) && parseSource(values.source)?.kind === "upload") return "Bu model faqat videoni tarjima qiladi — video natijani tanlang.";
  // A model without the field (HeyGen detects the language itself) never compares a value left over from another model.
  const src = entry.params.some((p) => p.name === "sourceLang") ? String(values.sourceLang ?? AUTO_LANGUAGE).trim() || AUTO_LANGUAGE : AUTO_LANGUAGE;
  const target = String(values.target ?? "").trim() || "uz";
  if (src !== AUTO_LANGUAGE && src === target) return "Asl til va dublyaj tili bir xil — boshqa tilni tanlang.";
  return null;
}
