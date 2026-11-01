/**
 * Image adapter of the media core (docs/studio/P0-SPEC.md §3.8, §6.3): wraps an EXISTING `ImageProvider` (Gemini,
 * OpenAI) so the core can route, health-track and record its calls without a rewrite — the request builders and their
 * probe tests stay untouched, the adapter only translates between the two contracts:
 *
 *   input   `AdapterInput.params` (+ `assets.inputImages`) → `ImageAsk`;
 *   output  `ImageOk` → `MediaOutput` (a `data:` URL becomes inline bytes, an https URL stays a URL);
 *   failure `ImageFail` → `MediaError` with the flags the router and the breaker act on.
 *
 * The translation back (`ImageResult` for the engines) lives in `lib/media/image.ts`; it is lossless because the error
 * carries the provider's own `reason` + `detail` (`ImageMediaError`) and each output remembers the `SlideImage` it came
 * from (`originalImage`), so callers' refusal handling, reports and refunds see exactly what the provider returned.
 */
import { MediaError, isRetryableStatus, type AdapterInput, type MediaAdapter, type MediaOutput } from "../../studio-core";
import { IMAGE_RATIOS } from "../../generation/image-studio-options";
import type { ImageAsk, ImageFail, ImageFailure, ImageProvider, SlideImage } from "../../generation/image-provider";

/** A `MediaError` that still knows the provider's original verdict, so the engines get their `ImageFail` back verbatim. */
export class ImageMediaError extends MediaError {
  readonly reason: ImageFailure;
  readonly detail: string;

  constructor(provider: string, fail: ImageFail, flags: { status?: number; retryable: boolean; safety: boolean; accepted: boolean }) {
    super(provider, fail.detail, flags);
    this.name = "ImageMediaError";
    this.reason = fail.reason;
    this.detail = fail.detail;
  }
}

/** Details of a `timeout` that never reached the provider: the stage budget was under 2 s, or the limiter's queue ran out. */
const NOT_SENT = /^byudjet 2 s dan kam|navbatida vaqt tugadi/;
/** 200 OK but no picture in the answer: the provider did the work (and may bill it) — a refusal or an empty answer. */
const NO_PICTURE = /^javobda rasm yo'q/;
/** The headers arrived and the body did not: the provider took the call. */
const BODY_LOST = /^javob tanasi o'qilmadi/;
/** OpenAI content-policy refusal (`image-provider-openai.ts errorDetail` leads with this code). */
const REFUSAL = /^moderation_blocked/;

type Flags = { status?: number; retryable: boolean; safety: boolean; accepted: boolean };

/**
 * The provider's verdict in the router's terms (`MediaError` in studio-core/types.ts):
 *
 *   no-key / blocked   account problems, never retried, nothing was started;
 *   rate               429 — retryable, the provider refused before doing anything;
 *   timeout            retryable; `accepted` once the HTTP call started (the provider may be drawing and billing —
 *                      a second route would double the cost), not when the call never left (budget < 2 s, limiter queue);
 *   failed             5xx / network — retryable and not accepted; a 4xx other than 429 is a bad request (not retryable,
 *                      no point asking another route); a content-policy refusal is `safety` (no fallback, the user gets
 *                      the refusal message); «no picture in a 200» and «body lost» are `accepted` (the provider answered).
 */
export function failureFlags(fail: ImageFail): Flags {
  const parsed = Number(/^(\d{3})\s/.exec(fail.detail)?.[1]);
  const status = Number.isInteger(parsed) && parsed >= 100 ? parsed : undefined;
  const flags = (retryable: boolean, accepted: boolean, safety = false): Flags => ({ ...(status !== undefined ? { status } : {}), retryable, safety, accepted });
  switch (fail.reason) {
    case "no-key":
    case "blocked":
      return flags(false, false);
    case "rate":
      return flags(true, false);
    case "timeout":
      return flags(true, !NOT_SENT.test(fail.detail));
    case "failed":
      if (REFUSAL.test(fail.detail)) return flags(false, false, true);
      if (NO_PICTURE.test(fail.detail)) return flags(false, true);
      if (BODY_LOST.test(fail.detail)) return flags(true, true);
      return flags(status === undefined || isRetryableStatus(status), false);
  }
}

/** Each output remembers the image it was made from, so the engines get the provider's own `SlideImage` (url + alt) back. */
const ORIGINAL = new WeakMap<object, SlideImage>();

export function originalImage(o: MediaOutput): SlideImage | undefined {
  return ORIGINAL.get(o);
}

function parseDataUrl(url: string): { mime: string; base64: string } | null {
  if (!url.startsWith("data:")) return null;
  const comma = url.indexOf(",");
  if (comma < 0) return null;
  const head = url.slice(5, comma).toLowerCase();
  if (!head.endsWith(";base64")) return null;
  const mime = head.slice(0, -";base64".length);
  return /^[\w.+-]+\/[\w.+-]+$/.test(mime) ? { mime, base64: url.slice(comma + 1) } : null;
}

export function outputOf(image: SlideImage): MediaOutput {
  const data = parseDataUrl(image.url);
  const out: MediaOutput = data ? { kind: "inline", bytes: new Uint8Array(Buffer.from(data.base64, "base64")), mime: data.mime } : { kind: "url", url: image.url };
  ORIGINAL.set(out, image);
  return out;
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/**
 * `ImageAsk` from the call's params. The engines send `prompt` (the COMPOSED prompt), `width`, `height` and `styleId`
 * through `extra`; with schema values only (a future generic caller) the size comes from the `imageRatio` preset and the
 * style from `imageStyle`. The reference images (portrait selfie) come in as the `inputImages` asset list.
 */
export function askOf(input: AdapterInput): ImageAsk {
  const p = input.params;
  const ratio = IMAGE_RATIOS.find((r) => r.id === p.imageRatio) ?? IMAGE_RATIOS[0];
  const ask: ImageAsk = {
    prompt: String(p.prompt ?? ""),
    size: { width: num(p.width) ?? ratio.w, height: num(p.height) ?? ratio.h },
    styleId: String(p.styleId ?? p.imageStyle ?? "photo") as ImageAsk["styleId"],
  };
  const inputs = input.assets?.inputImages;
  if (inputs?.length) ask.inputImages = inputs.map((i) => ({ mime: i.mime, base64: i.base64 }));
  const seed = num(p.seed);
  if (seed !== undefined) ask.seed = seed;
  if (typeof p.premium === "boolean") ask.premium = p.premium;
  return ask;
}

/**
 * `configured()` is always true: a missing key is the provider's own `no-key` answer (no network, same detail the old
 * path returns). Returning `hasKey()` here would make the router answer «no route available» and the engines would lose
 * the reason — `attachSlideImages` counts `no-key` as blocked, not failed.
 */
export function imageProviderAdapter(adapterId: string, provider: ImageProvider): MediaAdapter {
  return {
    id: adapterId,
    configured: () => true,
    async submit(input, deps) {
      const res = await provider.fetchImage(askOf(input), deps?.deadline);
      if (res.ok) return { done: [outputOf(res.image)] };
      throw new ImageMediaError(provider.id, res, failureFlags(res));
    },
    /**
     * Not used on the sync image path (the engines download a URL output themselves, exactly as before, through
     * `fetchImageBytes`); present for the contract. `fetchImageBytes` keeps its https-only / SSRF / size rules.
     */
    async fetchOutput(o) {
      if (o.kind === "inline") return o.bytes;
      const { fetchImageBytes } = await import("../../generation/slide-images");
      const got = await fetchImageBytes(o.url);
      if (!got) throw new MediaError(provider.id, "image output could not be downloaded");
      return new Uint8Array(Buffer.from(got.data.slice(got.data.indexOf("base64,") + "base64,".length), "base64"));
    },
  };
}
