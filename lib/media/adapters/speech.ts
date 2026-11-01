/**
 * Speech adapters on the media core (docs/studio/P0-SPEC.md §3.8, §6.5): today's `TtsProvider`s (`lib/generation/tts`)
 * wrapped as `MediaAdapter`s. Nothing about the provider HTTP calls changes: `submit` hands the provider's own
 * `synthesize` the same text and the same options the chain built, and returns what it returned.
 *
 * The chain (`tts/chain.ts`) stays the fallback logic. It binds ONE provider for a whole job, chunks and packs the
 * parts, paces the Gemini requests (`tts:gemini:rpm`), waits out a 429 and meters the spend. Only the single provider
 * call of each attempt goes through `runMedia`, which gives the core its breaker health and one `media_jobs` row per
 * chunk. The core never sees the chain's rules, so the chain needs the provider's EXACT exception back: `SpeechMediaError`
 * carries it (`original`) and `unwrapSpeechError` returns it, so `rateLimited` / `retryAfterMs` / `dailyQuota` and the
 * Uzbek messages behave as before.
 *
 * Failure mapping (`TtsError` → `MediaError`): `retryable` is `isRetryableTtsError` (an exception that is not a
 * `TtsError`, e.g. a network failure, is retryable as it always was). `accepted` is `false` for a provider that answered
 * with an HTTP error (it holds no audio of ours) and `true` for a call that timed out after it started (the provider may
 * have produced, and billed, the audio): a second route must never run after that. Speech has no safety refusals.
 *
 * Client-safe like the wrapped providers: no server imports.
 */
import { MediaError, type AdapterInput, type MediaAdapter, type NormalizedParams, type ParamValue } from "../../studio-core";
import { MEDIA_CATALOG } from "../catalog";
import { TtsError, audioBytes, isRetryableTtsError, type TtsAudio, type TtsProvider, type TtsProviderId, type TtsSynthOpts, type TtsTurn } from "../../generation/tts/types";

/** TTS provider id → catalog model id (the entries' routes name these providers: `lib/media/catalog.ts`). */
export const SPEECH_PROVIDER_TO_MEDIA: Readonly<Partial<Record<TtsProviderId, string>>> = {
  gemini: "google/tts",
  elevenlabs: "elevenlabs/tts",
  azure: "azure/tts",
  aisha: "aisha/tts",
};

/** The catalog entry and route of a TTS provider, or `null` for an id the catalog does not sell (it keeps the direct path). */
export function speechRoute(provider: TtsProviderId) {
  const modelId = SPEECH_PROVIDER_TO_MEDIA[provider];
  const entry = modelId ? MEDIA_CATALOG.byId(modelId) : null;
  const route = entry?.routes.find((r) => r.provider === provider);
  return entry && route ? { entry, route } : null;
}

/**
 * `synthesize(text, opts)` as the core's adapter input. The core normalizes `text` (whitespace collapsed) for its quote,
 * so the exact text and every option travel in `extra`, which `runMedia` merges OVER the normalized values: the
 * provider receives byte-for-byte what the chain built. `turns` (a two-speaker request) is a JSON string because a
 * param value cannot be a list of objects.
 */
export function speechExtraOf(text: string, opts: TtsSynthOpts): Record<string, ParamValue> {
  return {
    text,
    lang: opts.lang,
    ...(opts.voice !== undefined ? { voice: opts.voice } : {}),
    ...(opts.speed !== undefined ? { speed: opts.speed } : {}),
    ...(opts.pauseMs !== undefined ? { pauseMs: opts.pauseMs } : {}),
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    ...(opts.turns ? { turns: JSON.stringify(opts.turns) } : {}),
  };
}

function turnsOf(raw: unknown): TtsTurn[] | undefined {
  if (typeof raw !== "string") return undefined;
  try {
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return undefined;
    return list.map((t) => ({ voice: String((t as TtsTurn).voice ?? ""), text: String((t as TtsTurn).text ?? "") }));
  } catch {
    return undefined;
  }
}

/** The inverse of `speechExtraOf`: what the provider's `synthesize` is called with. */
export function speechCallOf(params: NormalizedParams): { text: string; opts: TtsSynthOpts } {
  const num = (v: ParamValue | undefined): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const speed = num(params.speed);
  const pauseMs = num(params.pauseMs);
  const timeoutMs = num(params.timeoutMs);
  const turns = turnsOf(params.turns);
  return {
    text: String(params.text ?? ""),
    opts: {
      lang: String(params.lang ?? "uz"),
      // Every provider reads the voice as `voice?.trim() || default`, so an empty voice and an absent one are the same call.
      ...(typeof params.voice === "string" && params.voice !== "" ? { voice: params.voice } : {}),
      ...(speed !== undefined ? { speed } : {}),
      ...(pauseMs !== undefined ? { pauseMs } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      ...(turns ? { turns } : {}),
    },
  };
}

/** A provider failure as the core sees it, with the provider's own exception kept for the chain. */
export class SpeechMediaError extends MediaError {
  readonly original: unknown;

  constructor(provider: string, message: string, original: unknown, o: { status?: number; retryable: boolean; accepted: boolean }) {
    super(provider, message, o);
    this.name = "SpeechMediaError";
    this.original = original;
  }
}

const TIMED_OUT = /timeout|timed out|aborted/i;

export function toSpeechError(e: unknown, provider: TtsProviderId): SpeechMediaError {
  const message = e instanceof Error ? e.message : String(e);
  const status = e instanceof TtsError ? e.status : undefined;
  return new SpeechMediaError(e instanceof TtsError ? e.provider : provider, message, e, {
    ...(status !== undefined ? { status } : {}),
    retryable: isRetryableTtsError(e),
    accepted: status === undefined && TIMED_OUT.test(message),
  });
}

/**
 * What the chain should see for an error that came out of `runMedia`: the provider's own exception for a provider
 * failure; a `TtsError` for the core's own errors (no usable route, unknown model), so the chain's `TtsError` rules
 * (retry, next provider) apply; anything else unchanged.
 */
export function unwrapSpeechError(e: unknown, provider: TtsProviderId): unknown {
  if (e instanceof SpeechMediaError) return e.original;
  if (e instanceof MediaError) return new TtsError(provider, e.message, { retryable: e.retryable, ...(e.status !== undefined ? { status: e.status } : {}) });
  return e;
}

export type SpeechAdapterOpts = {
  /** Receives the provider's full answer (seconds, chars, model, tokens): a `MediaOutput` carries only the bytes. */
  onAudio?: (audio: TtsAudio) => void;
};

export function speechAdapter(adapterId: string, provider: TtsProvider, o: SpeechAdapterOpts = {}): MediaAdapter {
  return {
    id: adapterId,
    configured: () => provider.configured(),
    async submit(input: AdapterInput) {
      const { text, opts } = speechCallOf(input.params);
      let audio: TtsAudio;
      try {
        audio = await provider.synthesize(text, opts);
      } catch (e) {
        throw toSpeechError(e, provider.id);
      }
      o.onAudio?.(audio);
      const out = audioBytes(audio);
      return { done: [{ kind: "inline", bytes: out?.bytes ?? new Uint8Array(0), mime: out?.format === "wav" ? "audio/wav" : "audio/mpeg" }] };
    },
    async fetchOutput(output) {
      if (output.kind === "inline") return output.bytes;
      throw new MediaError(provider.id, "speech outputs are inline");
    },
  };
}
