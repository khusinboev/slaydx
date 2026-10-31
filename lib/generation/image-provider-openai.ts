/**
 * OpenAI image provider (program-17 item 5, decision D7) -- the «ChatGPT» choice of the `rasm` tool.
 *
 * Sources (checked 2026-10-24):
 *   - guide:   https://platform.openai.com/docs/guides/image-generation
 *              (redirects to https://developers.openai.com/api/docs/guides/image-generation)
 *   - model:   https://developers.openai.com/api/docs/models/gpt-image-2.5-flare
 *   - pricing: https://developers.openai.com/api/docs/pricing
 *
 * Model: `gpt-image-2.5-flare` ("fast, high-quality everyday image generation"; the sibling
 * `gpt-image-2.5-sunburst` is the editing-precision model, which a text-to-image tool does not need).
 * Override with `OPENAI_IMAGE_MODEL`.
 *
 *   POST https://api.openai.com/v1/images/generations
 *   Authorization: Bearer <key>
 *   {"model":"gpt-image-2.5-flare","prompt":"…","n":1,"size":"1280x720","quality":"medium",
 *    "output_format":"jpeg","output_compression":90,"moderation":"auto"}
 *
 * Answer: `{ data: [{ b64_json }], usage: { input_tokens, output_tokens, input_tokens_details } }`.
 * The base64 image is in `data[0].b64_json` (these models never return a URL).
 *
 * Sizes: the GPT Image 2.x models take any `WxH` that has both edges a multiple of 16, an aspect ratio
 * between 1:3 and 3:1, no edge above 3840 and between 655 360 and 8 294 400 pixels. `openaiSizeFor` picks
 * the pair closest to the slot ratio at about 1 MP (1024x1024 for a square), so the picture comes out in
 * the ratio the user chose instead of a cropped «landscape/portrait» preset.
 *
 * Refusal: a blocked prompt is an HTTP 400 with `error.code = "moderation_blocked"` (the docs advise not
 * to retry it unchanged). It is a plain `failed` with a detail that names the refusal -- no image, so the
 * `rasm` engine ends in its existing «Rasm yaratilmadi» error and the worker refunds the job.
 *
 * Secrets: the key travels only in the `Authorization` header. It is never logged, and a provider error
 * text (OpenAI echoes a masked key in «Incorrect API key provided») is scrubbed before it reaches a log
 * line or the result detail.
 *
 * NOT verified live: there is no OpenAI key on the build machine. The request/response shape follows the
 * docs above and is locked by `tests/image-provider-openai.test.mts` with a stubbed `fetch`.
 */
import { requestBudget, type ImageFailure, type ImageAsk, type ImageProvider, type ImageResult } from "./image-provider";
import { recordImageUsd } from "./job-cost";
import { OPENAI_IMAGE_FALLBACK_USD, imagePriceOf, openaiImageUsd } from "./llm-pricing";
import { getProviderKey } from "../server/providers/resolve";

/** One request's ceiling (task spec: 90 s). The stage budget still caps it (`requestBudget` takes the smaller). */
export const OPENAI_IMAGE_CAP_MS = 90_000;

const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations";
export const OPENAI_IMAGE_DEFAULT_MODEL = "gpt-image-2.5-flare";
/** `medium` is the price/quality middle; the admin price (`image-models.ts`) is set for it. */
export const OPENAI_IMAGE_QUALITY = "medium";
const OUTPUT_FORMAT = "jpeg";
const OUTPUT_COMPRESSION = 90;

export function openaiImageModel(): string {
  return process.env.OPENAI_IMAGE_MODEL?.trim() || OPENAI_IMAGE_DEFAULT_MODEL;
}

export function openaiImageKey(): string {
  return getProviderKey("openai-image");
}

// ── size mapping ────────────────────────────────────────────────────────────────────────────

const TARGET_PIXELS = 1024 * 1024;
const MIN_PIXELS = 655_360;
const MAX_PIXELS = 8_294_400;
const MAX_EDGE = 3840;

/** `true` when `WxH` satisfies the documented limits of the GPT Image 2.x models. */
export function isValidOpenaiSize(w: number, h: number): boolean {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) return false;
  if (w % 16 !== 0 || h % 16 !== 0) return false;
  if (w > MAX_EDGE || h > MAX_EDGE) return false;
  const r = w / h;
  if (r < 1 / 3 - 1e-9 || r > 3 + 1e-9) return false;
  const px = w * h;
  return px >= MIN_PIXELS && px <= MAX_PIXELS;
}

/**
 * The `size` string for a slot: both edges multiples of 16, ratio as close to the slot's as the grid allows,
 * about 1 MP. Ratios outside 1:3..3:1 are clamped. Pure.
 */
export function openaiSizeFor(size: { width: number; height: number }): string {
  const raw = Math.max(1, size.width) / Math.max(1, size.height);
  const target = Math.min(3, Math.max(1 / 3, raw));
  let best = { w: 1024, h: 1024, score: Infinity };
  for (let h = 256; h <= 2048; h += 16) {
    const w = Math.round((h * target) / 16) * 16;
    if (!isValidOpenaiSize(w, h)) continue;
    const ratioErr = Math.abs(Math.log(w / h) - Math.log(target));
    const pixelErr = Math.abs(Math.log((w * h) / TARGET_PIXELS));
    const score = ratioErr * 20 + pixelErr;
    if (score < best.score) best = { w, h, score };
  }
  return `${best.w}x${best.h}`;
}

// ── errors ──────────────────────────────────────────────────────────────────────────────────

/**
 * 401/403 -- key or organisation (GPT Image needs a verified organisation: a 403): `blocked`, the stage
 * stops asking. 429 -- rate limit. Everything else, a moderation refusal included, is `failed`.
 */
function openaiReason(status: number): ImageFailure {
  if (status === 401 || status === 402 || status === 403) return "blocked";
  if (status === 429) return "rate";
  return "failed";
}

/** Removes the key and anything shaped like an OpenAI key from a provider message. */
export function scrubSecrets(text: string, key: string): string {
  let out = key ? text.split(key).join("[key]") : text;
  out = out.replace(/sk-[A-Za-z0-9_*\-.]{4,}/g, "[key]");
  return out;
}

type ErrorBody = { error?: { message?: unknown; code?: unknown; type?: unknown } | string; message?: unknown };

/** `moderation_blocked` / `…` code plus a short message. The code leads, so callers can recognise a refusal. */
function errorDetail(body: unknown, key: string): { detail: string; refused: boolean } {
  const rec = (body && typeof body === "object" ? body : {}) as ErrorBody;
  const err = typeof rec.error === "object" && rec.error ? rec.error : null;
  const code = typeof err?.code === "string" ? err.code : "";
  const type = typeof err?.type === "string" ? err.type : "";
  const refused = code === "moderation_blocked" || type === "image_generation_user_error";
  const message =
    typeof err?.message === "string" && err.message
      ? err.message
      : typeof rec.error === "string"
        ? rec.error
        : typeof rec.message === "string" && rec.message
          ? rec.message
          : "request failed";
  const head = refused ? "moderation_blocked" : code || type;
  return { detail: scrubSecrets(head ? `${head}: ${message}` : message, key).slice(0, 240), refused };
}

// ── request ─────────────────────────────────────────────────────────────────────────────────

type Usage = { input_tokens?: unknown; output_tokens?: unknown; input_tokens_details?: { text_tokens?: unknown; image_tokens?: unknown } };

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
}

/** USD of one answer: from the reported token usage when present, else the documented medium-quality estimate. */
function costOf(usage: Usage | undefined, model: string): number {
  if (usage && num(usage.output_tokens) > 0) {
    const d = usage.input_tokens_details;
    const text = num(d?.text_tokens);
    const image = num(d?.image_tokens);
    // A usage without the split bills the whole input as text (the cheaper side would understate the cost).
    const rest = d ? 0 : num(usage.input_tokens);
    return openaiImageUsd({ textIn: text + rest, imageIn: image, imageOut: num(usage.output_tokens) });
  }
  return imagePriceOf(model) ?? OPENAI_IMAGE_FALLBACK_USD;
}

export async function requestOpenaiImage(ask: ImageAsk, deadline?: number): Promise<ImageResult> {
  const key = openaiImageKey();
  if (!key) return { ok: false, reason: "no-key", detail: "OPENAI_API_KEY yo'q" };
  const budget = requestBudget(deadline, OPENAI_IMAGE_CAP_MS);
  if (budget === null) return { ok: false, reason: "timeout", detail: "byudjet 2 s dan kam" };

  const model = openaiImageModel();
  try {
    const res = await fetch(OPENAI_IMAGES_URL, {
      method: "POST",
      signal: AbortSignal.timeout(budget),
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: ask.prompt,
        n: 1,
        size: openaiSizeFor(ask.size),
        quality: OPENAI_IMAGE_QUALITY,
        output_format: OUTPUT_FORMAT,
        output_compression: OUTPUT_COMPRESSION,
        moderation: "auto",
      }),
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch (e) {
      const aborted = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      const line = `javob tanasi o'qilmadi (${e instanceof Error ? e.name : "xato"}, byudjet ${Math.round(budget / 1000)} s)`;
      console.warn("[openai-image]", line);
      return { ok: false, reason: aborted ? "timeout" : "failed", detail: line };
    }
    if (!res.ok) {
      const { detail, refused } = errorDetail(body, key);
      // A refusal leads with its code (`isRefusal` in image-studio.ts matches the prefix); other errors lead with the status.
      const line = refused ? detail : `${res.status} ${detail}`;
      const reason = openaiReason(res.status);
      if (reason === "blocked") console.error("[openai-image] provayder rad etdi (hisob/kalit):", line);
      else console.warn("[openai-image]", refused ? `kontent siyosati rad etdi: ${line}` : line);
      return { ok: false, reason, detail: line };
    }
    const rec = (body && typeof body === "object" ? body : {}) as { data?: unknown; usage?: Usage; output_format?: unknown };
    const first = Array.isArray(rec.data) ? (rec.data[0] as { b64_json?: unknown } | undefined) : undefined;
    const b64 = typeof first?.b64_json === "string" ? first.b64_json : "";
    // A base64 shorter than 64 characters is not a picture (same guard as the Gemini adapter).
    if (b64.length <= 64) {
      const line = `javobda rasm yo'q (data=${Array.isArray(rec.data) ? rec.data.length : typeof rec.data})`;
      console.warn("[openai-image]", line);
      return { ok: false, reason: "failed", detail: line };
    }
    const fmt = typeof rec.output_format === "string" ? rec.output_format.toLowerCase() : OUTPUT_FORMAT;
    const mime = fmt === "png" ? "image/png" : fmt === "webp" ? "image/webp" : "image/jpeg";
    // Paid picture -> the job's cost meter (no-op outside a job context).
    recordImageUsd("openai", model, costOf(rec.usage, model));
    // `data:` URL: `persistImage`/`fetchImageBytes` decode it and SNIFF the bytes (a wrong mime cannot pass).
    return { ok: true, image: { url: `data:${mime};base64,${b64}`, alt: ask.prompt.slice(0, 80) } };
  } catch (e) {
    const msg = scrubSecrets(e instanceof Error ? e.message : "network", key);
    console.warn("[openai-image]", msg);
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { ok: false, reason: timedOut ? "timeout" : "failed", detail: msg };
  }
}

export const openaiProvider: ImageProvider = {
  // GPT Image answers in ~15-40 s for a medium 1 MP picture; below this the call would be cut off.
  minMs: 30_000,
  id: "openai",
  hasKey: () => Boolean(openaiImageKey()),
  fetchImage: requestOpenaiImage,
};
