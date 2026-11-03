"use client";

import type { ClientEntry } from "@/lib/studio-core";
import { applyPriceAdjust, getClientPriceAdjust, type PriceAdjust } from "@/lib/price-adjust";
import { studioEntryPrice } from "@/lib/media/studio-pricing";
import { AUTO_LANGUAGE, DUB_MAX_SECONDS, SPEECH_TOOL_MODES, TRANSCRIBE_AUDIO_MAX_SECONDS, TRANSCRIBE_VIDEO_MAX_SECONDS, parseSource, type SpeechToolMode } from "@/lib/media/catalog-transcribe";
import { billedSeconds } from "@/lib/media/studio-audio";
import type { ToolId } from "@/lib/types";
import type { RawValues } from "../studio-values";
import type { StudioPricing } from "../studio-types";
import type { MixSource, MixSources } from "./mix-api";

/**
 * Studio P10 glue (docs/studio/P10-SPEC.md): the «Transkripsiya» / «Dublyaj» form's state, sources and price preview —
 * NOT a second formula: `studioEntryPrice` over the catalog endpoint's entry + `pricing` block (what the server's
 * `basePriceFor` charges with), then the session's `tool_pricing` % of the tool. `sourceSeconds` here is the source's
 * billed length as the server will compute it (the upload's billed seconds / the stored result length rounded up); the
 * server sets its own number before pricing, so a stale preview is a 409, never a wrong charge.
 */

export type SourceTab = "result" | "upload";
/** Per mode: the raw values, the source picker's tab, and the picked source's kind (the burn row needs a video). */
export type SpeechToolState = { raw: RawValues; tab: SourceTab; kind: "video" | "audio" | null };
export type SpeechToolsState = Partial<Record<SpeechToolMode, SpeechToolState>>;
export const INITIAL_SPEECH_TOOL: SpeechToolState = { raw: {}, tab: "result", kind: null };

export function toolIdOf(mode: SpeechToolMode): ToolId {
  return SPEECH_TOOL_MODES.find((m) => m.mode === mode)!.toolId;
}

/** The modes the catalog lists now (their entries), in chip order. */
export function offeredSpeechTools(models: readonly ClientEntry[]): { mode: SpeechToolMode; label: string; entry: ClientEntry }[] {
  return SPEECH_TOOL_MODES.flatMap((m) => {
    const entry = models.find((e) => e.id === m.model);
    return entry ? [{ mode: m.mode, label: m.label, entry }] : [];
  });
}

/** The longest source a mode takes for a kind (seconds). */
export function sourceMax(mode: SpeechToolMode, kind: "video" | "audio"): number {
  if (mode === "dub") return DUB_MAX_SECONDS;
  return kind === "video" ? TRANSCRIBE_VIDEO_MAX_SECONDS : TRANSCRIBE_AUDIO_MAX_SECONDS;
}

/** The picker's list: the user's finished videos, then audios, within the mode's length limit (no stored length = listed). */
export function speechSources(mode: SpeechToolMode, sources: Pick<MixSources, "video" | "audio">): (MixSource & { media: "video" | "audio" })[] {
  const fits = (s: MixSource, kind: "video" | "audio") => s.seconds === null || s.seconds <= sourceMax(mode, kind) + 0.5;
  return [
    ...sources.video.filter((s) => fits(s, "video")).map((s) => ({ ...s, media: "video" as const })),
    ...sources.audio.filter((s) => fits(s, "audio")).map((s) => ({ ...s, media: "audio" as const })),
  ];
}

/** The raw values after picking a result (`result:<id>`, its billed seconds; the burn is dropped for an audio). */
export function pickResult(raw: RawValues, s: MixSource & { media: "video" | "audio" }): RawValues {
  const next: RawValues = { ...raw, source: `result:${s.id}` };
  if (s.seconds !== null) next.sourceSeconds = billedSeconds(s.seconds);
  else delete next.sourceSeconds;
  if (s.media !== "video") delete next.burn;
  return next;
}

/** The raw values after an upload (`upload:<id>`, the server's billed seconds; an upload is audio: no burn). */
export function pickUpload(raw: RawValues, r: { id: string; seconds: number }): RawValues {
  const next: RawValues = { ...raw, source: `upload:${r.id}`, sourceSeconds: r.seconds };
  delete next.burn;
  return next;
}

/** Why the button cannot send yet (Uzbek), `null` when it can. */
export function speechToolBlocker(mode: SpeechToolMode, raw: RawValues): string | null {
  if (!parseSource(raw.source)) return "Avval manbani tanlang: natijalaringizdan birini yoki audio fayl.";
  if (typeof raw.sourceSeconds !== "number") return "Manba uzunligi noma’lum — boshqa natijani tanlang.";
  if (mode === "dub") {
    const src = String(raw.sourceLang ?? AUTO_LANGUAGE);
    if (src !== AUTO_LANGUAGE && src === String(raw.target ?? "uz")) return "Asl til va dublyaj tili bir xil — boshqa tilni tanlang.";
  }
  return null;
}

/** Price on the button: the shared formula + the session's %. */
export function speechToolClientPrice(
  mode: SpeechToolMode,
  entry: ClientEntry,
  values: Readonly<Record<string, unknown>>,
  pricing: StudioPricing,
  adjust: PriceAdjust | undefined = getClientPriceAdjust(toolIdOf(mode)),
): number {
  return applyPriceAdjust(studioEntryPrice(entry, values, pricing), adjust);
}
