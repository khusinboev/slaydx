/**
 * Studio P11 package E: request builders of the fal audio endpoints (docs/studio/P11-SPEC.md «E and F»). Pure. Every field
 * below is from the endpoint's own page, https://fal.ai/models/<endpoint>/llms.txt, read 2026-11-06; what a page does not
 * state is marked UNVERIFIED and is on the owner's live-check list.
 *
 * Outputs are downloaded through the fal adapter's safe path and their type is sniffed from the bytes: the `content_type` an
 * answer carries is never read.
 */
import { MediaError, type AdapterAsset, type NormalizedParams } from "../../studio-core";
import { FAL_SFX_ENDPOINT, VEED_CLEAN_ENDPOINT, VEED_CLEAN_MAX_OUTPUT_BYTES } from "../catalog-audio";
import { FAL_ELEVEN_V3_ENDPOINT, FAL_ELEVEN_V4_TURBO_ENDPOINT, ELEVENLABS_VOICES } from "../catalog-speech";
import { AUTO_LANGUAGE, FAL_DUB_ENDPOINT, FAL_SCRIBE_ENDPOINT, HEYGEN_LANGUAGE, HEYGEN_TRANSLATE_ENDPOINT, SPEECH_TOOL_OUTPUT_MAX_BYTES } from "../catalog-transcribe";
import { FAL_FILE_PENDING, FAL_RETENTION_SEC } from "./fal-storage";
import type { FalModel } from "./fal";

const bool = (v: unknown): boolean => v === true || v === "true";
const AUDIO_MP3 = { mimes: ["audio/mpeg"], maxBytes: SPEECH_TOOL_OUTPUT_MAX_BYTES } as const;
/** The `output_format` value of the SFX and v4 Turbo pages (their default, sent so a change at fal cannot change our file). */
const MP3_FORMAT = "mp3_44100_128";

/**
 * Scribe's `language_code` examples are ISO 639-3 («eng», «spa», «fra», «deu», «jpn»), while our form holds ISO 639-1. Only
 * those five are stated: UNVERIFIED for the others, Uzbek included. The answer's code is mapped back (`falSttResult`).
 */
export const SCRIBE_LANGUAGE: Readonly<Record<string, string>> = {
  uz: "uzb",
  ru: "rus",
  en: "eng",
  tr: "tur",
  kk: "kaz",
  ky: "kir",
  tg: "tgk",
  az: "aze",
  ar: "ara",
  de: "deu",
  fr: "fra",
  es: "spa",
  zh: "zho",
  ko: "kor",
  ja: "jpn",
  hi: "hin",
};
const SCRIBE_BACK: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(SCRIBE_LANGUAGE).map(([k, v]) => [v, k]));

/**
 * The answer of Scribe in the shape the engine reads (`transcribe-studio.ts sttResultOf`), `null` when it is not a
 * transcript. `words` is a list in the page's schema; its example response prints one object, so both are read.
 */
export function falSttResult(result: unknown): { text: string; language_code: string | null; words: unknown[] } | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const r = result as Record<string, unknown>;
  if (typeof r.text !== "string") return null;
  const words = Array.isArray(r.words) ? r.words : r.words && typeof r.words === "object" ? [r.words] : null;
  if (!words) return null;
  const code = typeof r.language_code === "string" ? r.language_code : null;
  return { text: r.text, language_code: code ? (SCRIBE_BACK[code] ?? code) : null, words };
}

/**
 * The voice names the pages list, by our library's ids: the voice travels as a NAME. A user's clone lives in the owner's
 * ElevenLabs account, which fal cannot reach, so these models take none (`catalog-speech.ts FAL_ELEVEN_VOICES`).
 */
function voiceName(p: NormalizedParams): string {
  const id = String(p.voice ?? "").trim();
  const hit = ELEVENLABS_VOICES.find((v) => v.id === id);
  if (!hit) throw new MediaError("fal", "voice is not a library voice");
  return hit.name;
}

function speechBody(p: NormalizedParams): Record<string, unknown> {
  const text = String(p.text ?? "").trim();
  if (!text) throw new MediaError("fal", "no text to speak");
  return {
    text,
    voice: voiceName(p),
    stability: Number(p.stability),
    // Both pages: «Language code (ISO 639-1)». Neither lists the codes: a live Uzbek test comes before the switch.
    language_code: String(p.lang ?? "uz"),
    apply_text_normalization: "auto",
  };
}

export const FAL_AUDIO_MODELS: Readonly<Record<string, FalModel>> = {
  // https://fal.ai/models/fal-ai/elevenlabs/speech-to-text/scribe-v2/llms.txt (2026-11-06). `tag_audio_events` and `diarize`
  // default to true there; both are sent. `keyterms` is not offered (it adds 30 % to the price).
  [FAL_SCRIBE_ENDPOINT]: {
    fileInput: true,
    retentionSec: FAL_RETENTION_SEC,
    json: falSttResult,
    body: (p, _i, url) => {
      const lang = String(p.language ?? AUTO_LANGUAGE);
      return { audio_url: url, tag_audio_events: false, diarize: bool(p.speakers), ...(lang !== AUTO_LANGUAGE && SCRIBE_LANGUAGE[lang] ? { language_code: SCRIBE_LANGUAGE[lang] } : {}) };
    },
  },
  // https://fal.ai/models/elevenlabs/sound-effects/v3/llms.txt (2026-11-06). The prompt's length limit is not stated:
  // UNVERIFIED, the older ElevenLabs model's 450 is kept.
  [FAL_SFX_ENDPOINT]: {
    resultFile: "audio",
    retentionSec: FAL_RETENTION_SEC,
    output: AUDIO_MP3,
    body: (p) => {
      const text = String(p.prompt ?? "").trim();
      const seconds = Number(p.duration);
      if (!text || !(seconds > 0)) throw new MediaError("fal", "a sound effect needs a prompt and a duration");
      return { text, duration_seconds: seconds, prompt_influence: Number(p.influence), loop: bool(p.loop), output_format: MP3_FORMAT };
    },
  },
  // https://fal.ai/models/veed/clean-audio/llms.txt (2026-11-06). The model answers FLAC or WAV only; WAV is asked for, since
  // the engine encodes it into the MP3 every «Audio» result is (`wavToMp3`, no ffmpeg needed). 48 kHz mono 16-bit is stated.
  [VEED_CLEAN_ENDPOINT]: {
    fileInput: true,
    retentionSec: FAL_RETENTION_SEC,
    resultFile: "audio",
    output: { mimes: ["audio/wav"], maxBytes: VEED_CLEAN_MAX_OUTPUT_BYTES },
    body: (p, _i, url) => ({ audio_url: url, strength: Number(p.strength), output_format: "wav" }),
  },
  // https://fal.ai/models/fal-ai/elevenlabs/tts/eleven-v3/llms.txt (2026-11-06): no `output_format`, the example is an .mp3
  // URL, the format itself is not stated (UNVERIFIED; anything else fails the sniff and refunds).
  [FAL_ELEVEN_V3_ENDPOINT]: { resultFile: "audio", retentionSec: FAL_RETENTION_SEC, output: AUDIO_MP3, body: speechBody },
  // https://fal.ai/models/elevenlabs/tts/eleven-v4-turbo/llms.txt (2026-11-06): up to 5 000 characters per request.
  [FAL_ELEVEN_V4_TURBO_ENDPOINT]: { resultFile: "audio", retentionSec: FAL_RETENTION_SEC, output: AUDIO_MP3, body: (p) => ({ ...speechBody(p), output_format: MP3_FORMAT }) },
};

/** The dubbing endpoints an op id may name. */
export const FAL_DUB_ENDPOINTS: ReadonlySet<string> = new Set([FAL_DUB_ENDPOINT, HEYGEN_TRANSLATE_ENDPOINT]);

/**
 * The dub's input JSON, by endpoint. Pure.
 *
 * https://fal.ai/models/fal-ai/elevenlabs/dubbing/llms.txt (2026-11-06): `video_url` or `audio_url`, `target_lang`,
 * `source_lang` (left out = detected), `num_speakers` left out (detected). `highest_resolution` defaults to true there and
 * its meaning is not explained: false keeps the result near the source's size, because a dub over our 25 MB cap is paid
 * for and then refunded. UNVERIFIED: the picture quality this gives.
 *
 * https://fal.ai/models/fal-ai/heygen/v2/translate/speed/llms.txt (2026-11-06): `video_url`, `output_language` (the enum
 * names, `HEYGEN_LANGUAGE`). It bills per OUTPUT second and `enable_dynamic_duration` defaults to true, which may stretch
 * the clip: false keeps the output at the source's length, the seconds we priced. UNVERIFIED until a live job compares them.
 */
export function falDubBody(endpoint: string, p: NormalizedParams, asset: AdapterAsset, url: string = FAL_FILE_PENDING): Record<string, unknown> {
  if (endpoint === HEYGEN_TRANSLATE_ENDPOINT) {
    const language = HEYGEN_LANGUAGE[String(p.target ?? "")];
    if (!language) throw new MediaError("fal", "HeyGen does not offer this language");
    if (asset.mime !== "video/mp4") throw new MediaError("fal", "HeyGen translates a video only");
    return { video_url: url, output_language: language, translate_audio_only: bool(p.translateAudioOnly), enable_dynamic_duration: false };
  }
  const target = String(p.target ?? "").trim();
  if (!target) throw new MediaError("fal", "dubbing needs a target language");
  const src = String(p.sourceLang ?? AUTO_LANGUAGE);
  return {
    [asset.mime === "video/mp4" ? "video_url" : "audio_url"]: url,
    target_lang: target,
    ...(src !== AUTO_LANGUAGE ? { source_lang: src } : {}),
    highest_resolution: false,
  };
}
