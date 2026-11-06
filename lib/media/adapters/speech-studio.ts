/**
 * Studio «Ovoz» adapters (docs/studio/P5-SPEC.md) on the media core. Kept apart from `speech.ts` (the podcast / greeting
 * wrappers, whose behaviour must stay byte-identical): these speak the Studio's own requests.
 *
 *   studio-elevenlabs-tts       POST /v1/text-to-speech/{voice}  — `elevenLabsStudioBody` (text, eleven_v3, language,
 *                               speed, stability)
 *   studio-elevenlabs-dialogue  POST /v1/text-to-dialogue        — `elevenLabsDialogueBody` (one input per turn)
 *   elevenlabs-clone            POST /v1/voices/add (multipart)  — the user's sample → `{ voice_id }` (returned as a JSON
 *                               output; the host stores it)
 *   studio-gemini-tts / -dialogue  the existing Gemini TTS provider (`speechAdapter`), single voice or two-speaker turns
 *
 * Params arrive normalized and merged with the host's `extra` (`runMedia`): `voice` is ALWAYS a provider voice id by now
 * (a `clone:<id>` was resolved by the server against the user's own row); a dialogue's `turns` is a JSON string.
 *
 * Failure mapping is the speech wrappers' (`toSpeechError`): 429 / 5xx / network retryable, an HTTP error never
 * `accepted`, a call that timed out after it started `accepted` (the provider may have billed or created the voice).
 */
import { MediaError, type AdapterInput, type MediaAdapter, type NormalizedParams } from "../../studio-core";
import {
  ELEVENLABS_CLONE_MARKER,
  ELEVENLABS_CLONE_URL,
  ELEVENLABS_DIALOGUE_URL,
  elevenLabsCloneForm,
  elevenLabsDialogueBody,
  elevenLabsFetch,
  elevenLabsKey,
  elevenLabsMp3,
  elevenLabsStudioBody,
  elevenLabsUrl,
  type StudioElevenOpts,
} from "../../generation/tts/elevenlabs";
import { geminiTts } from "../../generation/tts/gemini";
import type { TtsProvider } from "../../generation/tts/types";
import { speechAdapter, toSpeechError } from "./speech";
import { FAL_ADAPTER_ID, falAdapter, type FalDeps } from "./fal";

export type StudioSpeechAdapterDeps = { key?: () => string; gemini?: TtsProvider; fal?: FalDeps };

const opts = (p: NormalizedParams): StudioElevenOpts => ({
  lang: typeof p.lang === "string" ? p.lang : undefined,
  speed: p.speed === undefined ? undefined : Number(p.speed),
  stability: p.stability === undefined ? undefined : Number(p.stability),
});

/** `[{ text, voiceId }]` of a dialogue's `turns` param (JSON), `[]` when it is not one. */
export function turnsParam(raw: unknown): { text: string; voiceId: string }[] {
  if (typeof raw !== "string") return [];
  try {
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    return list
      .map((t) => ({ text: String((t as Record<string, unknown>)?.text ?? "").trim(), voiceId: String((t as Record<string, unknown>)?.voiceId ?? "").trim() }))
      .filter((t) => t.text && t.voiceId);
  } catch {
    return [];
  }
}

/** The pure request of an ElevenLabs Studio call (golden tests; no key inside). */
export function studioElevenRequest(adapter: "tts" | "dialogue", input: Pick<AdapterInput, "params">): { url: string; headers: Record<string, string>; body: Record<string, unknown> } {
  const p = input.params;
  const headers = { "Content-Type": "application/json", Accept: "audio/mpeg" };
  if (adapter === "dialogue") {
    const turns = turnsParam(p.turns);
    if (turns.length < 2) throw new MediaError("elevenlabs", "dialogue without turns");
    return { url: ELEVENLABS_DIALOGUE_URL, headers, body: elevenLabsDialogueBody(turns, opts(p)) };
  }
  const voice = String(p.voice ?? "").trim();
  const text = String(p.text ?? "").trim();
  if (!voice || !text) throw new MediaError("elevenlabs", "voice and text are required");
  return { url: elevenLabsUrl(voice), headers, body: elevenLabsStudioBody(text, opts(p)) };
}

function elevenAudioAdapter(kind: "tts" | "dialogue", deps: StudioSpeechAdapterDeps): MediaAdapter {
  const keyOf = deps.key ?? elevenLabsKey;
  return {
    id: kind === "tts" ? "studio-elevenlabs-tts" : "studio-elevenlabs-dialogue",
    configured: () => Boolean(keyOf()),
    buildRequest: (input) => studioElevenRequest(kind, input),
    async submit(input, d = {}) {
      const key = keyOf();
      if (!key) throw new MediaError("elevenlabs", "ELEVENLABS_API_KEY yo'q");
      const req = studioElevenRequest(kind, input);
      try {
        const res = await elevenLabsFetch({ url: req.url, method: "POST", json: req.body, accept: "audio/mpeg" }, { key, fetchImpl: d.fetchImpl, timeoutMs: timeoutOf(d) });
        const { mp3 } = await elevenLabsMp3(res);
        return { done: [{ kind: "inline", bytes: mp3, mime: "audio/mpeg" }] };
      } catch (e) {
        throw toSpeechError(e, "elevenlabs");
      }
    },
    async fetchOutput(o) {
      if (o.kind === "inline") return o.bytes;
      throw new MediaError("elevenlabs", "speech outputs are inline");
    },
  };
}

const timeoutOf = (d: { deadline?: number; now?: () => number }): number | undefined =>
  d.deadline ? Math.max(1_000, d.deadline - (d.now ?? Date.now)()) : undefined;

/** The sample travels as the `sample` asset (base64), the clone's name as the `name` param. */
export function cloneAdapter(deps: StudioSpeechAdapterDeps = {}): MediaAdapter {
  const keyOf = deps.key ?? elevenLabsKey;
  return {
    id: "elevenlabs-clone",
    configured: () => Boolean(keyOf()),
    async submit(input, d = {}) {
      const key = keyOf();
      if (!key) throw new MediaError("elevenlabs", "ELEVENLABS_API_KEY yo'q");
      const sample = input.assets?.sample?.[0];
      const name = String(input.params.name ?? "").trim();
      if (!sample || !name) throw new MediaError("elevenlabs", "clone needs a name and a sample");
      const bytes = new Uint8Array(Buffer.from(sample.base64, "base64"));
      const form = elevenLabsCloneForm({ name, sample: bytes, mime: sample.mime, fileName: sample.mime === "audio/wav" ? "sample.wav" : "sample.mp3", description: `${ELEVENLABS_CLONE_MARKER} (user consent recorded)` });
      let body: unknown;
      try {
        const res = await elevenLabsFetch({ url: ELEVENLABS_CLONE_URL, method: "POST", form }, { key, fetchImpl: d.fetchImpl, timeoutMs: timeoutOf(d) });
        body = await res.json().catch(() => null);
      } catch (e) {
        throw toSpeechError(e, "elevenlabs");
      }
      const voiceId = (body as { voice_id?: unknown } | null)?.voice_id;
      // The voice may exist even though the answer is unreadable: accepted, never retried on another route.
      if (typeof voiceId !== "string" || !/^[A-Za-z0-9]{8,64}$/.test(voiceId)) throw new MediaError("elevenlabs", "javobda voice_id yo'q", { accepted: true });
      return { done: [{ kind: "inline", bytes: new TextEncoder().encode(JSON.stringify({ voice_id: voiceId })), mime: "application/json" }] };
    },
    async fetchOutput(o) {
      if (o.kind === "inline") return o.bytes;
      throw new MediaError("elevenlabs", "clone outputs are inline");
    },
  };
}

/** Every Studio speech adapter by id (the catalog routes name them). */
export function studioSpeechAdapters(deps: StudioSpeechAdapterDeps = {}): Record<string, MediaAdapter> {
  const gemini = deps.gemini ?? geminiTts;
  return {
    "studio-elevenlabs-tts": elevenAudioAdapter("tts", deps),
    "studio-elevenlabs-dialogue": elevenAudioAdapter("dialogue", deps),
    "studio-gemini-tts": speechAdapter("studio-gemini-tts", gemini),
    "studio-gemini-dialogue": speechAdapter("studio-gemini-dialogue", gemini),
    "elevenlabs-clone": cloneAdapter(deps),
    // P11: ElevenLabs v3 and v4 Turbo through fal.
    [FAL_ADAPTER_ID]: falAdapter(deps.fal),
  };
}
