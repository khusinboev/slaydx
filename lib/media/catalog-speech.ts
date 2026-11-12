/**
 * Studio «Ovoz» tab models (docs/studio/P5-SPEC.md) — Gemini TTS, ElevenLabs Eleven v4 (Uzbek), two-speaker dialogue
 * on both, and ElevenLabs Instant Voice Cloning, plus the purposes `studio.speech` / `studio.clone`. `catalog.ts`
 * spreads these into `MEDIA_ENTRIES` / `MEDIA_PURPOSES` (one import, two spreads).
 *
 * Client-safe (no server imports) and NOT importing `catalog.ts` (that file imports this one).
 *
 * MODEL (measured LIVE on production 2026-11-12): the direct ElevenLabs calls run `eleven_v4` — `eleven_v3` answers
 * `language_code: "uz"` with 400 `unsupported_language` (text-to-speech and text-to-dialogue alike; `uz` is not in v3's
 * 74 languages any more), `eleven_v4` takes it (94 languages, 10 000 characters per request, cost multiplier 1). The
 * catalog ids `elevenlabs/eleven-v3` / `elevenlabs/v3-dialogue` are KEPT (only the label says v4): they are persisted in
 * `media_jobs.model_id`, `doc_json.speech.model`, the «Media modellari» switches and per-model price overrides — a new id
 * would orphan all of them, and nothing outside this file reads the id as a model version.
 *
 * PROVIDER COSTS (USD), read 2026-11-02 (re-read 2026-11-12):
 *   ElevenLabs v4        the REAL plan cost (owner decision 2026-11-02): Creator $22 / 121 000 credits ≈ $0.1818 per
 *                        1 000 characters (https://elevenlabs.io/pricing) — the `TTS_PRICING` row
 *                        (`ELEVENLABS_CREATOR_USD_PER_M_CHARS`), one price book with the podcast's cost telemetry. The
 *                        API list price ($0.08 for v4 and v3, https://elevenlabs.io/pricing/api) is not what the owner
 *                        pays. Kept at 1 credit per character although a live 160-character v4 request reported
 *                        `character-cost: 71` (2026-11-12): one sample is no rate, and the higher figure errs for the house.
 *   ElevenLabs dialogue  the same character price (text-to-dialogue with `model_id: eleven_v4`).
 *   Gemini TTS           token-billed: $10 / 1M audio-out tokens + $0.50 / 1M text-in (`TTS_PRICING`, Flash TTS row),
 *                        25 audio tokens / s (`GEMINI_AUDIO_TOKENS_PER_SECOND`). The quote assumes Uzbek speech at
 *                        15 characters / s (`SPEECH_CHARS_PER_SECOND`, a slow reading pace so the quote errs high) and
 *                        3 characters / text token → $0.016833 per 1 000 characters. UNVERIFIED for a Pro TTS model
 *                        (twice the price) in `TTS_GEMINI_MODEL`.
 *   fal ElevenLabs       P11 package E, `defaultOff`, the fal key alone:
 *                        Eleven v3 $0.10 / 1 000 characters, https://fal.ai/models/fal-ai/elevenlabs/tts/eleven-v3/llms.txt
 *                        Eleven v4 Turbo $0.04 / 1 000 characters, https://fal.ai/models/elevenlabs/tts/eleven-v4-turbo/llms.txt
 *                        (both read 2026-11-06). Neither page lists Uzbek: a live Uzbek test comes before the admin's switch.
 *   Voice cloning (IVC)  no per-call provider price (included in the plan, uses a voice slot); the user pays the
 *                        fixed `studio.clone_price` setting (owner 2026-11-02: 5 000 so'm), not cost × markup.
 *
 * LIMITS (live `GET /v1/models` 2026-11-12 and the text-to-dialogue reference
 * https://elevenlabs.io/docs/api-reference/text-to-dialogue/convert, read 2026-11-02): eleven_v4 10 000 characters per
 * request and takes Uzbek; text-to-dialogue ≤ 2 000 characters across all inputs, ≤ 10 voices. Gemini: one call
 * ≤ 1 400 characters (`TTS_LIMITS.geminiChunkChars`, the timeout lesson of 2026-10-13) — longer single-voice text is
 * split into chunks and joined; a Gemini dialogue is one call.
 *
 * VOICES: the 14 native Uzbek voices of the ElevenLabs voice library (`GET /v1/shared-voices?language=uz`, 2026-11-12),
 * the ElevenLabs default (premade) voices by their public ids, and Gemini prebuilt voices by name. A library voice is
 * used by id in text-to-speech / text-to-dialogue WITHOUT adding it to the account (no voice slot; verified 200 OK on
 * production 2026-11-12, `category: professional`, `rate: 1` = no surcharge, verified for the v4 family only). All 14
 * are male speakers (the first one's provider gender label says "female" but its description says "young adult male
 * voice": stored male); the library has no female native-Uzbek voice — the premade female voices read Uzbek through v4.
 * Gender labels are the providers' own descriptions; how well each one sounds is judged by its Uzbek preview
 * (`app/api/media/voices/preview`).
 */
import type { CatalogEntry, ParamSchema, PurposeSpec } from "../studio-core";
import { TTS_PRICING, GEMINI_AUDIO_TOKENS_PER_SECOND } from "../generation/llm-pricing";

export const STUDIO_SPEECH_PURPOSE = "studio.speech";
export const STUDIO_CLONE_PURPOSE = "studio.clone";

/**
 * Longest single-voice text of one Studio job: under one eleven_v4 request (≤ 10 000), and the generic form-field cap of
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

/** The direct ElevenLabs model (`lib/generation/tts/elevenlabs.ts ELEVENLABS_MODEL`, a test keeps them equal). */
export const ELEVENLABS_DIRECT_MODEL = "eleven_v4";
/** Characters of one `eleven_v4` request (live `GET /v1/models`, 2026-11-12). */
export const ELEVENLABS_DIRECT_MAX_CHARS = 10_000;

export const FAL_ELEVEN_V3_MODEL = "elevenlabs/eleven-v3-fal";
export const FAL_ELEVEN_V4_TURBO_MODEL = "elevenlabs/eleven-v4-turbo-fal";
/** fal endpoint ids (the routes' upstream model). */
export const FAL_ELEVEN_V3_ENDPOINT = "fal-ai/elevenlabs/tts/eleven-v3";
export const FAL_ELEVEN_V4_TURBO_ENDPOINT = "elevenlabs/tts/eleven-v4-turbo";

/** The sentence every voice preview speaks (library voices once each, a clone right after it is made). */
export const VOICE_PREVIEW_TEXT = "Assalomu alaykum! Matningiz shu ovoz bilan o‘zbek tilida mana shunday yangraydi.";

/** Preview key of a library voice / a clone (`studio_voice_previews.voice_key`, the preview endpoint's `voice`). */
export const previewKeyOf = (provider: "elevenlabs" | "gemini", id: string): string => `${provider}:${id}`;

export type VoiceGender = "female" | "male";
/**
 * A library voice. `native: true` + `lang` = a native speaker of that language (the 14 Uzbek ElevenLabs library voices),
 * `note` its short Uzbek style line for the list («Diktor», «Suhbat»…).
 */
export type LibraryVoice = { id: string; name: string; gender: VoiceGender; lang?: "uz"; note?: string; native?: true };

const uz = (id: string, name: string, note: string): LibraryVoice => ({ id, name, gender: "male", lang: "uz", note, native: true });

/**
 * Native Uzbek voices of the ElevenLabs voice library (`GET /v1/shared-voices?language=uz`, production 2026-11-12; the
 * provider's own descriptions → the Uzbek note). JaysonKhan, Shohjahon and Mirzabek are `free_users_allowed: false`,
 * which does not concern the paid Creator key. Davronbek (the most used one) is the default Uzbek voice.
 */
export const ELEVENLABS_UZBEK_VOICES: readonly LibraryVoice[] = [
  uz("agoC45V78njTIxYzwmSb", "Davronbek", "Jurnalist, salobatli"),
  uz("AgD9yC0DyOI1g9AP3l45", "Javohir", "Sokin, tabiiy"),
  uz("ehTFHBkERkWR22A3sR8M", "JaysonKhan", "Ta’limiy"),
  uz("tQBN3grEhnGrrqn0n2Rw", "Samariddin Siroj", "Suhbat"),
  uz("cfWx14ZbaEUT4BjIA5tH", "Mirjalol", "Diktor, ishonchli"),
  uz("tsHbvXAh0M61xzsgDqlk", "Firdavs Urinov", "Diktor"),
  uz("1xZ621W54CwGT3dITE48", "Bahriddin", "Ma’lumot beruvchi"),
  uz("nXdUXfIGcAbTyJ2kC04t", "Abror", "Kitob va darslik"),
  uz("GChwNsPvTsqD6tAAORVU", "Shohjahon", "Ta’limiy, tarix"),
  uz("CBeZJ4EnTnrJmhtlMCNC", "Sodiqjon", "Suhbat, erkin"),
  uz("rwtcHtZgYU6HN2zLNBlf", "Sarhad Siz", "Diktor, aniq"),
  uz("fytsqG6MLzC2aCSw7MLa", "Asilbek", "Reklama"),
  uz("RaNVfTYq3HYeFPLng6XN", "Mirzaev", "Samimiy suhbat"),
  uz("GcnlXfqDudh5dSQpZVll", "Mirzabek", "Qat’iy, talabchan"),
];

/** ElevenLabs default voices (public premade ids; Rachel / Adam are the podcast's premium voices). */
const ELEVENLABS_PREMADE_VOICES: readonly LibraryVoice[] = [
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

/**
 * Every ElevenLabs library voice the direct models speak: the premade ones (first — the voice changer's default and
 * older indices) then the native Uzbek ones. The lists show native voices first (`uzbekFirst`).
 */
export const ELEVENLABS_VOICES: readonly LibraryVoice[] = [...ELEVENLABS_PREMADE_VOICES, ...ELEVENLABS_UZBEK_VOICES];

const voiceId = (name: string): string => {
  const v = ELEVENLABS_VOICES.find((x) => x.name === name);
  if (!v) throw new Error(`catalog-speech: no voice ${name}`);
  return v.id;
};
/** Default voices of the direct ElevenLabs models: native Uzbek for Uzbek text, else the premade pair. */
export const ELEVENLABS_DEFAULT_VOICES = {
  uz: [voiceId("Davronbek"), voiceId("Javohir")],
  other: [voiceId("Rachel"), voiceId("Adam")],
} as const;

/** The default voice of speaker `index` (0 or 1) for a text language (`lang` param; blank = Uzbek, the default). */
export function defaultElevenVoice(lang: unknown, index = 0): string {
  const l = String(lang ?? "").trim().toLowerCase();
  const pair = !l || l === "uz" ? ELEVENLABS_DEFAULT_VOICES.uz : ELEVENLABS_DEFAULT_VOICES.other;
  return pair[index === 1 ? 1 : 0];
}

/** Native voices first, the others after, each group in its listed order. */
export function uzbekFirst<T extends Pick<LibraryVoice, "native">>(list: readonly T[]): T[] {
  return [...list.filter((v) => v.native), ...list.filter((v) => !v.native)];
}

/**
 * The library voices the voice changer (speech-to-speech, `eleven_multilingual_sts_v2`) offers: the premade ones only.
 * UNVERIFIED whether speech-to-speech takes a shared-library voice that is not in the account (only text-to-speech and
 * text-to-dialogue were tested, 2026-11-12) — the native Uzbek voices stay out of it until a live test says so.
 */
export const ELEVENLABS_STS_VOICES: readonly LibraryVoice[] = ELEVENLABS_PREMADE_VOICES;

/**
 * The library voices fal's ElevenLabs models can speak: those both pages name, by name (Rachel is their default). Adam is in
 * neither list, and a user's clone lives in an account fal does not reach. Those two pages say nothing on other voices.
 */
const FAL_ELEVEN_VOICE_NAMES: ReadonlySet<string> = new Set(["Rachel", "Sarah", "Laura", "Alice", "Matilda", "George", "Brian", "Daniel", "Liam"]);
export const FAL_ELEVEN_VOICES: readonly LibraryVoice[] = ELEVENLABS_PREMADE_VOICES.filter((v) => FAL_ELEVEN_VOICE_NAMES.has(v.name));

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

/** Languages of our 18 sent as `language_code` (`lib/generation/tts/elevenlabs.ts ELEVENLABS_LANG_CODES`, a test keeps them equal). */
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

/** «Kayfiyat»: ElevenLabs stability — Creative 0 / Natural 0.5 / Robust 1 (lower = wider emotional range). */
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

/** A voice of the fal models: a list, not a `voice` param, so no clone can be picked or sent. */
const falVoiceParam: ParamSchema = { name: "voice", label: "Ovoz", type: "enum", options: FAL_ELEVEN_VOICES.map((v) => ({ value: v.id, label: v.name })), default: FAL_ELEVEN_VOICES[0]!.id, affects: "request" };

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
    // Id kept for persisted rows (file header); the model is eleven_v4.
    label: "ElevenLabs v4",
    maker: "ElevenLabs",
    badges: ["sifatli"],
    params: [textParam("text", "Matn", STUDIO_SPEECH_MAX_CHARS), elevenVoice("voice", "Ovoz", defaultElevenVoice("uz")), speedParam, moodParam, langParam],
    cost: { per: "kchar", usd: elevenLabsUsdPerKchar(), textParam: "text" },
    routes: [{ provider: "elevenlabs", upstreamModel: ELEVENLABS_DIRECT_MODEL, adapter: "studio-elevenlabs-tts" }],
    limits: TIMEOUT,
    output: AUDIO_OUT,
  },
  {
    id: FAL_ELEVEN_V3_MODEL,
    kind: "speech",
    capabilities: ["tts"],
    label: "ElevenLabs v3 · fal",
    maker: "ElevenLabs",
    badges: ["sifatli", "yangi"],
    defaultOff: true,
    params: [textParam("text", "Matn", STUDIO_SPEECH_MAX_CHARS), falVoiceParam, moodParam, langParam],
    cost: { per: "kchar", usd: 0.1, textParam: "text" },
    routes: [{ provider: "fal", upstreamModel: FAL_ELEVEN_V3_ENDPOINT, adapter: "fal" }],
    limits: TIMEOUT,
    output: AUDIO_OUT,
  },
  {
    id: FAL_ELEVEN_V4_TURBO_MODEL,
    kind: "speech",
    capabilities: ["tts"],
    label: "ElevenLabs v4 Turbo · fal",
    maker: "ElevenLabs",
    badges: ["arzon", "tez", "yangi"],
    defaultOff: true,
    params: [textParam("text", "Matn", STUDIO_SPEECH_MAX_CHARS), falVoiceParam, moodParam, langParam],
    cost: { per: "kchar", usd: 0.04, textParam: "text" },
    routes: [{ provider: "fal", upstreamModel: FAL_ELEVEN_V4_TURBO_ENDPOINT, adapter: "fal" }],
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
      elevenVoice("voice1", "1-ovoz", defaultElevenVoice("uz", 0)),
      elevenVoice("voice2", "2-ovoz", defaultElevenVoice("uz", 1)),
      moodParam,
      langParam,
    ],
    cost: { per: "kchar", usd: elevenLabsUsdPerKchar(), textParam: "script" },
    routes: [{ provider: "elevenlabs", upstreamModel: ELEVENLABS_DIRECT_MODEL, adapter: "studio-elevenlabs-dialogue" }],
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

/** Order = the picker's order; ElevenLabs v4 (the Uzbek model) first, Gemini the cheaper alternative. */
export const STUDIO_SPEECH_PURPOSE_SPEC: PurposeSpec = {
  id: STUDIO_SPEECH_PURPOSE,
  kind: "speech",
  allowed: ["elevenlabs/eleven-v3", "google/gemini-tts", FAL_ELEVEN_V3_MODEL, FAL_ELEVEN_V4_TURBO_MODEL, "elevenlabs/v3-dialogue", "google/gemini-dialogue"],
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
  if (modelId === FAL_ELEVEN_V3_MODEL || modelId === FAL_ELEVEN_V4_TURBO_MODEL) return FAL_ELEVEN_VOICES;
  return modelId.startsWith("elevenlabs/") ? ELEVENLABS_VOICES : modelId.startsWith("google/") ? GEMINI_VOICES : [];
}

/** Of the library the voices endpoint listed, what this model can speak. */
export function offeredVoices(modelId: string, listed: readonly LibraryVoice[]): readonly LibraryVoice[] {
  if (modelId !== FAL_ELEVEN_V3_MODEL && modelId !== FAL_ELEVEN_V4_TURBO_MODEL) return listed;
  return listed.filter((v) => FAL_ELEVEN_VOICE_NAMES.has(v.name));
}

/** The speech model takes a user clone as a voice (its voice params are `type: "voice"`). */
export function takesClones(entry: Pick<CatalogEntry, "params">): boolean {
  return entry.params.some((p) => p.type === "voice");
}

/** Names of the voice params of a model, in order (`voice` or `voice1`, `voice2`). */
export function voiceParamsOf(entry: Pick<CatalogEntry, "params">): string[] {
  return entry.params.filter((p) => p.name === "voice" || /^voice\d$/.test(p.name)).map((p) => p.name);
}
