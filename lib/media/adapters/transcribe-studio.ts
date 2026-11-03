/**
 * Studio P10 adapters (docs/studio/P10-SPEC.md) on the media core — two ElevenLabs APIs:
 *
 *   studio-elevenlabs-stt   POST /v1/speech-to-text (multipart) → JSON transcript with word timestamps. SYNC: the answer
 *                           is handed back as one inline `application/json` output (normalized: text, language, words).
 *   studio-elevenlabs-dub   POST /v1/dubbing (multipart) → `dubbing_id`. ASYNC: op id `<dubbing_id>:<target>`;
 *                           `poll` = GET /v1/dubbing/{id} (`dubbing` → running, `dubbed` → done, `failed`);
 *                           the output is GET /v1/dubbing/{id}/audio/{target} (MP4 for a video source, MP3 for audio);
 *                           `cancel` = DELETE /v1/dubbing/{id} (best effort: after the download and on give-up).
 *
 * The source travels as the `media` asset (base64), resolved by the worker from the job owner's own upload / result.
 * No user text is sent: the dub's project name is a constant. Failure mapping is the speech wrappers'
 * (`toSpeechError`): 429 / 5xx / network retryable; our own timeout `accepted` (the provider may already bill it).
 */
import { MediaError, type AdapterInput, type MediaAdapter, type MediaOutput, type NormalizedParams, type PollResult } from "../../studio-core";
import { ELEVENLABS_API, elevenLabsFetch, elevenLabsKey } from "../../generation/tts/elevenlabs";
import { AUTO_LANGUAGE, ELEVENLABS_STT_MODEL, SPEECH_TOOL_OUTPUT_MAX_BYTES } from "../catalog-transcribe";
import { toSpeechError } from "./speech";

export const ELEVENLABS_STT_URL = `${ELEVENLABS_API}/speech-to-text`;
export const ELEVENLABS_DUB_URL = `${ELEVENLABS_API}/dubbing`;
export const elevenLabsDubStatusUrl = (id: string): string => `${ELEVENLABS_DUB_URL}/${encodeURIComponent(id)}`;
export const elevenLabsDubAudioUrl = (id: string, lang: string): string => `${ELEVENLABS_DUB_URL}/${encodeURIComponent(id)}/audio/${encodeURIComponent(lang)}`;
/** The dub project's name at ElevenLabs: a constant (never the user's title). */
export const DUB_PROJECT_NAME = "SlaydX Studio";

export const STT_ADAPTER_ID = "studio-elevenlabs-stt";
export const DUB_ADAPTER_ID = "studio-elevenlabs-dub";

export type TranscribeAdapterDeps = { key?: () => string };

/** A multipart body as plain data (golden / probe tests compare this; the bytes are never part of it). */
export type MediaForm = { fields: Record<string, string>; file: { name: string; mime: string; bytes: number } };

const bool = (v: unknown): boolean => v === true || v === "true";
const extOf = (mime: string): string => (mime === "video/mp4" ? "mp4" : mime === "audio/wav" ? "wav" : "mp3");

function mediaAsset(input: Pick<AdapterInput, "assets">): { mime: string; base64: string } {
  const a = input.assets?.media?.[0];
  if (!a) throw new MediaError("elevenlabs", "no source media");
  return a;
}

function fileOf(a: { mime: string; base64: string }): MediaForm["file"] {
  return { name: `input.${extOf(a.mime)}`, mime: a.mime, bytes: Math.floor((a.base64.length * 3) / 4) };
}

/** The pure Speech-to-Text request (no key inside). */
export function sttRequest(input: Pick<AdapterInput, "params" | "assets" | "upstreamModel">): { url: string; form: MediaForm } {
  const p: NormalizedParams = input.params;
  const lang = String(p.language ?? AUTO_LANGUAGE);
  const fields: Record<string, string> = {
    model_id: input.upstreamModel || ELEVENLABS_STT_MODEL,
    timestamps_granularity: "word",
    tag_audio_events: "false",
    diarize: bool(p.speakers) ? "true" : "false",
    ...(lang && lang !== AUTO_LANGUAGE ? { language_code: lang } : {}),
  };
  return { url: ELEVENLABS_STT_URL, form: { fields, file: fileOf(mediaAsset(input)) } };
}

/** The pure dubbing create request (no key inside). `source_lang` is left out for «Avtomatik» (the API's default). */
export function dubRequest(input: Pick<AdapterInput, "params" | "assets">): { url: string; form: MediaForm } {
  const p: NormalizedParams = input.params;
  const target = String(p.target ?? "").trim();
  if (!target) throw new MediaError("elevenlabs", "dubbing needs a target language");
  const src = String(p.sourceLang ?? AUTO_LANGUAGE);
  const fields: Record<string, string> = {
    target_lang: target,
    ...(src && src !== AUTO_LANGUAGE ? { source_lang: src } : {}),
    num_speakers: "0",
    watermark: "false",
    name: DUB_PROJECT_NAME,
  };
  return { url: ELEVENLABS_DUB_URL, form: { fields, file: fileOf(mediaAsset(input)) } };
}

function formData(form: MediaForm, a: { mime: string; base64: string }): FormData {
  const fd = new FormData();
  fd.append("file", new Blob([new Uint8Array(Buffer.from(a.base64, "base64")) as BlobPart], { type: a.mime }), form.file.name);
  for (const [k, v] of Object.entries(form.fields)) fd.append(k, v);
  return fd;
}

const timeoutOf = (d: { deadline?: number; now?: () => number }, cap?: number): number | undefined => {
  const left = d.deadline ? Math.max(1_000, d.deadline - (d.now ?? Date.now)()) : undefined;
  return cap !== undefined ? Math.min(cap, left ?? cap) : left;
};

/** The normalized transcript (what the engine reads), from the provider's answer; `null` when it is not one. */
export type SttResult = { text: string; languageCode: string | null; words: { text: string; start: number; end: number; type: string; speaker_id: string | null }[] };

export function sttResultOf(body: unknown): SttResult | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.text !== "string" || !Array.isArray(b.words)) return null;
  const words = b.words
    .filter((w): w is Record<string, unknown> => !!w && typeof w === "object")
    .map((w) => ({
      text: String(w.text ?? ""),
      start: Number(w.start) || 0,
      end: Number(w.end) || 0,
      type: typeof w.type === "string" ? w.type : "word",
      speaker_id: typeof w.speaker_id === "string" ? w.speaker_id : null,
    }));
  // The provider's `language_code`, or our own normalized `languageCode` (the engine reads back the adapter's output).
  const lang = typeof b.language_code === "string" ? b.language_code : typeof b.languageCode === "string" ? b.languageCode : null;
  return { text: b.text, languageCode: lang, words };
}

export function sttAdapter(deps: TranscribeAdapterDeps = {}): MediaAdapter {
  const keyOf = deps.key ?? elevenLabsKey;
  return {
    id: STT_ADAPTER_ID,
    configured: () => Boolean(keyOf()),
    buildRequest: (input) => {
      const r = sttRequest(input);
      return { url: r.url, headers: { Accept: "application/json" }, body: r.form };
    },
    async submit(input, d = {}) {
      const key = keyOf();
      if (!key) throw new MediaError("elevenlabs", "ELEVENLABS_API_KEY yo'q");
      const req = sttRequest(input);
      let body: unknown;
      try {
        const res = await elevenLabsFetch({ url: req.url, method: "POST", form: formData(req.form, mediaAsset(input)), accept: "application/json" }, { key, fetchImpl: d.fetchImpl, timeoutMs: timeoutOf(d) });
        body = await res.json().catch(() => null);
      } catch (e) {
        throw toSpeechError(e, "elevenlabs");
      }
      const result = sttResultOf(body);
      // The provider answered 200 (and billed): an unreadable body is not retried elsewhere.
      if (!result) throw new MediaError("elevenlabs", "speech-to-text answer without text / words", { accepted: true });
      return { done: [{ kind: "inline", bytes: new TextEncoder().encode(JSON.stringify(result)), mime: "application/json" }] };
    },
    async fetchOutput(o) {
      if (o.kind === "inline") return o.bytes;
      throw new MediaError("elevenlabs", "speech-to-text outputs are inline");
    },
  };
}

/**
 * The body, at most `cap` bytes: a declared `content-length` over the cap is refused before reading, and a streamed body
 * stops (and is cancelled) the moment it passes the cap — a 25 MB result never becomes a 2 GB buffer.
 */
export async function readCapped(res: Response, cap: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > cap) {
    await res.body?.cancel().catch(() => undefined);
    throw new MediaError("elevenlabs", `download ${declared} B over the ${cap} B cap`, { accepted: true });
  }
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) {
      await reader.cancel().catch(() => undefined);
      throw new MediaError("elevenlabs", `download over the ${cap} B cap`, { accepted: true });
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

/** `<dubbing_id>:<target>` → its parts; `null` for anything else. */
export function parseDubOp(opId: string): { id: string; lang: string } | null {
  const m = /^([A-Za-z0-9_-]{4,64}):([a-z]{2,3})$/.exec(opId);
  return m ? { id: m[1]!, lang: m[2]! } : null;
}

const SAFETY_RE = /moderat|policy|prohibit|copyright|not allowed/i;

export function dubAdapter(deps: TranscribeAdapterDeps = {}): MediaAdapter {
  const keyOf = deps.key ?? elevenLabsKey;
  const needKey = (): string => {
    const key = keyOf();
    if (!key) throw new MediaError("elevenlabs", "ELEVENLABS_API_KEY yo'q");
    return key;
  };
  return {
    id: DUB_ADAPTER_ID,
    configured: () => Boolean(keyOf()),
    buildRequest: (input) => {
      const r = dubRequest(input);
      return { url: r.url, headers: { Accept: "application/json" }, body: r.form };
    },
    async submit(input, d = {}) {
      const key = needKey();
      const req = dubRequest(input);
      let body: unknown;
      try {
        // The upload of ≤ 25 MB gets at most 120 s; the dub itself renders asynchronously.
        const res = await elevenLabsFetch({ url: req.url, method: "POST", form: formData(req.form, mediaAsset(input)), accept: "application/json" }, { key, fetchImpl: d.fetchImpl, timeoutMs: timeoutOf(d, 120_000) });
        body = await res.json().catch(() => null);
      } catch (e) {
        throw toSpeechError(e, "elevenlabs");
      }
      const id = body && typeof body === "object" ? (body as Record<string, unknown>).dubbing_id : undefined;
      if (typeof id !== "string" || !/^[A-Za-z0-9_-]{4,64}$/.test(id)) throw new MediaError("elevenlabs", "dubbing answer without a dubbing_id", { accepted: true });
      return { opId: `${id}:${req.form.fields.target_lang}` };
    },
    async poll(opId, d = {}): Promise<PollResult> {
      const op = parseDubOp(opId);
      if (!op) return { state: "failed", message: "bad dubbing op id", safety: false };
      const key = needKey();
      let body: Record<string, unknown>;
      try {
        const res = await elevenLabsFetch({ url: elevenLabsDubStatusUrl(op.id), method: "GET", accept: "application/json" }, { key, fetchImpl: d.fetchImpl, timeoutMs: timeoutOf(d, 30_000) });
        body = ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
      } catch (e) {
        throw toSpeechError(e, "elevenlabs");
      }
      const status = String(body.status ?? "");
      if (status === "dubbed") return { state: "done", outputs: [{ kind: "url", url: elevenLabsDubAudioUrl(op.id, op.lang) }] };
      if (status === "failed") {
        const message = typeof body.error === "string" && body.error ? body.error.slice(0, 300) : "dubbing failed";
        return { state: "failed", message, safety: SAFETY_RE.test(message) };
      }
      return { state: "running" };
    },
    async cancel(opId, d = {}) {
      const op = parseDubOp(opId);
      if (!op) return "cancelled";
      await elevenLabsFetch({ url: elevenLabsDubStatusUrl(op.id), method: "DELETE" }, { key: needKey(), fetchImpl: d.fetchImpl, timeoutMs: 15_000 });
      return "cancelled";
    },
    async fetchOutput(o: MediaOutput, d = {}) {
      if (o.kind === "inline") return o.bytes;
      // Only our own ElevenLabs download URL (built in `poll`) is ever fetched with the key.
      if (!o.url.startsWith(`${ELEVENLABS_DUB_URL}/`)) throw new MediaError("elevenlabs", "unexpected download url");
      try {
        const res = await elevenLabsFetch({ url: o.url, method: "GET", accept: "*/*" }, { key: needKey(), fetchImpl: d.fetchImpl, timeoutMs: timeoutOf(d, 120_000) });
        return await readCapped(res, SPEECH_TOOL_OUTPUT_MAX_BYTES);
      } catch (e) {
        if (e instanceof MediaError) throw e;
        throw toSpeechError(e, "elevenlabs");
      }
    },
  };
}

/** Every P10 adapter by id (the catalog routes name them). */
export function transcribeAdapters(deps: TranscribeAdapterDeps = {}): Record<string, MediaAdapter> {
  return { [STT_ADAPTER_ID]: sttAdapter(deps), [DUB_ADAPTER_ID]: dubAdapter(deps) };
}
