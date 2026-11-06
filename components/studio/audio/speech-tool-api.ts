"use client";

import type { ClientEntry } from "@/lib/studio-core";
import { applyPriceAdjust, getClientPriceAdjust, type PriceAdjust } from "@/lib/price-adjust";
import { studioEntryPrice } from "@/lib/media/studio-pricing";
import { AUTO_LANGUAGE, DUB_MAX_SECONDS, SPEECH_TOOL_MODES, TRANSCRIBE_AUDIO_MAX_SECONDS, TRANSCRIBE_VIDEO_MAX_SECONDS, parseSource, videoOnlySource, type SpeechToolMode } from "@/lib/media/catalog-transcribe";
import { billedSeconds } from "@/lib/media/studio-audio";
import type { ToolId } from "@/lib/types";
import { carryOver, type RawValues } from "../studio-values";
import type { StudioPricing } from "../studio-types";
import type { MixSource, MixSources } from "./mix-api";

/**
 * Studio P10 glue (docs/studio/P10-SPEC.md): the «Transkripsiya» / «Dublyaj» form's state, sources and price preview —
 * NOT a second formula: `studioEntryPrice` over the catalog endpoint's entry + `pricing` block (what the server's
 * `basePriceFor` charges with), then the session's `tool_pricing` % of the tool. `sourceSeconds` here is the source's
 * billed length as the server will compute it (the upload's billed seconds / the stored result length rounded up); the
 * server sets its own number before pricing, so a stale preview is a 409, never a wrong charge.
 */

/** Where the source comes from: a finished result, an audio upload / recording, or (P11 §D) the user's own video file. */
export type SourceTab = "result" | "upload" | "video";
/** Per mode: the raw values, the source picker's tab, the picked source's kind (the burn row needs a video), the picked model. */
export type SpeechToolState = { raw: RawValues; tab: SourceTab; kind: "video" | "audio" | null; model?: string };
export type SpeechToolsState = Partial<Record<SpeechToolMode, SpeechToolState>>;
export const INITIAL_SPEECH_TOOL: SpeechToolState = { raw: {}, tab: "result", kind: null };

export function toolIdOf(mode: SpeechToolMode): ToolId {
  return SPEECH_TOOL_MODES.find((m) => m.mode === mode)!.toolId;
}

/** The modes the catalog lists now, in chip order: `entries` = the mode's offered models, `entry` = the first (the default). */
export function offeredSpeechTools(models: readonly ClientEntry[]): { mode: SpeechToolMode; label: string; entry: ClientEntry; entries: ClientEntry[] }[] {
  return SPEECH_TOOL_MODES.flatMap((m) => {
    const entries = m.models.flatMap((id) => models.filter((e) => e.id === id));
    return entries.length ? [{ mode: m.mode, label: m.label, entry: entries[0]!, entries }] : [];
  });
}

/**
 * The form after picking another model of the mode: the values it also accepts stay, the rest fall back to its defaults
 * (`carryOver`). The picked source goes when the model cannot take it (an audio on a video-only model).
 */
export function pickSpeechModel(st: SpeechToolState, next: ClientEntry): SpeechToolState {
  const raw = carryOver(next, st.raw);
  if (!videoOnlySource(next.id)) return { ...st, model: next.id, raw };
  // A video-only model: a picked video (a result or an own upload) stays on its tab; an audio source goes.
  if (st.kind === "video") return { ...st, model: next.id, raw, tab: st.tab === "upload" ? "result" : st.tab };
  delete raw.source;
  delete raw.sourceSeconds;
  return { ...st, model: next.id, raw, tab: "result", kind: null };
}

/** The price line under the source: per started minute where the provider bills so (the button shows the price itself). */
export function billedLine(entry: Pick<ClientEntry, "cost">, seconds: number): string {
  const unit = entry.cost.per === "second" ? entry.cost.unitSeconds : undefined;
  return unit ? `Narx to‘liq daqiqalar bilan hisoblanadi: ${Math.max(1, Math.ceil(seconds / unit))} daqiqa.` : `Narx ${seconds} soniya uchun hisoblanadi.`;
}

/** The longest source a mode takes for a kind (seconds). */
export function sourceMax(mode: SpeechToolMode, kind: "video" | "audio"): number {
  if (mode === "dub") return DUB_MAX_SECONDS;
  return kind === "video" ? TRANSCRIBE_VIDEO_MAX_SECONDS : TRANSCRIBE_AUDIO_MAX_SECONDS;
}

/** The picker's list: the user's finished videos, then audios, within the mode's length limit (no stored length = listed). */
export function speechSources(mode: SpeechToolMode, sources: Pick<MixSources, "video" | "audio">, videoOnly = false): (MixSource & { media: "video" | "audio" })[] {
  // On the billed (rounded-up) length, the server's rule: a 180.3 s source bills 181 s and is not offered for a dub.
  const fits = (s: MixSource, kind: "video" | "audio") => s.seconds === null || billedSeconds(s.seconds) <= sourceMax(mode, kind);
  return [
    ...sources.video.filter((s) => fits(s, "video")).map((s) => ({ ...s, media: "video" as const })),
    ...(videoOnly ? [] : sources.audio.filter((s) => fits(s, "audio")).map((s) => ({ ...s, media: "audio" as const }))),
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

/** The raw values after an audio upload (`upload:<id>`, the server's billed seconds; an audio: no burn). */
export function pickUpload(raw: RawValues, r: { id: string; seconds: number }): RawValues {
  const next: RawValues = { ...raw, source: `upload:${r.id}`, sourceSeconds: r.seconds };
  delete next.burn;
  return next;
}

/** P11 §D: the raw values after a VIDEO upload — the same reference shape, the burn stays possible (it is a video). */
export function pickVideoUpload(raw: RawValues, r: { id: string; seconds: number }): RawValues {
  return { ...raw, source: `upload:${r.id}`, sourceSeconds: r.seconds };
}

/**
 * The source the form holds belongs to the tab on screen: a source left on another tab is not shown, so it is never sent
 * or priced (P11 review); going back to its tab brings it back.
 */
export function sourceOnTab(st: Pick<SpeechToolState, "raw" | "tab" | "kind">): boolean {
  const ref = parseSource(st.raw.source);
  if (!ref) return true;
  if (ref.kind === "result") return st.tab === "result";
  return st.tab === (st.kind === "video" ? "video" : "upload");
}

/** Why the button cannot send yet (Uzbek), `null` when it can. */
export function speechToolBlocker(mode: SpeechToolMode, raw: RawValues): string | null {
  if (!parseSource(raw.source)) return "Avval manbani tanlang: natijalaringizdan birini yoki o‘z faylingizni.";
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
