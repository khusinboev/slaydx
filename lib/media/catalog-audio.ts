/**
 * Studio «Audio» tab models (docs/studio/P6-SPEC.md): ElevenLabs music, sound effects, voice changer (speech-to-speech)
 * and voice isolator — four catalog entries, four purposes, one tool (`studio-audio`). `catalog.ts` spreads these into
 * `MEDIA_ENTRIES` / `MEDIA_PURPOSES`.
 *
 * Client-safe (no server imports) and NOT importing `catalog.ts` (that file imports this one).
 *
 * PROVIDER COSTS: the owner's ElevenLabs Creator plan, as P5 — $22 / 121 000 credits
 * (`ELEVENLABS_CREATOR_USD_PER_CREDIT`). Credit rates (ElevenLabs pricing page / docs, read 2026-11-02; UNVERIFIED until
 * one job of each mode is compared with the ElevenLabs usage page):
 *   music            900 credits / minute of output   = 15 / s          (https://elevenlabs.io/pricing/api)
 *   sound effects    40 credits / s of `duration_seconds`, per variant  (https://elevenlabs.io/docs/overview/capabilities/sound-effects)
 *   voice changer    1 000 credits / minute of INPUT  ≈ 16.67 / s       (https://elevenlabs.io/pricing/api)
 *   voice isolator   1 000 credits / minute of INPUT  ≈ 16.67 / s       (https://help.elevenlabs.io/hc/en-us/articles/26446706351377)
 * The audio-input modes price on the server-measured input length, rounded UP to the whole second (`inputSeconds`, set by
 * the server from the upload row — never the client's number).
 *
 * ENDPOINTS (all `?output_format=mp3_44100_128`, answer = the audio bytes):
 *   POST /v1/music                         { prompt, music_length_ms, force_instrumental, model_id: "music_v1" }
 *   POST /v1/sound-generation              { text, duration_seconds, prompt_influence, loop, model_id: "eleven_text_to_sound_v2" }
 *   POST /v1/speech-to-speech/{voice_id}   multipart audio, model_id "eleven_multilingual_sts_v2", remove_background_noise
 *   POST /v1/audio-isolation               multipart audio
 *
 * STUDIO P9 (docs/studio/P9-SPEC.md): a second «Musiqa» model, Google Lyria on the Gemini key (`adapters/lyria.ts`) —
 * per song, not per second (Gemini API pricing page, read 2026-11-03): Lyria 3 Clip (always 30 s) $0.04, Lyria 3.5
 * (a full song, length steered by the prompt) $0.08. The «Musiqa» mode now offers two models (`AUDIO_MODES.models`,
 * the first is the default).
 *
 * STUDIO P11 package E (docs/studio/P11-SPEC.md): second models of «Effekt» and «Shovqindan tozalash» on the fal key, both
 * `defaultOff` until the admin enables them after a live job:
 *   SFX v3        $0.002 / second                        https://fal.ai/models/elevenlabs/sound-effects/v3/llms.txt (read 2026-11-06)
 *   VEED clean    $0.0125 / minute of input, whole seconds rounded up to full minutes, one minute at least
 *                                                         https://fal.ai/models/veed/clean-audio/llms.txt (read 2026-11-06)
 */
import type { CatalogEntry, ParamSchema, PurposeSpec } from "../studio-core";
import { ELEVENLABS_CREATOR_USD_PER_CREDIT } from "../generation/llm-pricing";
import { ELEVENLABS_VOICES } from "./catalog-speech";

export const STUDIO_MUSIC_PURPOSE = "studio.music";
export const STUDIO_SFX_PURPOSE = "studio.sfx";
export const STUDIO_VOICE_CHANGER_PURPOSE = "studio.voice-changer";
export const STUDIO_ISOLATE_PURPOSE = "studio.isolate";

/**
 * The «Audio» tab's catalog listing (`GET /api/media/catalog?purpose=studio.audio`): the union of the four purposes, one
 * model each. It is a LISTING id only — no job runs under it (every job names its mode's own purpose).
 */
export const STUDIO_AUDIO_LISTING = "studio.audio";

export const MUSIC_MODEL = "elevenlabs/music";
export const SFX_MODEL = "elevenlabs/sfx";
export const VOICE_CHANGER_MODEL = "elevenlabs/voice-changer";
export const ISOLATOR_MODEL = "elevenlabs/isolator";
export const LYRIA_MODEL = "google/lyria-3";
export const FAL_SFX_MODEL = "elevenlabs/sfx-v3-fal";
export const VEED_CLEAN_MODEL = "veed/clean-audio";

/** fal endpoint ids (the routes' upstream model). */
export const FAL_SFX_ENDPOINT = "elevenlabs/sound-effects/v3";
export const VEED_CLEAN_ENDPOINT = "veed/clean-audio";
/** USD per second of the fal models (file header, each page's price). */
export const FAL_SFX_USD_PER_SECOND = 0.002;
export const VEED_CLEAN_USD_PER_SECOND = 0.0125 / 60;

/** Upstream model ids sent in the requests. */
export const ELEVENLABS_MUSIC_MODEL = "music_v1";
export const ELEVENLABS_SFX_MODEL = "eleven_text_to_sound_v2";
export const ELEVENLABS_STS_MODEL = "eleven_multilingual_sts_v2";
/** Lyria upstream models, by the entry's «Turi» value. */
export const LYRIA_CLIP_MODEL = "lyria-3-clip-preview";
export const LYRIA_SONG_MODEL = "lyria-3.5";
/** The Lyria model a «Turi» value asks for (the request, `media_jobs.upstream_model` and `cost_json` all use it). */
export function lyriaUpstreamOf(length: unknown): string {
  return length === "song" ? LYRIA_SONG_MODEL : LYRIA_CLIP_MODEL;
}
/** USD per result, by «Turi». */
export const LYRIA_USD = { clip: 0.04, song: 0.08 } as const;

/** Credits per second of each mode (file header). */
export const MUSIC_CREDITS_PER_SECOND = 900 / 60;
export const SFX_CREDITS_PER_SECOND = 40;
export const AUDIO_INPUT_CREDITS_PER_SECOND = 1000 / 60;

/** Uploaded audio of the voice changer / isolator: 3–300 s measured, ≤ 25 MB (5 min of 24 kHz mono WAV is 14.4 MB). */
export const AUDIO_INPUT_MIN_SECONDS = 3;
export const AUDIO_INPUT_MAX_SECONDS = 300;
export const AUDIO_INPUT_MAX_BYTES = 25 * 1024 * 1024;
/** Bytes one user may keep stored at once (inputs live a day): bounds the shared database, not the user's work. */
export const AUDIO_INPUT_USER_MAX_BYTES = 100 * 1024 * 1024;
/** The cleaned WAV before it becomes an MP3: 5 minutes of the stated 48 kHz mono 16-bit are 28.8 MB. */
export const VEED_CLEAN_MAX_OUTPUT_BYTES = 40 * 1024 * 1024;

const usdPerSecond = (credits: number): number => credits * ELEVENLABS_CREATOR_USD_PER_CREDIT;

const AUDIO_OUT = { mimes: ["audio/mpeg"], maxBytes: 25 * 1024 * 1024 } as const;

/** The uploaded input (`studio_audio_inputs.id`, 24 hex) — ownership is the server's SQL check. */
const inputParam: ParamSchema = { name: "inputId", label: "Audio fayl", type: "text", min: 24, max: 24, affects: "request" };
/** Billed length of the input: the SERVER overwrites it from the upload row before pricing (P6-SPEC «Price»). */
const inputSecondsParam: ParamSchema = {
  name: "inputSeconds",
  label: "Yozuv uzunligi (s)",
  type: "int",
  min: AUDIO_INPUT_MIN_SECONDS,
  max: AUDIO_INPUT_MAX_SECONDS,
  default: AUDIO_INPUT_MIN_SECONDS,
  affects: "price",
};

/** Music length choices (seconds) — the price is per second of output. */
export const MUSIC_LENGTHS = [15, 30, 60, 90, 120, 180] as const;

/** «Aniqlik» of a sound effect: how literally the prompt is followed (`prompt_influence`). */
export const SFX_INFLUENCE = [
  { value: "0.3", label: "Erkin" },
  { value: "0.5", label: "O‘rta" },
  { value: "0.8", label: "Aniq" },
] as const;

/** «Tozalash kuchi»: `strength`, how much of the original stays under speech (0.874 is the page's validated −18 dB). */
export const VEED_STRENGTH = [
  { value: "0.5", label: "Yengil" },
  { value: "0.874", label: "O‘rta" },
  { value: "1", label: "Kuchli" },
] as const;

export const STUDIO_AUDIO_ENTRIES: readonly CatalogEntry[] = [
  {
    id: MUSIC_MODEL,
    kind: "music",
    capabilities: ["music"],
    label: "Musiqa",
    maker: "ElevenLabs",
    badges: ["yangi"],
    params: [
      { name: "prompt", label: "Musiqa tavsifi", hint: "Uslub, kayfiyat, cholg‘ular — inglizcha tavsif eng yaxshi ishlaydi", type: "text", min: 5, max: 2000, affects: "request" },
      {
        name: "length",
        label: "Uzunligi",
        type: "enum",
        options: MUSIC_LENGTHS.map((s) => ({ value: String(s), label: s < 60 ? `${s} s` : s % 60 === 0 ? `${s / 60} daq` : `${Math.floor(s / 60)},5 daq` })),
        default: "30",
        affects: "both",
      },
      { name: "instrumental", label: "Faqat kuy (so‘zsiz)", type: "bool", default: false, affects: "request" },
    ],
    cost: { per: "second", usd: usdPerSecond(MUSIC_CREDITS_PER_SECOND), secondsParam: "length" },
    routes: [{ provider: "elevenlabs", upstreamModel: ELEVENLABS_MUSIC_MODEL, adapter: "studio-elevenlabs-music" }],
    // Informational: the call's real timeout is the job deadline (budget 360 s), which a 3-minute composition must fit.
    limits: { timeoutMs: 240_000 },
    output: AUDIO_OUT,
  },
  {
    id: LYRIA_MODEL,
    kind: "music",
    capabilities: ["music"],
    label: "Lyria 3",
    maker: "Google",
    badges: ["arzon", "yangi"],
    params: [
      { name: "prompt", label: "Musiqa tavsifi", hint: "Uslub, kayfiyat, cholg‘ular; so‘zli qo‘shiq tavsif tilida kuylanadi", type: "text", min: 5, max: 2000, affects: "request" },
      {
        name: "length",
        label: "Turi",
        type: "enum",
        options: [
          { value: "clip", label: "Qisqa (30 s)" },
          { value: "song", label: "To‘liq qo‘shiq" },
        ],
        default: "clip",
        affects: "both",
      },
      { name: "instrumental", label: "Faqat kuy (so‘zsiz)", type: "bool", default: false, affects: "request" },
    ],
    cost: { per: "output", usd: LYRIA_USD.clip, by: { param: "length", table: LYRIA_USD } },
    routes: [{ provider: "gemini", upstreamModel: "lyria", adapter: "studio-gemini-lyria" }],
    limits: { timeoutMs: 240_000 },
    output: AUDIO_OUT,
  },
  {
    id: SFX_MODEL,
    kind: "sfx",
    capabilities: ["sfx"],
    label: "Ovoz effekti",
    maker: "ElevenLabs",
    badges: ["tez"],
    params: [
      { name: "prompt", label: "Effekt tavsifi", hint: "Masalan: eshik g‘ichirlab ochiladi, uzoqda it huradi", type: "text", min: 3, max: 450, affects: "request" },
      { name: "duration", label: "Davomiyligi (s)", type: "int", min: 1, max: 30, default: 5, affects: "both" },
      { name: "influence", label: "Aniqlik", hint: "Tavsifga qanchalik qat’iy amal qilinadi", type: "enum", options: SFX_INFLUENCE, default: "0.5", affects: "request" },
      { name: "loop", label: "Takrorlanuvchi (loop)", hint: "Uzluksiz aylanib chalinadigan effekt", type: "bool", default: false, affects: "request" },
      { name: "variants", label: "Variantlar", type: "int", min: 1, max: 4, default: 1, affects: "both" },
    ],
    cost: { per: "second", usd: usdPerSecond(SFX_CREDITS_PER_SECOND), secondsParam: "duration", countParam: "variants" },
    routes: [{ provider: "elevenlabs", upstreamModel: ELEVENLABS_SFX_MODEL, adapter: "studio-elevenlabs-sfx" }],
    limits: { timeoutMs: 120_000 },
    output: AUDIO_OUT,
  },
  {
    id: FAL_SFX_MODEL,
    kind: "sfx",
    capabilities: ["sfx"],
    label: "SFX v3 · fal",
    maker: "ElevenLabs",
    badges: ["arzon", "yangi"],
    defaultOff: true,
    params: [
      { name: "prompt", label: "Effekt tavsifi", hint: "Masalan: eshik g‘ichirlab ochiladi, uzoqda it huradi", type: "text", min: 3, max: 450, affects: "request" },
      { name: "duration", label: "Davomiyligi (s)", type: "int", min: 1, max: 30, default: 5, affects: "both" },
      { name: "influence", label: "Aniqlik", hint: "Tavsifga qanchalik qat’iy amal qilinadi", type: "enum", options: SFX_INFLUENCE, default: "0.5", affects: "request" },
      { name: "loop", label: "Takrorlanuvchi (loop)", hint: "Uzluksiz aylanib chalinadigan effekt", type: "bool", default: false, affects: "request" },
      { name: "variants", label: "Variantlar", type: "int", min: 1, max: 4, default: 1, affects: "both" },
    ],
    cost: { per: "second", usd: FAL_SFX_USD_PER_SECOND, secondsParam: "duration", countParam: "variants" },
    routes: [{ provider: "fal", upstreamModel: FAL_SFX_ENDPOINT, adapter: "fal" }],
    limits: { timeoutMs: 120_000 },
    output: AUDIO_OUT,
  },
  {
    id: VOICE_CHANGER_MODEL,
    kind: "speech",
    capabilities: ["voice-changer"],
    label: "Ovozni almashtirish",
    maker: "ElevenLabs",
    badges: [],
    params: [
      inputParam,
      inputSecondsParam,
      { name: "voice", label: "Yangi ovoz", type: "voice", source: "user-clones", default: ELEVENLABS_VOICES[0]!.id, affects: "request" },
      { name: "removeNoise", label: "Fon shovqinini olib tashlash", type: "bool", default: false, affects: "request" },
    ],
    cost: { per: "second", usd: usdPerSecond(AUDIO_INPUT_CREDITS_PER_SECOND), secondsParam: "inputSeconds" },
    routes: [{ provider: "elevenlabs", upstreamModel: ELEVENLABS_STS_MODEL, adapter: "studio-elevenlabs-sts" }],
    limits: { timeoutMs: 180_000 },
    output: AUDIO_OUT,
  },
  {
    id: ISOLATOR_MODEL,
    kind: "speech",
    capabilities: ["isolate"],
    label: "Shovqindan tozalash",
    maker: "ElevenLabs",
    badges: [],
    params: [inputParam, inputSecondsParam],
    cost: { per: "second", usd: usdPerSecond(AUDIO_INPUT_CREDITS_PER_SECOND), secondsParam: "inputSeconds" },
    routes: [{ provider: "elevenlabs", upstreamModel: "audio-isolation", adapter: "studio-elevenlabs-isolate" }],
    limits: { timeoutMs: 180_000 },
    output: AUDIO_OUT,
  },
  {
    id: VEED_CLEAN_MODEL,
    kind: "speech",
    capabilities: ["isolate"],
    label: "Clean Audio · fal",
    maker: "VEED",
    badges: ["arzon", "yangi"],
    defaultOff: true,
    params: [
      inputParam,
      inputSecondsParam,
      { name: "strength", label: "Tozalash kuchi", hint: "Yengil — nutq ortidagi muhit ovozi biroz qoladi", type: "enum", options: VEED_STRENGTH, default: "0.874", affects: "request" },
    ],
    cost: { per: "second", usd: VEED_CLEAN_USD_PER_SECOND, secondsParam: "inputSeconds", unitSeconds: 60 },
    routes: [{ provider: "fal", upstreamModel: VEED_CLEAN_ENDPOINT, adapter: "fal" }],
    limits: { timeoutMs: 180_000 },
    // The provider's WAV: the engine encodes the result file, an MP3 like every «Audio» result.
    output: { mimes: ["audio/wav"], maxBytes: VEED_CLEAN_MAX_OUTPUT_BYTES },
  },
];

const one = (id: string, kind: PurposeSpec["kind"], model: string): PurposeSpec => ({ id, kind, allowed: [model], default: model, userCanChoose: false });

export const STUDIO_AUDIO_PURPOSE_SPECS: readonly PurposeSpec[] = [
  // P9: two music models, the user picks (ElevenLabs stays the default).
  { id: STUDIO_MUSIC_PURPOSE, kind: "music", allowed: [MUSIC_MODEL, LYRIA_MODEL], default: MUSIC_MODEL, userCanChoose: true },
  // P11: a second model each, on the fal key; the ElevenLabs model stays the default.
  { id: STUDIO_SFX_PURPOSE, kind: "sfx", allowed: [SFX_MODEL, FAL_SFX_MODEL], default: SFX_MODEL, userCanChoose: true },
  one(STUDIO_VOICE_CHANGER_PURPOSE, "speech", VOICE_CHANGER_MODEL),
  { id: STUDIO_ISOLATE_PURPOSE, kind: "speech", allowed: [ISOLATOR_MODEL, VEED_CLEAN_MODEL], default: ISOLATOR_MODEL, userCanChoose: true },
];

/** The tab's modes in chip order, each with its models (`model` = the default, first of `models`) and purpose. */
export type AudioMode = "music" | "sfx" | "voice-changer" | "isolate";
export const AUDIO_MODES: readonly { mode: AudioMode; label: string; model: string; models: readonly string[]; purpose: string }[] = [
  { mode: "music", label: "Musiqa", model: MUSIC_MODEL, models: [MUSIC_MODEL, LYRIA_MODEL], purpose: STUDIO_MUSIC_PURPOSE },
  { mode: "sfx", label: "Effekt", model: SFX_MODEL, models: [SFX_MODEL, FAL_SFX_MODEL], purpose: STUDIO_SFX_PURPOSE },
  { mode: "voice-changer", label: "Ovozni almashtirish", model: VOICE_CHANGER_MODEL, models: [VOICE_CHANGER_MODEL], purpose: STUDIO_VOICE_CHANGER_PURPOSE },
  { mode: "isolate", label: "Shovqindan tozalash", model: ISOLATOR_MODEL, models: [ISOLATOR_MODEL, VEED_CLEAN_MODEL], purpose: STUDIO_ISOLATE_PURPOSE },
];

export const AUDIO_MODEL_IDS: readonly string[] = AUDIO_MODES.flatMap((m) => m.models);

/** The mode of a catalog model id, `null` when it is not an «Audio» model. */
export function audioModeOf(modelId: string): (typeof AUDIO_MODES)[number] | null {
  return AUDIO_MODES.find((m) => m.models.includes(modelId)) ?? null;
}

/** The model takes an uploaded audio file (voice changer, isolator). */
export function takesAudioInput(entry: Pick<CatalogEntry, "params">): boolean {
  return entry.params.some((p) => p.name === "inputId");
}
