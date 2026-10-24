/**
 * ELEVENLABS adapter (program-17 item 5, voice part) -- the PREMIUM voice of the podcast and greeting tools.
 *
 * It is NOT part of the default voice chain: Azure / Aisha / Gemini stay exactly as they were, and without an
 * ElevenLabs key nothing changes. The chain uses this provider only when the user picked «Premium ovoz» in the
 * form (`voiceProvider = "elevenlabs"`, `TtsRunOpts.provider`); a failure then fails the job and refunds it
 * instead of silently falling back to a cheaper voice at the premium price.
 *
 * API (checked 2026-10-24):
 *   POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128
 *   header `xi-api-key: <key>`, body JSON `{ text, model_id, language_code?, voice_settings? }`, the response
 *   body is the audio itself (`audio/mpeg`).
 *   Reference: https://elevenlabs.io/docs/api-reference/text-to-speech/convert
 *   - `output_format` default is `mp3_44100_128`; `model_id` default is `eleven_multilingual_v2`.
 *   - Models: https://elevenlabs.io/docs/overview/models -- only `eleven_v3` (70+ languages, 5 000 chars per
 *     request) lists Uzbek (`uz`); `eleven_multilingual_v2` (29) and `eleven_flash_v2_5` (32) do not. The
 *     product's main language is Uzbek, so the model is `eleven_v3`. Our chunks are <= 900 chars, far under 5 000.
 *   - `voice_settings.speed` is documented on the convert page; it is sent only when the form asks for a non-1 pace.
 *   - Errors: 422 carries `detail: [{loc, msg, type}]`; auth/quota/policy errors carry `detail: {status, message}`.
 *
 * Price: $0.08 per 1 000 characters for v3 / Multilingual v2 (https://elevenlabs.io/pricing/api) -- the
 * `TTS_PRICING` row in `llm-pricing.ts`.
 *
 * The key is read through `getProviderKey("elevenlabs")` (admin «Provayderlar» store, then ELEVENLABS_API_KEY),
 * goes into ONE header, and is scrubbed out of every error text before it can reach a log or a job.
 */
import { TTS_LIMITS, TtsError, type TtsAudio, type TtsProvider, type TtsSynthOpts } from "./types";
import { mp3Seconds } from "./mp3";
import { getProviderKey } from "../../server/providers/resolve";

export const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1/text-to-speech";
/** `eleven_v3` is the only model that supports Uzbek (see the file header). */
export const ELEVENLABS_MODEL = "eleven_v3";
/** The API default; 44.1 kHz / 128 kbps mono-compatible MP3 that `concatMp3` joins like the Azure output. */
export const ELEVENLABS_OUTPUT_FORMAT = "mp3_44100_128";

/**
 * Default premade voices: Rachel (female) and Adam (male) -- `TTS_ELEVENLABS_VOICES` in `types.ts`. An operator can
 * replace them per language with `TTS_VOICE_<LANG>=elevenlabs:<voice_id>`.
 * Needs a live listen on the first key: a premade English voice reading Uzbek is the thing to judge by ear.
 */

/** Languages (ISO 639-1) of our 18 that `eleven_v3` lists; for the others the model detects the language itself. */
const V3_LANGS: ReadonlySet<string> = new Set(["uz", "ru", "en", "kk", "tr", "ar", "de", "fr", "es", "it", "pt", "zh", "ja", "ko", "ky", "tg"]);

export const elevenLabsKey = (): string => getProviderKey("elevenlabs");

/** Request body, one place (`tests/elevenlabs-tts.test.mts` pins its shape). */
export function elevenLabsBody(text: string, opts: TtsSynthOpts): Record<string, unknown> {
  const lang = String(opts.lang ?? "").trim().toLowerCase();
  const speed = Number(opts.speed);
  return {
    text,
    model_id: ELEVENLABS_MODEL,
    ...(V3_LANGS.has(lang) ? { language_code: lang } : {}),
    // Documented range of `speed` is 0.7-1.2; 1 (or nothing) sends no voice_settings at all.
    ...(Number.isFinite(speed) && speed > 0 && Math.abs(speed - 1) >= 0.01 ? { voice_settings: { speed: Math.max(0.7, Math.min(1.2, speed)) } } : {}),
  };
}

export function elevenLabsUrl(voiceId: string): string {
  return `${ELEVENLABS_BASE}/${encodeURIComponent(voiceId)}?output_format=${ELEVENLABS_OUTPUT_FORMAT}`;
}

/** 429 and 5xx are worth another try; auth (401), quota (402/403), policy and validation (400/422) are not. */
export function elevenLabsRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Error text with the key (and any `xi-api-key` echo) removed. Never throws. */
export function scrubKey(text: string, key: string): string {
  let out = String(text ?? "");
  if (key) out = out.split(key).join("[key]");
  return out.replace(/xi-api-key\W+[^\s"']+/gi, "xi-api-key [key]").replace(/sk_[A-Za-z0-9]{8,}/g, "[key]");
}

export type ElevenLabsTtsDeps = {
  /** Test seam: mock `fetch`. */
  fetchImpl?: typeof fetch;
  key?: () => string;
};

export function makeElevenLabsTts(deps: ElevenLabsTtsDeps = {}): TtsProvider {
  const key = deps.key ?? elevenLabsKey;
  return {
    id: "elevenlabs",
    configured: () => Boolean(key()),

    async synthesize(text: string, opts: TtsSynthOpts): Promise<TtsAudio> {
      const k = key();
      if (!k) throw new TtsError("elevenlabs", "ELEVENLABS_API_KEY yo'q");
      const body = String(text ?? "").trim();
      if (!body) throw new TtsError("elevenlabs", "bo'sh matn");
      const voice = opts.voice?.trim() || "";
      if (!voice) throw new TtsError("elevenlabs", "ovoz identifikatori berilmagan");

      const doFetch = deps.fetchImpl ?? fetch;
      const timeoutMs = Math.max(1_000, opts.timeoutMs ?? TTS_LIMITS.callTimeoutMs);
      let res: Response;
      try {
        res = await doFetch(elevenLabsUrl(voice), {
          method: "POST",
          signal: AbortSignal.timeout(timeoutMs),
          headers: { "xi-api-key": k, "Content-Type": "application/json", Accept: "audio/mpeg" },
          body: JSON.stringify(elevenLabsBody(body, opts)),
        });
      } catch (e) {
        throw new TtsError("elevenlabs", scrubKey(e instanceof Error ? e.message : "tarmoq xatosi", k), { retryable: true });
      }

      if (!res.ok) {
        const raw = await res.text().catch(() => "");
        const detail = scrubKey(raw, k).slice(0, 200);
        const retryAfter = Number(res.headers.get("retry-after"));
        throw new TtsError("elevenlabs", `${res.status} ${res.statusText || "xato"}${detail ? `: ${detail}` : ""}`, {
          retryable: elevenLabsRetryable(res.status),
          status: res.status,
          ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterMs: retryAfter * 1000 } : {}),
        });
      }

      const mp3 = new Uint8Array(await res.arrayBuffer());
      if (!mp3.length) throw new TtsError("elevenlabs", "bo'sh javob", { retryable: true });
      const seconds = mp3Seconds(mp3);
      // No MP3 frame = not audio (an error page behind a 200, or a changed format): never pass it on as a voice.
      if (seconds <= 0) throw new TtsError("elevenlabs", "javobda MP3 kadri topilmadi", { retryable: false });
      return { mp3, seconds, chars: body.length, model: ELEVENLABS_MODEL };
    },
  };
}

export const elevenLabsTts = makeElevenLabsTts();
