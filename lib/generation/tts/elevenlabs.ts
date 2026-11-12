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
 *   - Model (re-checked LIVE on production 2026-11-12, `GET /v1/models` + real calls): `eleven_v4` (10 000 chars per
 *     request, cost multiplier 1, 94 languages incl. `uz`) is the model. `eleven_v3` (5 000 chars, 74 languages) does
 *     NOT list `uz` any more: `model_id: eleven_v3, language_code: "uz"` answers 400 `{"detail":{"code":
 *     "invalid_parameters","message":"Model 'eleven_v3' does not support language_code 'uz'.","status":
 *     "unsupported_language"}}` (text-to-speech AND text-to-dialogue) — every v3 + `uz` call failed, so did the only
 *     direct Studio v3 job (2026-11-06). `eleven_v4` + `uz`: single voice and dialogue 200 OK, `voice_settings
 *     {speed, stability}` accepted. `eleven_multilingual_v2` (29) and `eleven_flash_v2_5` (32) do not list Uzbek.
 *     Our chunks are <= 900 chars, far under 10 000.
 *   - A 400 `unsupported_language` (a model that drops a language later) is retried ONCE without `language_code`
 *     (the model then detects the language itself; v3 without `language_code` still answered 200 on 2026-11-12).
 *   - `voice_settings.speed` is documented on the convert page; it is sent only when the form asks for a non-1 pace.
 *   - Errors: 422 carries `detail: [{loc, msg, type}]`; auth/quota/policy errors carry `detail: {status, message}`.
 *
 * Price: API list price $0.08 per 1 000 characters for v4 and v3 (https://elevenlabs.io/pricing/api, read 2026-11-12);
 * the cost basis is the owner's Creator plan (`TTS_PRICING` row in `llm-pricing.ts`, 1 credit per character — kept
 * conservative: a live 160-character v4 request reported `character-cost: 71`, i.e. v4 burns fewer credits than that).
 *
 * The key is read through `getProviderKey("elevenlabs")` (admin «Provayderlar» store, then ELEVENLABS_API_KEY),
 * goes into ONE header, and is scrubbed out of every error text before it can reach a log or a job.
 */
import { TTS_LIMITS, TtsError, type TtsAudio, type TtsProvider, type TtsSynthOpts } from "./types";
import { mp3Seconds } from "./mp3";
import { getProviderKey } from "../../server/providers/resolve";

export const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1/text-to-speech";
/** `eleven_v4`: the direct-API model that takes `language_code: "uz"` (see the file header, measured 2026-11-12). */
export const ELEVENLABS_MODEL = "eleven_v4";
/** Characters of one `eleven_v4` request (`GET /v1/models` `max_characters_request_*`, 2026-11-12). */
export const ELEVENLABS_MAX_CHARS_PER_REQUEST = 10_000;
/** The API default; 44.1 kHz / 128 kbps mono-compatible MP3 that `concatMp3` joins like the Azure output. */
export const ELEVENLABS_OUTPUT_FORMAT = "mp3_44100_128";

/**
 * Default premade voices: Rachel (female) and Adam (male) -- `TTS_ELEVENLABS_VOICES` in `types.ts`. An operator can
 * replace them per language with `TTS_VOICE_<LANG>=elevenlabs:<voice_id>`.
 * Needs a live listen on the first key: a premade English voice reading Uzbek is the thing to judge by ear.
 */

/**
 * Languages (ISO 639-1) of our 18 that get an explicit `language_code`; for the others (Karakalpak `kaa`, Uzbek
 * Cyrillic `uz-cyrl`…) the model detects the language itself. `uz` is verified live on `eleven_v4` (2026-11-12); the
 * rest are the list the v3 model page named, kept as is (v4 lists 94 languages in the live `GET /v1/models`; only `uz`
 * was called one by one), and a code the model ever refuses is retried once without it (`unsupportedLanguage`).
 */
const LANGS: ReadonlySet<string> = new Set(["uz", "ru", "en", "kk", "tr", "ar", "de", "fr", "es", "it", "pt", "zh", "ja", "ko", "ky", "tg"]);

export const elevenLabsKey = (): string => getProviderKey("elevenlabs");

/** Request body, one place (`tests/elevenlabs-tts.test.mts` pins its shape). */
export function elevenLabsBody(text: string, opts: TtsSynthOpts): Record<string, unknown> {
  const lang = String(opts.lang ?? "").trim().toLowerCase();
  const speed = Number(opts.speed);
  return {
    text,
    model_id: ELEVENLABS_MODEL,
    ...(LANGS.has(lang) ? { language_code: lang } : {}),
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

/**
 * The answer says the model does not take this `language_code` (400, `detail.status: "unsupported_language"` — the exact
 * answer of `eleven_v3` + `uz` on 2026-11-12). Read on the FULL answer text, before it is cut for a log.
 */
export function unsupportedLanguage(status: number, text: string): boolean {
  return status === 400 && /unsupported_language/.test(String(text ?? ""));
}

/** The same request without `language_code` (the one retry after `unsupportedLanguage`); `null` when it had none. */
export function withoutLanguageCode(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object" || Array.isArray(body) || !("language_code" in body)) return null;
  const { language_code: _dropped, ...rest } = body as Record<string, unknown>;
  void _dropped;
  return rest;
}

/**
 * The permission a key lacks, from a 401 `missing_permissions` answer ("…is missing the permission speech_to_text…"):
 * its name, `missing_permissions` when the answer does not name one, `null` for any other text.
 */
export function missingPermissionOf(text: string): string | null {
  const named = /missing the permission\s+["'`]?([a-z][a-z0-9_]*)/i.exec(text);
  if (named) return named[1]!.toLowerCase();
  return /missing_permissions/.test(text) ? "missing_permissions" : null;
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
      let json: Record<string, unknown> = elevenLabsBody(body, opts);
      let res: Response;
      let raw = "";
      for (let attempt = 0; ; attempt++) {
        try {
          res = await doFetch(elevenLabsUrl(voice), {
            method: "POST",
            signal: AbortSignal.timeout(timeoutMs),
            headers: { "xi-api-key": k, "Content-Type": "application/json", Accept: "audio/mpeg" },
            body: JSON.stringify(json),
          });
        } catch (e) {
          throw new TtsError("elevenlabs", scrubKey(e instanceof Error ? e.message : "tarmoq xatosi", k), { retryable: true });
        }
        if (res.ok) break;
        raw = await res.text().catch(() => "");
        // The model refuses the language code: once more without it (the model detects the language) — file header.
        const bare = attempt === 0 && unsupportedLanguage(res.status, raw) ? withoutLanguageCode(json) : null;
        if (!bare) break;
        console.warn(`[tts] elevenlabs: ${ELEVENLABS_MODEL} refused language_code ${String(json.language_code)}; retrying without it`);
        json = bare;
      }

      if (!res.ok) {
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

/* ══════════════════════════ Studio «Ovoz» (P5) additions ══════════════════════════
 * docs/studio/P5-SPEC.md. Everything above serves the podcast / greeting premium voice and is unchanged; the Studio
 * speaks to the same API through these builders (pure, pinned by golden tests in `tests/studio-speech.test.mts`).
 * References (read 2026-11-02):
 *   text-to-speech  https://elevenlabs.io/docs/api-reference/text-to-speech/convert — `voice_settings.stability`
 *                   (default 0.5; lower = wider emotional range) and `speed` (default 1).
 *   dialogue        https://elevenlabs.io/docs/api-reference/text-to-dialogue/convert — POST /v1/text-to-dialogue,
 *                   `{ inputs: [{text, voice_id}], model_id (we send eleven_v4), language_code?, settings: {stability} }`,
 *                   ≤ 10 voices, ≤ 2 000 characters; the answer is the audio file.
 *   voice clone     https://elevenlabs.io/docs/api-reference/voices/ivc/create — POST /v1/voices/add (multipart:
 *                   `name`, `files`, `remove_background_noise`, `description`, `labels`) → `{ voice_id, requires_verification }`.
 *   delete voice    https://elevenlabs.io/docs/api-reference/voices/delete — DELETE /v1/voices/{voice_id} → `{ status: "ok" }`.
 *   subscription    https://elevenlabs.io/docs/api-reference/user/subscription/get — GET /v1/user/subscription →
 *                   `voice_slots_used`, `voice_limit`, `can_use_instant_voice_cloning`, …
 */
export const ELEVENLABS_API = "https://api.elevenlabs.io/v1";
export const ELEVENLABS_DIALOGUE_URL = `${ELEVENLABS_API}/text-to-dialogue?output_format=${ELEVENLABS_OUTPUT_FORMAT}`;
export const ELEVENLABS_CLONE_URL = `${ELEVENLABS_API}/voices/add`;
export const ELEVENLABS_SUBSCRIPTION_URL = `${ELEVENLABS_API}/user/subscription`;
export const elevenLabsVoiceUrl = (voiceId: string): string => `${ELEVENLABS_API}/voices/${encodeURIComponent(voiceId)}`;
/**
 * Every Studio clone's description starts with this marker, so housekeeping can find a clone ElevenLabs made but whose
 * id never reached us (a call that timed out after the voice was created) and delete it (review m1).
 */
export const ELEVENLABS_CLONE_MARKER = "SlaydX Studio";
/**
 * Our cloned voices (`GET /v2/voices?category=cloned&search=<marker>`, ≤ 100 per page, `next_page_token` while
 * `has_more`): https://elevenlabs.io/docs/api-reference/voices/search, read 2026-11-02.
 */
export const elevenLabsClonedVoicesUrl = (pageToken?: string): string =>
  `https://api.elevenlabs.io/v2/voices?category=cloned&page_size=100&search=${encodeURIComponent(ELEVENLABS_CLONE_MARKER)}${pageToken ? `&next_page_token=${encodeURIComponent(pageToken)}` : ""}`;

/** The languages above as a list (`lib/media/catalog-speech.ts ELEVENLABS_LANGS` must equal it). */
export const ELEVENLABS_LANG_CODES: readonly string[] = [...LANGS];

/** Stability presets (Creative / Natural / Robust); anything else = the API default (nothing sent). */
const STABILITY = new Set([0, 0.5, 1]);

export type StudioElevenOpts = { lang?: string; speed?: number; stability?: number };

function langCode(lang: unknown): Record<string, string> {
  const l = String(lang ?? "").trim().toLowerCase();
  return LANGS.has(l) ? { language_code: l } : {};
}

const stabilityOf = (v: unknown): number | null => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return STABILITY.has(n) ? n : null;
};

/** Studio single-voice body: `elevenLabsBody`'s rules + the mood (`stability`) when it is a preset. */
export function elevenLabsStudioBody(text: string, o: StudioElevenOpts): Record<string, unknown> {
  const speed = Number(o.speed);
  const stability = stabilityOf(o.stability);
  const settings: Record<string, number> = {
    ...(stability !== null ? { stability } : {}),
    ...(Number.isFinite(speed) && speed > 0 && Math.abs(speed - 1) >= 0.01 ? { speed: Math.max(0.7, Math.min(1.2, speed)) } : {}),
  };
  return { text, model_id: ELEVENLABS_MODEL, ...langCode(o.lang), ...(Object.keys(settings).length ? { voice_settings: settings } : {}) };
}

/** Studio dialogue body: one input per turn with that speaker's voice. */
export function elevenLabsDialogueBody(turns: readonly { text: string; voiceId: string }[], o: StudioElevenOpts): Record<string, unknown> {
  const stability = stabilityOf(o.stability);
  return {
    inputs: turns.map((t) => ({ text: t.text, voice_id: t.voiceId })),
    model_id: ELEVENLABS_MODEL,
    ...langCode(o.lang),
    ...(stability !== null ? { settings: { stability } } : {}),
  };
}

/** The multipart form of an Instant Voice Clone (one sample file). */
export function elevenLabsCloneForm(o: { name: string; sample: Uint8Array; mime: string; fileName: string; description?: string }): FormData {
  const form = new FormData();
  form.append("name", o.name);
  form.append("files", new Blob([o.sample as BlobPart], { type: o.mime }), o.fileName);
  form.append("remove_background_noise", "false");
  if (o.description) form.append("description", o.description);
  return form;
}

/** Voice slots of the account (`GET /v1/user/subscription`), `null` when the answer does not carry them. */
export function elevenLabsSlotsOf(body: unknown): { used: number; limit: number; canClone: boolean } | null {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const used = Number(b.voice_slots_used);
  const limit = Number(b.voice_limit);
  if (b.voice_slots_used === undefined || b.voice_limit === undefined || !Number.isInteger(used) || !Number.isInteger(limit) || used < 0 || limit < 0) return null;
  return { used, limit, canClone: b.can_use_instant_voice_cloning !== false };
}

export type ElevenCall = { url: string; method: "GET" | "POST" | "DELETE"; json?: unknown; form?: FormData; accept?: string };

/**
 * One ElevenLabs HTTP call with the key in its header; a failed answer is a `TtsError` (key scrubbed, retryable 429/5xx).
 * A JSON call refused with `unsupported_language` is sent once more without its `language_code` (`unsupportedLanguage`).
 */
export async function elevenLabsFetch(call: ElevenCall, o: { key: string; fetchImpl?: typeof fetch; timeoutMs?: number }): Promise<Response> {
  const doFetch = o.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    "xi-api-key": o.key,
    ...(call.accept ? { Accept: call.accept } : {}),
    ...(call.json !== undefined ? { "Content-Type": "application/json" } : {}),
  };
  let res: Response;
  try {
    res = await doFetch(call.url, {
      method: call.method,
      signal: AbortSignal.timeout(Math.max(1_000, o.timeoutMs ?? TTS_LIMITS.callTimeoutMs)),
      headers,
      ...(call.json !== undefined ? { body: JSON.stringify(call.json) } : call.form ? { body: call.form } : {}),
    });
  } catch (e) {
    throw new TtsError("elevenlabs", scrubKey(e instanceof Error ? e.message : "tarmoq xatosi", o.key), { retryable: true });
  }
  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    // A model that refuses the language code: the same call once more without it (file header, 2026-11-12).
    const bare = unsupportedLanguage(res.status, raw) ? withoutLanguageCode(call.json) : null;
    if (bare) {
      console.warn("[elevenlabs] the model refused language_code; retrying once without it");
      return elevenLabsFetch({ ...call, json: bare }, o);
    }
    const detail = scrubKey(raw, o.key).slice(0, 200);
    throw new TtsError("elevenlabs", `${res.status} ${res.statusText || "xato"}${detail ? `: ${detail}` : ""}`, { retryable: elevenLabsRetryable(res.status), status: res.status });
  }
  return res;
}

/** The audio of a successful TTS / dialogue answer, checked to be MP3 (an error page behind a 200 is never a voice). */
export async function elevenLabsMp3(res: Response): Promise<{ mp3: Uint8Array; seconds: number }> {
  const mp3 = new Uint8Array(await res.arrayBuffer());
  if (!mp3.length) throw new TtsError("elevenlabs", "bo'sh javob", { retryable: true });
  const seconds = mp3Seconds(mp3);
  if (seconds <= 0) throw new TtsError("elevenlabs", "javobda MP3 kadri topilmadi", { retryable: false });
  return { mp3, seconds };
}
