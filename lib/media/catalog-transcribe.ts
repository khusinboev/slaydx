/**
 * Studio P10 (docs/studio/P10-SPEC.md): «Transkripsiya» (ElevenLabs Speech to Text, Scribe v2) and «Dublyaj»
 * (ElevenLabs Dubbing) — two catalog entries, two purposes, two unlisted tools (`studio-transcribe`, `studio-dub`), drawn
 * as two more chips of the Studio «Audio» tab. `catalog.ts` spreads these into `MEDIA_ENTRIES` / `MEDIA_PURPOSES`.
 *
 * Client-safe (no server imports) and NOT importing `catalog.ts` (that file imports this one).
 *
 * SOURCE: one of the user's OWN inputs, named by a typed reference (never a URL):
 *   `upload:<24 hex>`   an uploaded audio file (`studio_audio_inputs`, P6 upload, WAV / MP3, 3–300 s);
 *   `result:<uuid>`     one of the user's finished Studio / legacy media results (video or audio — the «Montaj» source
 *                       list, `lib/server/media/mix-sources.ts`).
 * Ownership is the server's SQL check, before charging and again when the worker loads the bytes.
 *
 * PROVIDER COSTS — the owner's ElevenLabs Creator plan, as P5 / P6: $22 / 121 000 credits
 * (`ELEVENLABS_CREATOR_USD_PER_CREDIT`). Credit rates from https://elevenlabs.io/pricing (read 2026-11-03):
 *   Speech to Text      330 credits / minute of input  = 5.5 / s     ≈ $0.0600 / min
 *   Dubbing (automatic, no watermark — paid plans)  3 000 credits / minute of input = 50 / s  ≈ $0.5455 / min
 * The usage-billed API price list (https://elevenlabs.io/pricing/api, read 2026-11-03) shows Scribe v2 $0.22 / HOUR and
 * Dubbing v1 $0.50 / min without watermark — the STT gap is ×16. UNVERIFIED until one live job of each is compared with
 * the ElevenLabs usage page; the credit basis is kept (the P6 rule, never sells below the subscription's cost), the admin
 * can lower the model's markup in «Media modellari».
 * Price = cost × `media.markup` (×2 default, the model override wins), rounded up to 100 so'm (`studioEntryPrice`), then
 * the tool's `tool_pricing` %. Billed seconds (`sourceSeconds`) are set by the SERVER from the source (never the client).
 *
 * ENDPOINTS (docs read 2026-11-03):
 *   POST /v1/speech-to-text          multipart: file, model_id "scribe_v2", timestamps_granularity "word",
 *                                    tag_audio_events false, diarize, [language_code]
 *                                    https://elevenlabs.io/docs/api-reference/speech-to-text/convert
 *   POST /v1/dubbing                 multipart: file, target_lang, source_lang, num_speakers 0, watermark false
 *                                    → { dubbing_id, expected_duration_sec }
 *   GET  /v1/dubbing/{id}            → { status: "dubbing" | "dubbed" | "failed", error }
 *   GET  /v1/dubbing/{id}/audio/{lang}  the dubbed MP4 (video source) / MP3 (audio source)
 *   DELETE /v1/dubbing/{id}          best-effort cleanup after download / give-up
 *                                    https://elevenlabs.io/docs/api-reference/dubbing/create
 * Languages: Uzbek is in both lists (Scribe «Good» WER tier; Dubbing https://elevenlabs.io/docs/capabilities/dubbing).
 *
 * STUDIO P11 package E (docs/studio/P11-SPEC.md): the same two tools on the fal key alone, for an ElevenLabs key without the
 * speech-to-text or dubbing permission. Each is a model of its own, not a second route: the costs differ, and a user picks.
 * All three ship `defaultOff`; the admin enables one after its live check.
 *   Scribe v2      $0.008 / minute of input audio        https://fal.ai/models/fal-ai/elevenlabs/speech-to-text/scribe-v2/llms.txt
 *                  (read 2026-11-06). UNVERIFIED: the page states no rounding and no minimum; per second is assumed.
 *   Dubbing        $0.6 / minute, the closest minute rounding up: 15 s costs $0.6
 *                                                         https://fal.ai/models/fal-ai/elevenlabs/dubbing/llms.txt (2026-11-06)
 *   HeyGen speed   $0.05 / OUTPUT second; the one model stating «Uzbek (Latin, Uzbekistan)»
 *                                                         https://fal.ai/models/fal-ai/heygen/v2/translate/speed/llms.txt (2026-11-06)
 *                  Video only, 8 minutes at most there; our 3-minute cap holds. The request keeps the output at the source's
 *                  length (`fal-audio-models.ts falDubBody`), so the source's seconds are the quote. UNVERIFIED until live.
 */
import type { CatalogEntry, ParamSchema, PurposeSpec } from "../studio-core";
import { ELEVENLABS_CREATOR_USD_PER_CREDIT } from "../generation/llm-pricing";

export const STUDIO_TRANSCRIBE_PURPOSE = "studio.transcribe";
export const STUDIO_DUB_PURPOSE = "studio.dub";

export const TRANSCRIBE_MODEL = "elevenlabs/scribe-v2";
export const DUB_MODEL = "elevenlabs/dubbing";
export const FAL_SCRIBE_MODEL = "elevenlabs/scribe-v2-fal";
export const FAL_DUB_MODEL = "elevenlabs/dubbing-fal";
export const HEYGEN_TRANSLATE_MODEL = "heygen/translate-speed";

/** fal endpoint ids (the routes' upstream model). */
export const FAL_SCRIBE_ENDPOINT = "fal-ai/elevenlabs/speech-to-text/scribe-v2";
export const FAL_DUB_ENDPOINT = "fal-ai/elevenlabs/dubbing";
export const HEYGEN_TRANSLATE_ENDPOINT = "fal-ai/heygen/v2/translate/speed";

/** Upstream ids sent in the requests. */
export const ELEVENLABS_STT_MODEL = "scribe_v2";
export const ELEVENLABS_DUB_UPSTREAM = "dubbing-automatic";

/** USD per billed second of the fal models (file header, each page's price). */
export const FAL_SCRIBE_USD_PER_SECOND = 0.008 / 60;
export const FAL_DUB_USD_PER_SECOND = 0.6 / 60;
export const HEYGEN_TRANSLATE_USD_PER_SECOND = 0.05;

export const STT_CREDITS_PER_SECOND = 330 / 60;
export const DUB_CREDITS_PER_SECOND = 3000 / 60;

/** Source limits (seconds): a video ≤ 3 min (the «Montaj» rule; a burned result must fit 25 MB), audio ≤ 10 min. */
export const TRANSCRIBE_VIDEO_MAX_SECONDS = 180;
export const TRANSCRIBE_AUDIO_MAX_SECONDS = 600;
/** Dubbing renders while the worker waits (≤ 10 min job): ≤ 3 min of any source. */
export const DUB_MAX_SECONDS = 180;
/** Results are stored like every file (`MAX_FILE_BYTES` = 25 MB). */
export const SPEECH_TOOL_OUTPUT_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Languages offered (both lists — Scribe and Dubbing — name every one; Turkmen is NOT in the dubbing list, so it is not
 * offered). Order: the region first.
 */
export const SPEECH_LANGUAGES: readonly { value: string; label: string }[] = [
  { value: "uz", label: "O‘zbekcha" },
  { value: "ru", label: "Ruscha" },
  { value: "en", label: "Inglizcha" },
  { value: "tr", label: "Turkcha" },
  { value: "kk", label: "Qozoqcha" },
  { value: "ky", label: "Qirg‘izcha" },
  { value: "tg", label: "Tojikcha" },
  { value: "az", label: "Ozarbayjoncha" },
  { value: "ar", label: "Arabcha" },
  { value: "de", label: "Nemischa" },
  { value: "fr", label: "Fransuzcha" },
  { value: "es", label: "Ispancha" },
  { value: "zh", label: "Xitoycha" },
  { value: "ko", label: "Koreyscha" },
  { value: "ja", label: "Yaponcha" },
  { value: "hi", label: "Hindcha" },
];
export const AUTO_LANGUAGE = "auto";
const withAuto = [{ value: AUTO_LANGUAGE, label: "Avtomatik aniqlash" }, ...SPEECH_LANGUAGES];

/**
 * Our language codes as HeyGen's `output_language` enum names them (its page, 2026-11-06). Kyrgyz and Tajik are not in that
 * enum, so they are not offered on this model.
 */
export const HEYGEN_LANGUAGE: Readonly<Record<string, string>> = {
  uz: "Uzbek (Latin, Uzbekistan)",
  ru: "Russian (Russia)",
  en: "English",
  tr: "Turkish (Türkiye)",
  kk: "Kazakh (Kazakhstan)",
  az: "Azerbaijani (Latin, Azerbaijan)",
  ar: "Arabic",
  de: "German (Germany)",
  fr: "French (France)",
  es: "Spanish (Spain)",
  zh: "Chinese (Mandarin, Simplified)",
  ko: "Korean (Korea)",
  ja: "Japanese (Japan)",
  hi: "Hindi (India)",
};

const usdPerSecond = (credits: number): number => credits * ELEVENLABS_CREATOR_USD_PER_CREDIT;

/** `upload:<24 hex>` | `result:<uuid>`. */
export const SOURCE_RE = /^(upload:[0-9a-f]{24}|result:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
export type SourceRef = { kind: "upload"; id: string } | { kind: "result"; id: string };

/** The parsed source reference, `null` when it is not one. */
export function parseSource(raw: unknown): SourceRef | null {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!SOURCE_RE.test(s)) return null;
  const [kind, id] = s.split(":") as ["upload" | "result", string];
  return { kind, id };
}

const sourceParam: ParamSchema = { name: "source", label: "Manba", type: "text", min: 31, max: 43, affects: "request" };
/** Billed length of the source: the SERVER overwrites it before pricing (the P6 `inputSeconds` rule). */
const sourceSecondsParam: ParamSchema = {
  name: "sourceSeconds",
  label: "Manba uzunligi (s)",
  type: "int",
  min: 1,
  max: TRANSCRIBE_AUDIO_MAX_SECONDS,
  default: 1,
  affects: "price",
};

const transcribeParams: readonly ParamSchema[] = [
  sourceParam,
  sourceSecondsParam,
  { name: "language", label: "Nutq tili", type: "enum", options: withAuto, default: AUTO_LANGUAGE, affects: "request" },
  { name: "speakers", label: "Gapiruvchilarni ajratish", hint: "Har replika oldida «1:», «2:» — kim gapirgani", type: "bool", default: false, affects: "request" },
  {
    name: "burn",
    label: "Subtitrni videoga yopishtirish",
    hint: "Natija — subtitr yozilgan MP4 (faqat video manbada)",
    type: "bool",
    default: false,
    affects: "request",
  },
];

const dubParams: readonly ParamSchema[] = [
  sourceParam,
  { ...sourceSecondsParam, max: DUB_MAX_SECONDS },
  { name: "target", label: "Qaysi tilga", type: "enum", options: SPEECH_LANGUAGES, default: "uz", affects: "request" },
  { name: "sourceLang", label: "Asl tili", type: "enum", options: withAuto, default: AUTO_LANGUAGE, affects: "request" },
];

export const STUDIO_TRANSCRIBE_ENTRIES: readonly CatalogEntry[] = [
  {
    id: TRANSCRIBE_MODEL,
    kind: "speech",
    capabilities: ["stt"],
    label: "Transkripsiya",
    maker: "ElevenLabs",
    badges: ["yangi"],
    params: transcribeParams,
    cost: { per: "second", usd: usdPerSecond(STT_CREDITS_PER_SECOND), secondsParam: "sourceSeconds" },
    routes: [{ provider: "elevenlabs", upstreamModel: ELEVENLABS_STT_MODEL, adapter: "studio-elevenlabs-stt" }],
    // Informational: the call's real timeout is the job deadline (budget `studio-transcribe`).
    limits: { timeoutMs: 180_000 },
    output: { mimes: ["application/json"], maxBytes: SPEECH_TOOL_OUTPUT_MAX_BYTES },
  },
  {
    id: DUB_MODEL,
    kind: "speech",
    capabilities: ["dub"],
    label: "Dublyaj",
    maker: "ElevenLabs",
    badges: ["yangi"],
    params: dubParams,
    cost: { per: "second", usd: usdPerSecond(DUB_CREDITS_PER_SECOND), secondsParam: "sourceSeconds" },
    routes: [{ provider: "elevenlabs", upstreamModel: ELEVENLABS_DUB_UPSTREAM, adapter: "studio-elevenlabs-dub" }],
    // Informational, like every sync entry: the dub waits inside the job deadline (budget `studio-dub`, `dub.ts`).
    limits: { timeoutMs: 60_000 },
    output: { mimes: ["video/mp4", "audio/mpeg"], maxBytes: SPEECH_TOOL_OUTPUT_MAX_BYTES },
  },
  {
    id: FAL_SCRIBE_MODEL,
    kind: "speech",
    capabilities: ["stt"],
    label: "Scribe v2 · fal",
    maker: "ElevenLabs",
    badges: ["arzon", "yangi"],
    defaultOff: true,
    params: transcribeParams,
    cost: { per: "second", usd: FAL_SCRIBE_USD_PER_SECOND, secondsParam: "sourceSeconds" },
    routes: [{ provider: "fal", upstreamModel: FAL_SCRIBE_ENDPOINT, adapter: "fal" }],
    limits: { timeoutMs: 180_000 },
    output: { mimes: ["application/json"], maxBytes: SPEECH_TOOL_OUTPUT_MAX_BYTES },
  },
  {
    id: FAL_DUB_MODEL,
    kind: "speech",
    capabilities: ["dub"],
    label: "Dublyaj · fal",
    maker: "ElevenLabs",
    badges: ["yangi"],
    defaultOff: true,
    params: dubParams,
    cost: { per: "second", usd: FAL_DUB_USD_PER_SECOND, secondsParam: "sourceSeconds", unitSeconds: 60 },
    routes: [{ provider: "fal", upstreamModel: FAL_DUB_ENDPOINT, adapter: "fal-dub" }],
    limits: { timeoutMs: 60_000 },
    output: { mimes: ["video/mp4", "audio/mpeg"], maxBytes: SPEECH_TOOL_OUTPUT_MAX_BYTES },
  },
  {
    id: HEYGEN_TRANSLATE_MODEL,
    kind: "speech",
    capabilities: ["dub"],
    label: "Tez tarjima",
    maker: "HeyGen",
    badges: ["yangi"],
    defaultOff: true,
    params: [
      sourceParam,
      { ...sourceSecondsParam, max: DUB_MAX_SECONDS },
      { name: "target", label: "Qaysi tilga", type: "enum", options: SPEECH_LANGUAGES.filter((l) => HEYGEN_LANGUAGE[l.value]), default: "uz", affects: "request" },
      { name: "translateAudioOnly", label: "Faqat ovozni tarjima qilish", hint: "Yuz va lab harakati o‘zgarmaydi", type: "bool", default: false, affects: "request" },
    ],
    cost: { per: "second", usd: HEYGEN_TRANSLATE_USD_PER_SECOND, secondsParam: "sourceSeconds" },
    routes: [{ provider: "fal", upstreamModel: HEYGEN_TRANSLATE_ENDPOINT, adapter: "fal-dub" }],
    limits: { timeoutMs: 60_000 },
    output: { mimes: ["video/mp4"], maxBytes: SPEECH_TOOL_OUTPUT_MAX_BYTES },
  },
];

/** The models of each tool in the picker's order: the first one is the default of a request that names none. */
export const TRANSCRIBE_MODELS: readonly string[] = [TRANSCRIBE_MODEL, FAL_SCRIBE_MODEL];
export const DUB_MODELS: readonly string[] = [DUB_MODEL, FAL_DUB_MODEL, HEYGEN_TRANSLATE_MODEL];

/** The model takes a video only (HeyGen: `video_url` is required, there is no audio input). */
export const videoOnlySource = (modelId: string): boolean => modelId === HEYGEN_TRANSLATE_MODEL;

export const STUDIO_TRANSCRIBE_PURPOSE_SPECS: readonly PurposeSpec[] = [
  { id: STUDIO_TRANSCRIBE_PURPOSE, kind: "speech", allowed: TRANSCRIBE_MODELS, default: TRANSCRIBE_MODEL, userCanChoose: true },
  { id: STUDIO_DUB_PURPOSE, kind: "speech", allowed: DUB_MODELS, default: DUB_MODEL, userCanChoose: true },
];

/** The two P10 tools in the «Audio» tab's chip order (after the provider modes, before «Montaj»). */
export type SpeechToolMode = "transcribe" | "dub";
export const SPEECH_TOOL_MODES: readonly { mode: SpeechToolMode; label: string; model: string; models: readonly string[]; purpose: string; toolId: "studio-transcribe" | "studio-dub" }[] = [
  { mode: "transcribe", label: "Transkripsiya", model: TRANSCRIBE_MODEL, models: TRANSCRIBE_MODELS, purpose: STUDIO_TRANSCRIBE_PURPOSE, toolId: "studio-transcribe" },
  { mode: "dub", label: "Dublyaj", model: DUB_MODEL, models: DUB_MODELS, purpose: STUDIO_DUB_PURPOSE, toolId: "studio-dub" },
];

export const SPEECH_TOOL_MODEL_IDS: readonly string[] = SPEECH_TOOL_MODES.flatMap((m) => m.models);

/** The language label of a code (the viewer, the result line). */
export function languageLabel(code: string | null | undefined): string {
  return withAuto.find((l) => l.value === code)?.label ?? (code ? code.toUpperCase() : "—");
}
