/**
 * Studio P9 «Musiqa» through Google Lyria (docs/studio/P9-SPEC.md) on the Gemini key — ONE synchronous call of the
 * Gemini Interactions API (https://ai.google.dev/gemini-api/docs/music-generation, read 2026-11-03):
 *
 *   POST https://generativelanguage.googleapis.com/v1beta/interactions
 *   headers  x-goog-api-key, Api-Revision: 2026-05-20
 *   body     { model: "lyria-3-clip-preview" | "lyria-3.5", input: "<prompt>" }
 *   answer   { status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: "<lyrics>" }] },
 *                                           { type: "model_output", content: [{ type: "audio", mime_type: "audio/mpeg", data: "<base64>" }] }] }
 *
 * The answer shape was confirmed by one live clip on 2026-11-03 (200 in 12.8 s, an ID3-tagged MP3 of ~745 KB). The
 * clip model always makes 30 s; Lyria 3.5 makes a full song whose length the prompt steers. «Faqat kuy» is the
 * documented prompt instruction («Instrumental only, no vocals.»), the API has no field for it.
 *
 * Failure mapping: 429 / 5xx / network retryable; a call cut by our own timeout is `accepted` (Google may bill it);
 * a blocked prompt (400 with a safety / policy text, or a completed answer without audio that says so) is `safety`.
 * The key never appears in a message.
 */
import { MediaError, type AdapterInput, type MediaAdapter, type NormalizedParams } from "../../studio-core";
import { mp3Seconds } from "../../generation/tts/mp3";
import { geminiKey } from "../../generation/tts/gemini";
import { lyriaUpstreamOf } from "../catalog-audio";

export const LYRIA_PROVIDER = "gemini";
export const LYRIA_ADAPTER_ID = "studio-gemini-lyria";
export const LYRIA_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
export const LYRIA_API_REVISION = "2026-05-20";
/** The prompt line that asks for no vocals (the docs' own wording). */
export const LYRIA_INSTRUMENTAL = "Instrumental only, no vocals.";
/** A full song is a few MB of MP3; the base64 answer is capped well above that. */
const ANSWER_MAX_BYTES = 48 * 1024 * 1024;
const CALL_MS = 240_000;
const BLOCKED = /safety|blocked|policy|prohibited|copyright|not allowed/i;
/** Lyrics kept with a song (a full song's lyrics are a few KB). */
export const LYRICS_MAX_CHARS = 8000;

/** The lyrics worth showing: none for an instrumental (Lyria answers «<instrumental>»), trimmed and capped. Pure. */
export function lyricsOf(text: string): string | null {
  const t = text.replace(/\r\n?/g, "\n").trim();
  if (!t || /^<[^>]*>$/.test(t)) return null;
  return t.slice(0, LYRICS_MAX_CHARS);
}

export type LyriaDeps = { key?: () => string };

const bool = (v: unknown): boolean => v === true || v === "true";

/** The pure request (no key inside). */
export function lyriaRequest(input: Pick<AdapterInput, "params">): { url: string; json: { model: string; input: string } } {
  const p: NormalizedParams = input.params;
  const prompt = String(p.prompt ?? "").trim();
  if (!prompt) throw new MediaError(LYRIA_PROVIDER, "music needs a prompt");
  const model = lyriaUpstreamOf(p.length);
  return { url: LYRIA_URL, json: { model, input: bool(p.instrumental) ? `${prompt}\n\n${LYRIA_INSTRUMENTAL}` : prompt } };
}

type Block = { type?: unknown; text?: unknown; data?: unknown; mime_type?: unknown };
type Answer = { status?: unknown; steps?: { type?: unknown; content?: Block[] }[]; error?: { message?: unknown } };

/** The MP3 and the lyrics text of a completed answer; `null` audio when there is none. Pure. */
export function lyriaOutput(answer: Answer | null): { mp3: Uint8Array | null; text: string } {
  const blocks = (answer?.steps ?? []).filter((s) => s?.type === "model_output").flatMap((s) => (Array.isArray(s.content) ? s.content : []));
  const text = blocks
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => String(b.text))
    .join("\n")
    .trim();
  const audio = blocks.find((b) => b?.type === "audio" && typeof b.data === "string" && b.data && (b.mime_type === undefined || b.mime_type === "audio/mpeg"));
  if (!audio) return { mp3: null, text };
  const bytes = new Uint8Array(Buffer.from(String(audio.data), "base64"));
  // Frames, not the tag or the mime: an answer that does not decode as MP3 is no result.
  return { mp3: bytes.length && mp3Seconds(bytes) > 0 ? bytes : null, text };
}

/** The body as text, read with a byte cap (`null` past it): a stated size is refused before reading. */
async function capped(res: Response): Promise<string | null> {
  if (Number(res.headers.get("content-length") ?? 0) > ANSWER_MAX_BYTES) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > ANSWER_MAX_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const scrub = (msg: string, key: string | null) => (key ? msg.split(key).join("<key>") : msg);

const timeoutOf = (d: { deadline?: number; now?: () => number }): number =>
  d.deadline ? Math.max(1_000, Math.min(CALL_MS, d.deadline - (d.now ?? Date.now)())) : CALL_MS;

export function lyriaAdapter(deps: LyriaDeps = {}): MediaAdapter {
  const keyOf = deps.key ?? geminiKey;
  return {
    id: LYRIA_ADAPTER_ID,
    configured: () => Boolean(keyOf()),
    buildRequest: (input) => {
      const r = lyriaRequest(input);
      return { url: r.url, headers: { "Content-Type": "application/json", "Api-Revision": LYRIA_API_REVISION }, body: r.json };
    },
    async submit(input, d = {}) {
      const key = keyOf();
      if (!key) throw new MediaError(LYRIA_PROVIDER, "GEMINI_API_KEY yo'q");
      const fail = (msg: string, f: { status?: number; retryable?: boolean; safety?: boolean; accepted?: boolean } = {}) => new MediaError(LYRIA_PROVIDER, scrub(msg, key), f);
      const req = lyriaRequest(input);
      let res: Response;
      try {
        res = await (d.fetchImpl ?? globalThis.fetch)(req.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Api-Revision": LYRIA_API_REVISION, "x-goog-api-key": key },
          body: JSON.stringify(req.json),
          redirect: "manual",
          signal: AbortSignal.timeout(timeoutOf(d)),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // Our own timeout cut a call Google is still making (and may bill): accepted, never resent elsewhere.
        const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
        throw fail(`lyria: ${msg}`, { retryable: !timedOut, accepted: timedOut });
      }
      const raw = await capped(res);
      if (raw === null) throw fail("lyria: javob juda katta", { accepted: true });
      let answer: Answer | null = null;
      try {
        answer = JSON.parse(raw) as Answer;
      } catch {
        answer = null;
      }
      if (!res.ok) {
        const detail = typeof answer?.error?.message === "string" ? answer.error.message : raw.slice(0, 300);
        const retryable = res.status === 429 || res.status >= 500;
        // Only a 400 is a refused prompt; a 401 / 403 «not allowed» is a key / project problem, not a content block.
        throw fail(`lyria ${res.status}: ${detail}`, { status: res.status, retryable, safety: res.status === 400 && BLOCKED.test(detail) });
      }
      const { mp3, text } = lyriaOutput(answer);
      if (!mp3) throw fail(`lyria: javobda audio yo'q${text ? ` (${text.slice(0, 200)})` : ""}`, { safety: BLOCKED.test(text) });
      const lyrics = lyricsOf(text);
      return { done: [{ kind: "inline", bytes: mp3, mime: "audio/mpeg", ...(lyrics ? { text: lyrics } : {}) }] };
    },
    async fetchOutput(o) {
      if (o.kind === "inline") return o.bytes;
      throw new MediaError(LYRIA_PROVIDER, "audio outputs are inline");
    },
  };
}
