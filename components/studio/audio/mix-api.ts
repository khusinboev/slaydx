"use client";

import { request } from "@/lib/api-client";
import { applyPriceAdjust, getClientPriceAdjust, type PriceAdjust } from "@/lib/price-adjust";
import { MIX_INPUTS, MIX_MODES, STUDIO_MIX_PRICE_DEFAULT, getClientMixPrice, setClientMixPrice, type MixMode } from "@/lib/media/catalog-mix";
import type { ToolId } from "@/lib/types";
import type { RawValues } from "../studio-values";

/**
 * «Montaj» glue (docs/studio/P8-SPEC.md «P8c»): the pickers' sources and the price preview — NOT a second formula: the
 * server's base (`studio.mix_price`, from `GET /api/media/mix-sources`, the number `basePriceFor` reads on both sides)
 * + the session's `tool_pricing` % of `studio-mix`. The request carries it as `expectedPrice` (a mismatch is a 409).
 */
export const STUDIO_MIX_TOOL_ID: ToolId = "studio-mix";
export const STUDIO_MIX_SLUG = "studio-mix";

export type MixSource = { id: string; title: string; kind: string; seconds: number | null; createdAt: string };
export type MixRole = "video" | "audio" | "speech" | "music";
export type MixSources = { price: number } & Record<MixRole, MixSource[]>;

type Picker = { role: MixRole; label: string; empty: string };
/** The pickers' roles of each mode (first = the base, whose length the result keeps). */
export const MIX_PICKERS: Readonly<Record<MixMode, readonly [Picker, Picker]>> = {
  "video-voice": [
    { role: "video", label: "Video", empty: "Hali tayyor video yo‘q — avval «Video» bo‘limida yarating." },
    { role: "audio", label: "Audio", empty: "Hali tayyor audio yo‘q — avval «Ovoz» yoki «Audio» bo‘limida yarating." },
  ],
  "voice-music": [
    { role: "speech", label: "Ovoz", empty: "Hali tayyor ovoz yo‘q — avval «Ovoz» bo‘limida yarating." },
    { role: "music", label: "Fon musiqa", empty: "Hali tayyor musiqa yo‘q — avval «Audio» → «Musiqa»da yarating." },
  ],
};

/** The «Montaj» part of the «Audio» tab's state: the sub-mode and its raw values (ids + options), per sub-mode. */
export type MixTabState = { mode: MixMode; raw: Partial<Record<MixMode, RawValues>> };
export const INITIAL_MIX_STATE: MixTabState = { mode: "video-voice", raw: {} };

/** Price on the button: the server's base + the session's %. */
export function mixClientPrice(adjust: PriceAdjust | undefined = getClientPriceAdjust(STUDIO_MIX_TOOL_ID)): number {
  return applyPriceAdjust(getClientMixPrice() ?? STUDIO_MIX_PRICE_DEFAULT, adjust);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const sourcesOf = (v: unknown): MixSource[] =>
  Array.isArray(v)
    ? v.filter((x): x is MixSource => isObj(x) && typeof x.id === "string" && typeof x.title === "string").map((x) => ({ ...x, seconds: typeof x.seconds === "number" ? x.seconds : null }))
    : [];

/** `GET /api/media/mix-sources`; stores the base price for `basePriceFor`. */
export async function fetchMixSources(): Promise<MixSources> {
  const r = await request<unknown>("/api/media/mix-sources");
  if (!isObj(r)) throw new Error("Natijalar yuklanmadi");
  setClientMixPrice(r.price);
  return { price: typeof r.price === "number" ? r.price : STUDIO_MIX_PRICE_DEFAULT, video: sourcesOf(r.video), audio: sourcesOf(r.audio), speech: sourcesOf(r.speech), music: sourcesOf(r.music) };
}

/** Which «Keyingi qadam» hands a result to the «Montaj» pickers. */
export type MixHandoff = "video" | "audio" | "speech";

/**
 * The tab state after «Videoga ovoz qo'shish» (a video → the video picker; an audio → the audio picker) or «Fon musiqa
 * qo'shish» (a speech → the speech picker): the right sub-mode, that id pre-picked, the other picker untouched. Pure.
 */
export function mixFromResult(s: MixTabState, kind: MixHandoff, id: string): MixTabState {
  const mode: MixMode = kind === "speech" ? "voice-music" : "video-voice";
  const field = kind === "video" ? MIX_INPUTS["video-voice"][0] : kind === "audio" ? MIX_INPUTS["video-voice"][1] : MIX_INPUTS["voice-music"][0];
  return { mode, raw: { ...s.raw, [mode]: { ...(s.raw[mode] ?? {}), [field]: id } } };
}

/** The mode entry (form schema, label) of a sub-mode. */
export function mixEntryOf(mode: MixMode): (typeof MIX_MODES)[number] {
  return MIX_MODES.find((m) => m.mode === mode)!;
}
