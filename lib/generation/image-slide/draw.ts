/**
 * AI slide: one call that draws one whole slide (docs/ai-slide/SPEC.md «Engine» 3).
 *
 * The same Gemini `interactions` endpoint as the Pro slayd pictures (`image-provider-gemini.ts`, whose response
 * parsing this reuses), but with the model the user bought (not the admin's `image.gemini` slot), 2K, 16:9 and,
 * for Nano Banana 2.1, thinking «minimal» (measured: same exact text, 36 s instead of 103 s, no thought tokens).
 *
 * The real cost of each call is recorded from the answer's `usage` tokens (`recordImageUsd`), so `cost_json` shows
 * what Google bills, not the price-table estimate.
 */
import { getProviderKey } from "../../server/providers/resolve";
import { errorDetail, findImagePart, firstText, geminiReason } from "../image-provider-gemini";
import type { ImageFailure } from "../image-provider";
import { recordImageUsd } from "../job-cost";
import { limiterFor } from "../llm/limiter";
import type { ImageSlideModel } from "./models";

const URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
/** One call's ceiling. Measured 29–36 s at 2K; Nano Banana 2.1 with default thinking took 103 s. */
export const SLIDE_DRAW_CAP_MS = 150_000;
/** No call starts with less time than this left: a slide that cannot finish would only be billed. */
export const SLIDE_DRAW_MIN_MS = 40_000;

/** USD per 1M tokens (https://ai.google.dev/gemini-api/docs/pricing, checked 2026-11-12). Thought tokens bill as output. */
const TOKEN_USD: Record<string, { in: number; out: number }> = {
  "gemini-nano-banana-2.1": { in: 1.5, out: 30 },
  "gemini-3-pro-image": { in: 2, out: 120 },
};

export type DrawRef = { base64: string; mime: string };
export type DrawResult =
  | { ok: true; base64: string; mime: string; usd: number }
  | { ok: false; reason: ImageFailure; detail: string };

/** USD of one answer from its `usage` block; the model's per-slide estimate when the block is missing. */
export function usageUsd(model: ImageSlideModel, usage: unknown): number {
  const rate = TOKEN_USD[model.api];
  const u = usage && typeof usage === "object" ? (usage as Record<string, unknown>) : null;
  const num = (k: string) => (u && typeof u[k] === "number" && Number.isFinite(u[k]) ? (u[k] as number) : 0);
  const tokensIn = num("total_input_tokens");
  const tokensOut = num("total_output_tokens") + num("total_thought_tokens");
  if (!rate || tokensOut <= 0) return model.usdPerSlide;
  return (tokensIn * rate.in + tokensOut * rate.out) / 1_000_000;
}

/** The request body: the reference picture first (the style to match), then the prompt. */
export function drawBody(model: ImageSlideModel, prompt: string, ref?: DrawRef | null) {
  return {
    model: model.api,
    input: [...(ref ? [{ type: "image", data: ref.base64, mime_type: ref.mime }] : []), { type: "text", text: prompt }],
    response_format: { type: "image", mime_type: "image/jpeg", aspect_ratio: "16:9", image_size: "2K" },
    ...(model.thinking ? { generation_config: { thinking_level: model.thinking } } : {}),
  };
}

export async function drawSlide(model: ImageSlideModel, prompt: string, ref: DrawRef | null, deadline: number): Promise<DrawResult> {
  const key = getProviderKey("gemini");
  if (!key) return { ok: false, reason: "no-key", detail: "GEMINI_API_KEY yo'q" };
  const left = deadline - Date.now();
  if (left < SLIDE_DRAW_MIN_MS) return { ok: false, reason: "timeout", detail: `vaqt qolmadi (${Math.round(left / 1000)} s)` };
  // Process-wide cap of AI slide draws (`PROVIDER_MAX_INFLIGHT["gemini-slide"]`): several decks must not flood the key.
  const release = await limiterFor("gemini-slide").acquire(Math.max(0, left - SLIDE_DRAW_MIN_MS));
  if (!release) return { ok: false, reason: "timeout", detail: "navbat kutib vaqt tugadi" };
  try {
    const budget = Math.min(SLIDE_DRAW_CAP_MS, deadline - Date.now());
    if (budget < SLIDE_DRAW_MIN_MS) return { ok: false, reason: "timeout", detail: "vaqt qolmadi" };
    const res = await fetch(URL, {
      method: "POST",
      signal: AbortSignal.timeout(budget),
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify(drawBody(model, prompt, ref)),
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch (e) {
      const aborted = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      return { ok: false, reason: aborted ? "timeout" : "failed", detail: "javob tanasi o'qilmadi" };
    }
    if (!res.ok) return { ok: false, reason: geminiReason(res.status), detail: `${res.status} ${errorDetail(body)}` };
    const rec = (body ?? {}) as Record<string, unknown>;
    const part = findImagePart(rec.steps);
    if (!part) {
      const said = firstText(rec.steps).slice(0, 160);
      return { ok: false, reason: "failed", detail: `javobda rasm yo'q${said ? `: ${said}` : ""}` };
    }
    const usd = usageUsd(model, rec.usage);
    recordImageUsd("gemini", model.api, usd);
    return { ok: true, base64: part.data, mime: part.mime, usd };
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { ok: false, reason: timedOut ? "timeout" : "failed", detail: e instanceof Error ? e.message : "network" };
  } finally {
    release();
  }
}
