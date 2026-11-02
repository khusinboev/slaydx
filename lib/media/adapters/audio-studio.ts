/**
 * Studio «Audio» adapters (docs/studio/P6-SPEC.md) on the media core — four ElevenLabs endpoints, each answering with
 * the MP3 bytes (`?output_format=mp3_44100_128`):
 *
 *   studio-elevenlabs-music    POST /v1/music                         JSON  `audioRequest("music")`
 *   studio-elevenlabs-sfx      POST /v1/sound-generation              JSON  `audioRequest("sfx")`
 *   studio-elevenlabs-sts      POST /v1/speech-to-speech/{voice_id}   multipart (the input as `audio`)
 *   studio-elevenlabs-isolate  POST /v1/audio-isolation               multipart (the input as `audio`)
 *
 * Params arrive normalized and merged with the host's `extra` (`runMedia`): the voice changer's `voice` is ALWAYS a
 * provider voice id by now (a `clone:<id>` was resolved by the server against the user's own row); the uploaded input
 * travels as the `audio` asset (base64), resolved by the worker from the user's own upload row. Failure mapping is the
 * speech wrappers' (`toSpeechError`): 429 / 5xx / network retryable, a timed-out call `accepted` (may be billed).
 */
import { MediaError, type AdapterInput, type MediaAdapter, type NormalizedParams } from "../../studio-core";
import { ELEVENLABS_API, ELEVENLABS_OUTPUT_FORMAT, elevenLabsFetch, elevenLabsKey, elevenLabsMp3 } from "../../generation/tts/elevenlabs";
import { ELEVENLABS_MUSIC_MODEL, ELEVENLABS_SFX_MODEL, ELEVENLABS_STS_MODEL } from "../catalog-audio";
import { toSpeechError } from "./speech";

export type AudioAdapterKind = "music" | "sfx" | "sts" | "isolate";
export type StudioAudioAdapterDeps = { key?: () => string };

const q = `?output_format=${ELEVENLABS_OUTPUT_FORMAT}`;
export const ELEVENLABS_MUSIC_URL = `${ELEVENLABS_API}/music${q}`;
export const ELEVENLABS_SFX_URL = `${ELEVENLABS_API}/sound-generation${q}`;
export const ELEVENLABS_ISOLATE_URL = `${ELEVENLABS_API}/audio-isolation${q}`;
export const elevenLabsStsUrl = (voiceId: string): string => `${ELEVENLABS_API}/speech-to-speech/${encodeURIComponent(voiceId)}${q}`;

const bool = (v: unknown): boolean => v === true || v === "true";

/** A multipart body as plain data: the pure request (golden / probe tests) and the FormData sent are built from it. */
export type AudioForm = { fields: Record<string, string>; file: { mime: string; bytes: number } | null };

/**
 * The pure request of one call (no key inside). JSON modes return the body; upload modes return their form fields and
 * the input's size / type (the bytes themselves are never part of a logged or compared request).
 */
export function audioRequest(kind: AudioAdapterKind, input: Pick<AdapterInput, "params" | "assets">): { url: string; json?: Record<string, unknown>; form?: AudioForm } {
  const p: NormalizedParams = input.params;
  if (kind === "music") {
    const prompt = String(p.prompt ?? "").trim();
    const seconds = Number(p.length);
    if (!prompt || !(seconds > 0)) throw new MediaError("elevenlabs", "music needs a prompt and a length");
    return { url: ELEVENLABS_MUSIC_URL, json: { prompt, music_length_ms: Math.round(seconds * 1000), force_instrumental: bool(p.instrumental), model_id: ELEVENLABS_MUSIC_MODEL } };
  }
  if (kind === "sfx") {
    const text = String(p.prompt ?? "").trim();
    const duration = Number(p.duration);
    if (!text || !(duration > 0)) throw new MediaError("elevenlabs", "a sound effect needs a prompt and a duration");
    return {
      url: ELEVENLABS_SFX_URL,
      json: { text, duration_seconds: duration, prompt_influence: Number(p.influence), loop: bool(p.loop), model_id: ELEVENLABS_SFX_MODEL },
    };
  }
  const audio = input.assets?.audio?.[0];
  if (!audio) throw new MediaError("elevenlabs", "no input audio");
  const file = { mime: audio.mime, bytes: Math.floor((audio.base64.length * 3) / 4) };
  if (kind === "sts") {
    const voice = String(p.voice ?? "").trim();
    if (!voice) throw new MediaError("elevenlabs", "voice changer needs a voice");
    return { url: elevenLabsStsUrl(voice), form: { fields: { model_id: ELEVENLABS_STS_MODEL, remove_background_noise: bool(p.removeNoise) ? "true" : "false" }, file } };
  }
  return { url: ELEVENLABS_ISOLATE_URL, form: { fields: {}, file } };
}

function formData(fields: Record<string, string>, audio: { mime: string; base64: string }): FormData {
  const form = new FormData();
  const ext = audio.mime === "audio/wav" ? "wav" : "mp3";
  form.append("audio", new Blob([new Uint8Array(Buffer.from(audio.base64, "base64")) as BlobPart], { type: audio.mime }), `input.${ext}`);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return form;
}

const ADAPTER_ID: Readonly<Record<AudioAdapterKind, string>> = {
  music: "studio-elevenlabs-music",
  sfx: "studio-elevenlabs-sfx",
  sts: "studio-elevenlabs-sts",
  isolate: "studio-elevenlabs-isolate",
};

const timeoutOf = (d: { deadline?: number; now?: () => number }): number | undefined =>
  d.deadline ? Math.max(1_000, d.deadline - (d.now ?? Date.now)()) : undefined;

export function audioAdapter(kind: AudioAdapterKind, deps: StudioAudioAdapterDeps = {}): MediaAdapter {
  const keyOf = deps.key ?? elevenLabsKey;
  return {
    id: ADAPTER_ID[kind],
    configured: () => Boolean(keyOf()),
    buildRequest: (input) => {
      const r = audioRequest(kind, input);
      return { url: r.url, headers: { Accept: "audio/mpeg", ...(r.json ? { "Content-Type": "application/json" } : {}) }, body: r.json ?? r.form };
    },
    async submit(input, d = {}) {
      const key = keyOf();
      if (!key) throw new MediaError("elevenlabs", "ELEVENLABS_API_KEY yo'q");
      const req = audioRequest(kind, input);
      try {
        const call = req.json
          ? { url: req.url, method: "POST" as const, json: req.json, accept: "audio/mpeg" }
          : { url: req.url, method: "POST" as const, form: formData(req.form!.fields, input.assets!.audio![0]!), accept: "audio/mpeg" };
        const res = await elevenLabsFetch(call, { key, fetchImpl: d.fetchImpl, timeoutMs: timeoutOf(d) });
        const { mp3 } = await elevenLabsMp3(res);
        return { done: [{ kind: "inline", bytes: mp3, mime: "audio/mpeg" }] };
      } catch (e) {
        throw toSpeechError(e, "elevenlabs");
      }
    },
    async fetchOutput(o) {
      if (o.kind === "inline") return o.bytes;
      throw new MediaError("elevenlabs", "audio outputs are inline");
    },
  };
}

/** Every Studio «Audio» adapter by id (the catalog routes name them). */
export function studioAudioAdapters(deps: StudioAudioAdapterDeps = {}): Record<string, MediaAdapter> {
  return Object.fromEntries((Object.keys(ADAPTER_ID) as AudioAdapterKind[]).map((k) => [ADAPTER_ID[k], audioAdapter(k, deps)]));
}

/** The adapter kind of an «Audio» catalog model's route. */
export function audioAdapterKind(adapterId: string): AudioAdapterKind | null {
  return (Object.keys(ADAPTER_ID) as AudioAdapterKind[]).find((k) => ADAPTER_ID[k] === adapterId) ?? null;
}
