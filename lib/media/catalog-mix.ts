/**
 * Studio «Montaj» (docs/studio/P8-SPEC.md «P8c»): ffmpeg in the worker lays a finished audio onto a finished video, or a
 * finished speech over a finished music track. One unlisted tool `studio-mix` (purpose `studio.mix`), two modes = two
 * entries below. They are NOT media-catalog entries (no provider, no route, no `media_jobs` row): the shapes are the
 * catalog's (`ClientEntry`) only so the Studio form (`ParamRows`, `requestValues`) draws and sends them like every tab.
 *
 *   «Videoga ovoz qo'shish»   `studio/mix-video`   a video + an audio → MP4 (video stream copied, audio AAC)
 *   «Ovoz + fon musiqa»       `studio/mix-voice`   a speech + a music track → MP3, length = the speech
 *
 * Inputs are the user's OWN finished generations, named by id (the server checks ownership in SQL before charging and
 * again when the worker loads the bytes) — never a URL. Every other param is a validated number / bool that the pure
 * argument builder (`lib/generation/studio/mix-args.ts`) turns into ffmpeg arguments: no user text reaches the command
 * line.
 *
 * Price: no provider cost, so a FIXED base — the `studio.mix_price` setting (Narx va marja, default 500 so'm, 0–100 000)
 * — then the tool's `tool_pricing` %. The browser learns the base from `GET /api/media/mix-sources` (`price`).
 *
 * Client-safe: no server imports.
 */
import { normalize, validate, type ClientEntry, type ParamSchema } from "../studio-core";

export const STUDIO_MIX_PURPOSE = "studio.mix";
export const MIX_VIDEO_MODEL = "studio/mix-video";
export const MIX_VOICE_MODEL = "studio/mix-voice";
export type MixMode = "video-voice" | "voice-music";

/** Owner rule (P8-SPEC): one mix costs 500 so'm by default; the admin sets 0–100 000. */
export const STUDIO_MIX_PRICE_DEFAULT = 500;
export const STUDIO_MIX_PRICE_MAX = 100_000;

/** Input limits (P8-SPEC «Safety / limits»): a video ≤ 3 min, an audio ≤ 10 min. */
export const MIX_VIDEO_MAX_SECONDS = 180;
export const MIX_AUDIO_MAX_SECONDS = 600;
/** Measured lengths are frame-quantized: this much over a limit still counts as within it. */
export const MIX_SECONDS_TOLERANCE = 0.5;
/** The video's own sound when kept under the new audio (fixed: «under» the new audio, not a second volume control). */
export const MIX_ORIGINAL_VOLUME = 0.35;
/** The result is stored like every file (`generation_files`, `MAX_FILE_BYTES` = 25 MB). */
export const MIX_OUTPUT_MAX_BYTES = 25 * 1024 * 1024;

const GEN_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const idParam = (name: string, label: string): ParamSchema => ({ name, label, type: "text", min: 36, max: 36, affects: "request" });

const VIDEO_PARAMS: readonly ParamSchema[] = [
  idParam("videoId", "Video"),
  idParam("audioId", "Audio"),
  {
    name: "keepOriginal",
    label: "Videoning o‘z ovozini saqlash",
    hint: "Yangi audio ostida pastroq eshitiladi. O‘chiq bo‘lsa videoning ovozi almashtiriladi.",
    type: "bool",
    default: false,
    affects: "request",
  },
  { name: "audioVolume", label: "Audio balandligi (%)", type: "int", min: 10, max: 200, step: 10, default: 100, affects: "request" },
  {
    name: "startOffset",
    label: "Audio boshlanishi (soniya)",
    hint: "Audio videoning shu soniyasidan boshlanadi. Videodan uzun audio kesiladi, qisqasidan keyin jimlik.",
    type: "int",
    min: 0,
    max: MIX_VIDEO_MAX_SECONDS - 1,
    default: 0,
    affects: "request",
  },
];

const VOICE_PARAMS: readonly ParamSchema[] = [
  idParam("speechId", "Ovoz"),
  idParam("musicId", "Musiqa"),
  { name: "musicVolume", label: "Musiqa balandligi (%)", type: "int", min: 5, max: 50, step: 5, default: 20, affects: "request" },
  { name: "ducking", label: "Gapirganda musiqani pasaytirish", type: "bool", default: true, affects: "request" },
  { name: "fadeOut", label: "Oxirida so‘nish (soniya)", hint: "Musiqa ovoz tugashidan oldin shuncha soniyada so‘nadi.", type: "int", min: 0, max: 10, default: 3, affects: "request" },
];

const entry = (id: string, label: string, kind: "video" | "speech", params: readonly ParamSchema[], mime: string): ClientEntry => ({
  id,
  kind,
  capabilities: [],
  label,
  maker: "SlaydX",
  badges: [],
  params,
  cost: { per: "job", usd: 0 },
  limits: { timeoutMs: 120_000 },
  output: { mimes: [mime], maxBytes: MIX_OUTPUT_MAX_BYTES },
});

export const MIX_MODES: readonly { mode: MixMode; model: string; label: string; entry: ClientEntry }[] = [
  { mode: "video-voice", model: MIX_VIDEO_MODEL, label: "Videoga ovoz qo‘shish", entry: entry(MIX_VIDEO_MODEL, "Videoga ovoz qo‘shish", "video", VIDEO_PARAMS, "video/mp4") },
  { mode: "voice-music", model: MIX_VOICE_MODEL, label: "Ovoz + fon musiqa", entry: entry(MIX_VOICE_MODEL, "Ovoz + fon musiqa", "speech", VOICE_PARAMS, "audio/mpeg") },
];

/** The two inputs of each mode, in order (first = the base whose length the result keeps). */
export const MIX_INPUTS: Readonly<Record<MixMode, readonly [string, string]>> = {
  "video-voice": ["videoId", "audioId"],
  "voice-music": ["speechId", "musicId"],
};

/** The mode a request asks for (by `modelId`), `null` for anything else. */
export function mixModeOf(values: { modelId?: unknown }): (typeof MIX_MODES)[number] | null {
  const id = typeof values.modelId === "string" ? values.modelId.trim() : "";
  return MIX_MODES.find((m) => m.model === id) ?? null;
}

export function isGenerationId(v: unknown): v is string {
  return typeof v === "string" && GEN_ID_RE.test(v);
}

/** The setting's value as a price (anything invalid = the default). */
export function mixPriceOf(setting: unknown): number {
  return typeof setting === "number" && Number.isInteger(setting) && setting >= 0 && setting <= STUDIO_MIX_PRICE_MAX ? setting : STUDIO_MIX_PRICE_DEFAULT;
}

/** The normalized params of a mix request (the mode's schema), `null` for an unknown mode. */
export function mixParams(values: Readonly<Record<string, unknown>>): Record<string, unknown> | null {
  const m = mixModeOf(values);
  return m ? { ...normalize(m.entry.params, values) } : null;
}

/**
 * Why the server must refuse a «Montaj» request BEFORE charging (Uzbek, a 400), `null` when it is fine: an unknown
 * mode, a value outside its schema, a missing / malformed input id, the same generation picked twice. Ownership, kind
 * and length of the inputs are the server's SQL check (`lib/server/media/mix-sources.ts`).
 */
export function studioMixError(values: Readonly<Record<string, unknown>>): string | null {
  const m = mixModeOf(values);
  if (!m) return "Noma'lum montaj turi — qaytadan tanlang.";
  const [a, b] = MIX_INPUTS[m.mode];
  const ida = String(values[a] ?? "").trim().toLowerCase();
  const idb = String(values[b] ?? "").trim().toLowerCase();
  if (!isGenerationId(ida)) return m.mode === "video-voice" ? "Avval videoni tanlang." : "Avval ovozni tanlang.";
  if (!isGenerationId(idb)) return m.mode === "video-voice" ? "Avval audioni tanlang." : "Avval musiqani tanlang.";
  if (ida === idb) return "Ikki xil natijani tanlang.";
  return validate(m.entry.params, values);
}

/* The browser's copy of the base price (`GET /api/media/mix-sources` → `price`), read by `basePriceFor`. */
let clientMixPrice: number | null = null;

/** Stores the server's base price; `true` when it changed (the caller re-renders). */
export function setClientMixPrice(raw: unknown): boolean {
  const next = raw === null || raw === undefined ? null : mixPriceOf(raw);
  if (next === clientMixPrice) return false;
  clientMixPrice = next;
  return true;
}

export function getClientMixPrice(): number | null {
  return clientMixPrice;
}
