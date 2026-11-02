/**
 * Studio «Ovoz» tab models (docs/studio/P5-SPEC.md) — Gemini TTS, ElevenLabs Eleven v3 (Uzbek), two-speaker dialogue
 * on both, and ElevenLabs Instant Voice Cloning, plus the purposes `studio.speech` / `studio.clone`. `catalog.ts`
 * spreads these into `MEDIA_ENTRIES` / `MEDIA_PURPOSES` (one import, two spreads).
 *
 * Client-safe (no server imports) and NOT importing `catalog.ts` (that file imports this one).
 *
 * PROVIDER COSTS (USD), read 2026-11-02:
 *   ElevenLabs v3        $0.08 per 1 000 characters — https://elevenlabs.io/pricing/api («v3: $0.08»), the same row
 *                        `TTS_PRICING` holds for the podcast / greeting premium voice (one price book).
 *                        NOTE (owner): on the Starter plan ($6 / 30 000 credits, https://elevenlabs.io/pricing) the
 *                        effective cost is $0.20 / 1 000 — see P5-SPEC «Owner actions».
 *   ElevenLabs dialogue  the same v3 character price (text-to-dialogue runs `eleven_v3`, its default model).
 *   Gemini TTS           token-billed: $10 / 1M audio-out tokens + $0.50 / 1M text-in (`TTS_PRICING`, Flash TTS row),
 *                        25 audio tokens / s (`GEMINI_AUDIO_TOKENS_PER_SECOND`). The quote assumes Uzbek speech at
 *                        15 characters / s (`SPEECH_CHARS_PER_SECOND`, a slow reading pace so the quote errs high) and
 *                        3 characters / text token → $0.016833 per 1 000 characters. UNVERIFIED for a Pro TTS model
 *                        (twice the price) in `TTS_GEMINI_MODEL`.
 *   Voice cloning (IVC)  no per-call provider price (included in the plan, uses a voice slot); the user pays the
 *                        fixed `studio.clone_price` setting (owner 2026-11-02: 5 000 so'm), not cost × markup.
 *
 * LIMITS (ElevenLabs model page https://elevenlabs.io/docs/overview/models and text-to-dialogue reference
 * https://elevenlabs.io/docs/api-reference/text-to-dialogue/convert, read 2026-11-02): eleven_v3 5 000 characters per
 * request and lists Uzbek; text-to-dialogue ≤ 2 000 characters across all inputs, ≤ 10 voices. Gemini: one call
 * ≤ 1 400 characters (`TTS_LIMITS.geminiChunkChars`, the timeout lesson of 2026-10-13) — longer single-voice text is
 * split into chunks and joined; a Gemini dialogue is one call.
 *
 * VOICES: the ElevenLabs default (premade) voices by their public ids and Gemini prebuilt voices by name. Gender labels
 * are the providers' own descriptions; how well each one reads Uzbek is UNVERIFIED until a live listen (the Uzbek
 * preview of each voice is what the user judges by, `app/api/media/voices/preview`).
 */
import type { CatalogEntry, ParamSchema, PurposeSpec } from "../studio-core";
import { TTS_PRICING, GEMINI_AUDIO_TOKENS_PER_SECOND } from "../generation/llm-pricing";

export const STUDIO_SPEECH_PURPOSE = "studio.speech";
export const STUDIO_CLONE_PURPOSE = "studio.clone";

/**
 * Longest single-voice text of one Studio job: one eleven_v3 request (≤ 5 000), and the generic form-field cap of
 * `sanitizeValues` (`lib/server/validate.ts MAX_FIELD` = 4 000) — a longer text would be cut on the server and priced
 * differently from the preview (`tests/studio-speech.test.mts` pins both).
 */
export const STUDIO_SPEECH_MAX_CHARS = 4_000;
/** Longest ElevenLabs dialogue script (text-to-dialogue: ≤ 2 000 characters across inputs). */
export const ELEVENLABS_DIALOGUE_MAX_CHARS = 2_000;
/** Longest Gemini dialogue script (one multi-speaker call, `TTS_LIMITS.geminiChunkChars`). */
export const GEMINI_DIALOGUE_MAX_CHARS = 1_400;
/** Speech pace the «~N s» estimate and the Gemini quote assume (characters per second of audio). */
export const SPEECH_CHARS_PER_SECOND = 15;

export const ELEVENLABS_V3_MODEL = "eleven_v3";

/** The sentence every voice preview speaks (library voices once each, a clone right after it is made). */
export const VOICE_PREVIEW_TEXT = "Assalomu alaykum! Matningiz shu ovoz bilan o‘zbek tilida mana shunday yangraydi.";

/** Preview key of a library voice / a clone (`studio_voice_previews.voice_key`, the preview endpoint's `voice`). */
export const previewKeyOf = (provider: "elevenlabs" | "gemini", id: string): string => `${provider}:${id}`;

export type VoiceGender = "female" | "male";
export type LibraryVoice = { id: string; name: string; gender: VoiceGender };

/** ElevenLabs default voices (public premade ids; Rachel / Adam are the podcast's premium voices). */
export const ELEVENLABS_VOICES: readonly LibraryVoice[] = [
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", gender: "female" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", gender: "female" },
  { id: "FGY2WhTYpPnrIDTdsKH5", name: "Laura", gender: "female" },
  { id: "Xb7hH8MSUJpSbSDYk0k2", name: "Alice", gender: "female" },
  { id: "XrExE9yKIg1WjnnlVkGX", name: "Matilda", gender: "female" },
  { id: "pNInz6obpgDQGcFmaJgB", name: "Adam", gender: "male" },
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George", gender: "male" },
  { id: "nPczCjzI2devNBz1zQrb", name: "Brian", gender: "male" },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel", gender: "male" },
  { id: "TX3LPaxmHKxFdv7VOQHJ", name: "Liam", gender: "male" },
];

/** Gemini prebuilt voices (language-neutral; `Kore` / `Charon` are the podcast's female / male voices). */
export const GEMINI_VOICES: readonly LibraryVoice[] = [
  { id: "Kore", name: "Kore", gender: "female" },
  { id: "Aoede", name: "Aoede", gender: "female" },
  { id: "Leda", name: "Leda", gender: "female" },
  { id: "Zephyr", name: "Zephyr", gender: "female" },
  { id: "Despina", name: "Despina", gender: "female" },
  { id: "Sulafat", name: "Sulafat", gender: "female" },
  { id: "Charon", name: "Charon", gender: "male" },
  { id: "Puck", name: "Puck", gender: "male" },
  { id: "Fenrir", name: "Fenrir", gender: "male" },
  { id: "Orus", name: "Orus", gender: "male" },
  { id: "Algenib", name: "Algenib", gender: "male" },
  { id: "Achird", name: "Achird", gender: "male" },
];

/** A user's own clone as a voice value: `clone:<studio_voices.id>` (resolved to the provider id on the server only). */
export const CLONE_VOICE_PREFIX = "clone:";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function cloneIdOf(voice: unknown): string | null {
  const v = typeof voice === "string" ? voice.trim().toLowerCase() : "";
  if (!v.startsWith(CLONE_VOICE_PREFIX)) return null;
  const id = v.slice(CLONE_VOICE_PREFIX.length);
  return UUID_RE.test(id) ? id : null;
}

/** eleven_v3 languages of our 18 (`lib/generation/tts/elevenlabs.ts V3_LANGS`, a test keeps them equal). */
export const ELEVENLABS_LANGS: readonly { value: string; label: string }[] = [
  { value: "uz", label: "O‘zbekcha" },
  { value: "ru", label: "Ruscha" },
  { value: "en", label: "Inglizcha" },
  { value: "kk", label: "Qozoqcha" },
  { value: "ky", label: "Qirg‘izcha" },
  { value: "tg", label: "Tojikcha" },
  { value: "tr", label: "Turkcha" },
  { value: "ar", label: "Arabcha" },
  { value: "de", label: "Nemischa" },
  { value: "fr", label: "Fransuzcha" },
  { value: "es", label: "Ispancha" },
  { value: "it", label: "Italyancha" },
  { value: "pt", label: "Portugalcha" },
  { value: "zh", label: "Xitoycha" },
  { value: "ja", label: "Yaponcha" },
  { value: "ko", label: "Koreyscha" },
];

/** USD per 1 000 characters, from the price book (`TTS_PRICING`); a missing row fails at load. */
function elevenLabsUsdPerKchar(): number {
  const row = TTS_PRICING.find((r) => r.billing === "chars" && r.provider === "elevenlabs");
  if (!row || !("usdPerMChars" in row) || !(row.usdPerMChars > 0)) throw new Error("catalog-speech: no ElevenLabs price row");
  return row.usdPerMChars / 1000;
}

/** Gemini Flash TTS quote per 1 000 characters (file header: 15 chars / s, 25 audio tokens / s, 3 chars / text token). */
export function geminiUsdPerKchar(): number {
  const row = TTS_PRICING.find((r) => r.billing === "tokens" && r.provider === "gemini" && "model" in r && r.model === "gemini-2.5-flash-preview-tts");
  if (!row || !("outUsdPerM" in row)) throw new Error("catalog-speech: no Gemini TTS price row");
  const audioTokens = (1000 / SPEECH_CHARS_PER_SECOND) * GEMINI_AUDIO_TOKENS_PER_SECOND;
  const textTokens = 1000 / 3;
  return Number(((audioTokens * row.outUsdPerM + textTokens * row.inUsdPerM) / 1e6).toFixed(6));
}

const voiceEnum = (name: string, label: string, def: string): ParamSchema => ({
  name,
  label,
  type: "enum",
  options: GEMINI_VOICES.map((v) => ({ value: v.id, label: v.name })),
  default: def,
  affects: "request",
});

/** ElevenLabs voice: a library id or the user's own clone (`clone:<id>`), checked by `speechVoiceError` before charging. */
const elevenVoice = (name: string, label: string, def: string): ParamSchema => ({ name, label, type: "voice", source: "user-clones", default: def, affects: "request" });

const textParam = (name: string, label: string, max: number): ParamSchema => ({ name, label, type: "text", min: 1, max, affects: "both" });

const langParam: ParamSchema = { name: "lang", label: "Til", hint: "Matn tili", type: "enum", options: ELEVENLABS_LANGS, default: "uz", affects: "request", advanced: true };

/** «Kayfiyat»: eleven_v3 stability — Creative 0 / Natural 0.5 / Robust 1 (lower = wider emotional range). */
const moodParam: ParamSchema = {
  name: "stability",
  label: "Kayfiyat",
  hint: "Ifodali — hissiyotli, barqaror — bir tekis",
  type: "enum",
  options: [
    { value: "0", label: "Ifodali" },
    { value: "0.5", label: "Tabiiy" },
    { value: "1", label: "Barqaror" },
  ],
  default: "0.5",
  affects: "request",
};

/** «Tezlik»: `voice_settings.speed` (documented 0.7–1.2; 1 sends no speed, as the podcast does). */
const speedParam: ParamSchema = {
  name: "speed",
  label: "Tezlik",
  type: "enum",
  options: [
    { value: "0.8", label: "Sekin" },
    { value: "0.9", label: "0.9×" },
    { value: "1", label: "Oddiy" },
    { value: "1.1", label: "1.1×" },
    { value: "1.2", label: "Tez" },
  ],
  default: "1",
  affects: "request",
};

const AUDIO_OUT = { mimes: ["audio/mpeg"], maxBytes: 25 * 1024 * 1024 } as const;
const TIMEOUT = { timeoutMs: 120_000 } as const;

export const STUDIO_SPEECH_ENTRIES: readonly CatalogEntry[] = [
  {
    id: "google/gemini-tts",
    kind: "speech",
    capabilities: ["tts"],
    label: "Gemini TTS",
    maker: "Google",
    badges: ["arzon", "tez"],
    params: [textParam("text", "Matn", STUDIO_SPEECH_MAX_CHARS), voiceEnum("voice", "Ovoz", "Kore")],
    cost: { per: "kchar", usd: geminiUsdPerKchar(), textParam: "text" },
    // The upstream is the operator's `TTS_GEMINI_MODEL` (the host swaps it in); without it the model is not offered.
    routes: [{ provider: "gemini", upstreamModel: "gemini-tts", adapter: "studio-gemini-tts" }],
    limits: TIMEOUT,
    output: AUDIO_OUT,
  },
  {
    id: "elevenlabs/eleven-v3",
    kind: "speech",
    capabilities: ["tts"],
    label: "ElevenLabs v3",
    maker: "ElevenLabs",
    badges: ["sifatli"],
    params: [textParam("text", "Matn", STUDIO_SPEECH_MAX_CHARS), elevenVoice("voice", "Ovoz", ELEVENLABS_VOICES[0]!.id), speedParam, moodParam, langParam],
    cost: { per: "kchar", usd: elevenLabsUsdPerKchar(), textParam: "text" },
    routes: [{ provider: "elevenlabs", upstreamModel: ELEVENLABS_V3_MODEL, adapter: "studio-elevenlabs-tts" }],
    limits: TIMEOUT,
    output: AUDIO_OUT,
  },
  {
    id: "elevenlabs/v3-dialogue",
    kind: "speech",
    capabilities: ["dialogue"],
    label: "ElevenLabs suhbat",
    maker: "ElevenLabs",
    badges: ["sifatli"],
    params: [
      textParam("script", "Suhbat matni", ELEVENLABS_DIALOGUE_MAX_CHARS),
      elevenVoice("voice1", "1-ovoz", ELEVENLABS_VOICES[0]!.id),
      elevenVoice("voice2", "2-ovoz", ELEVENLABS_VOICES[5]!.id),
      moodParam,
      langParam,
    ],
    cost: { per: "kchar", usd: elevenLabsUsdPerKchar(), textParam: "script" },
    routes: [{ provider: "elevenlabs", upstreamModel: ELEVENLABS_V3_MODEL, adapter: "studio-elevenlabs-dialogue" }],
    limits: TIMEOUT,
    output: AUDIO_OUT,
  },
  {
    id: "google/gemini-dialogue",
    kind: "speech",
    capabilities: ["dialogue"],
    label: "Gemini suhbat",
    maker: "Google",
    badges: ["arzon"],
    params: [textParam("script", "Suhbat matni", GEMINI_DIALOGUE_MAX_CHARS), voiceEnum("voice1", "1-ovoz", "Kore"), voiceEnum("voice2", "2-ovoz", "Charon")],
    cost: { per: "kchar", usd: geminiUsdPerKchar(), textParam: "script" },
    routes: [{ provider: "gemini", upstreamModel: "gemini-tts", adapter: "studio-gemini-dialogue" }],
    limits: TIMEOUT,
    output: AUDIO_OUT,
  },
  {
    id: "elevenlabs/voice-clone",
    kind: "speech",
    capabilities: ["clone"],
    label: "Ovoz klonlash",
    maker: "ElevenLabs",
    badges: [],
    params: [
      { name: "name", label: "Ovoz nomi", type: "text", min: 1, max: 40, affects: "request" },
      { name: "sampleId", label: "Yozuv", type: "text", min: 24, max: 24, affects: "request" },
    ],
    // No per-call provider price; the fixed `studio.clone_price` is the price (file header).
    cost: { per: "job", usd: 0 },
    routes: [{ provider: "elevenlabs", upstreamModel: "ivc", adapter: "elevenlabs-clone" }],
    limits: { timeoutMs: 90_000 },
    output: { mimes: ["application/json"], maxBytes: 4096 },
  },
];

/** Order = the picker's order; ElevenLabs v3 (the Uzbek-listed model) first, Gemini the cheaper alternative. */
export const STUDIO_SPEECH_PURPOSE_SPEC: PurposeSpec = {
  id: STUDIO_SPEECH_PURPOSE,
  kind: "speech",
  allowed: ["elevenlabs/eleven-v3", "google/gemini-tts", "elevenlabs/v3-dialogue", "google/gemini-dialogue"],
  default: "elevenlabs/eleven-v3",
  userCanChoose: true,
};

export const STUDIO_CLONE_PURPOSE_SPEC: PurposeSpec = {
  id: STUDIO_CLONE_PURPOSE,
  kind: "speech",
  allowed: ["elevenlabs/voice-clone"],
  default: "elevenlabs/voice-clone",
  userCanChoose: false,
};

/** Library voices a speech model offers (ElevenLabs models also take the user's clone). */
export function libraryVoicesOf(modelId: string): readonly LibraryVoice[] {
  return modelId.startsWith("elevenlabs/") ? ELEVENLABS_VOICES : modelId.startsWith("google/") ? GEMINI_VOICES : [];
}

/** The speech model takes a user clone as a voice (its voice params are `type: "voice"`). */
export function takesClones(entry: Pick<CatalogEntry, "params">): boolean {
  return entry.params.some((p) => p.type === "voice");
}

/** Names of the voice params of a model, in order (`voice` or `voice1`, `voice2`). */
export function voiceParamsOf(entry: Pick<CatalogEntry, "params">): string[] {
  return entry.params.filter((p) => p.name === "voice" || /^voice\d$/.test(p.name)).map((p) => p.name);
}
