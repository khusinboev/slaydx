/**
 * The image engines' door to the media core (docs/studio/P0-SPEC.md §6.3, switch `media.core.image`).
 *
 * `coreImageProvider` is an `ImageProvider` like any other, so `buildImageArtifact`, the portrait engine and
 * `attachSlideImages` keep their loops, budgets, reports and refunds untouched: each `fetchImage` is ONE `runMedia`
 * call (route → breaker health → a `media_jobs` row inside a job) around the SAME base provider, and what comes back
 * is the base provider's own `ImageResult` — same `reason` and `detail` on failure (refusal and report logic read
 * them), the very same `SlideImage` on success. Callers pick it only when `mediaCoreOn("image")`; with the switch off or
 * outside a job they never reach this file.
 *
 * Wiring rule: the process limiter wraps the core provider from OUTSIDE (`limitedProvider(coreImageProvider(…))`),
 * exactly where it wrapped the bare provider. A call that waits in the limiter's queue (or times out there, «provayder
 * navbatida vaqt tugadi») therefore never starts a `media_jobs` row and never counts against the provider's breaker —
 * it did not reach the provider — and the number of calls in flight is unchanged.
 */
import { createHash } from "node:crypto";
import { MediaError, costUsd, normalize, type MediaAdapter, type ParamValue } from "../studio-core";
import { MEDIA_CATALOG } from "./catalog";
import { nextMediaStep } from "./context";
import { ImageMediaError, imageProviderAdapter, originalImage } from "./adapters/image";
import { runMedia } from "../server/media/run";
import { IMAGE_RATIOS, IMAGE_STYLES } from "../generation/image-studio-options";
import { imagePriceOf } from "../generation/llm-pricing";
import { recordImageUsd } from "../generation/job-cost";
import type { ImageAsk, ImageFailure, ImageProvider, ImageProviderId, ImageResult } from "../generation/image-provider";

export type CoreImageOpts = {
  /** Upstream model of the route right now: the admin slot (`image.gemini`) or env, so `media_jobs.upstream_model` is true. */
  upstream: () => string;
  /** Param values to record in `media_jobs.params` over what is derived from the ask (e.g. the user's own prompt and style). */
  values?: Readonly<Record<string, unknown>>;
};

/** The catalog ratio preset closest to the slot (log distance), for the recorded `imageRatio`; the real size travels in `extra`. */
function nearestRatio(size: { width: number; height: number }): string {
  const target = Math.log(Math.max(1, size.width) / Math.max(1, size.height));
  let best: string = IMAGE_RATIOS[0].id;
  let bestDist = Infinity;
  for (const r of IMAGE_RATIOS) {
    const dist = Math.abs(Math.log(r.w / r.h) - target);
    if (dist < bestDist) {
      bestDist = dist;
      best = r.id;
    }
  }
  return best;
}

/** What identifies a picture inside a job for the idempotency key: the composed prompt (`nextMediaStep` documents why). */
const tagOf = (ask: ImageAsk) => createHash("sha1").update(ask.prompt).digest("hex").slice(0, 12);

export function coreImageProvider(purpose: string, modelId: string, base: ImageProvider, opts: CoreImageOpts): ImageProvider {
  const failed = (detail: string): ImageResult => ({ ok: false, reason: "failed", detail });
  return {
    id: base.id,
    minMs: base.minMs,
    hasKey: () => base.hasKey(),
    async fetchImage(ask, deadline) {
      const adapterId = MEDIA_CATALOG.byId(modelId)?.routes[0]?.adapter;
      const extra: Record<string, ParamValue> = { prompt: ask.prompt, width: ask.size.width, height: ask.size.height, styleId: ask.styleId };
      if (ask.seed !== undefined) extra.seed = ask.seed;
      if (ask.premium !== undefined) extra.premium = ask.premium;
      try {
        const out = await runMedia({
          purpose,
          modelId,
          values: {
            prompt: ask.prompt,
            imageStyle: IMAGE_STYLES.some((s) => s.id === ask.styleId) ? ask.styleId : undefined,
            imageRatio: nearestRatio(ask.size),
            imageCount: 1,
            ...opts.values,
          },
          extra,
          costUsd: imagePriceOf(opts.upstream()) ?? undefined,
          assets: ask.inputImages?.length ? { inputImages: ask.inputImages } : undefined,
          step: nextMediaStep("image", tagOf(ask)),
          adapters: adapterId ? { [adapterId]: imageProviderAdapter(adapterId, base) } : {},
          upstream: () => opts.upstream(),
          deps: { deadline },
        });
        const first = out.outputs[0];
        if (!first) return failed("javobda rasm yo'q (media core: no outputs)");
        const image = originalImage(first) ?? { url: first.kind === "inline" ? `data:${first.mime};base64,${Buffer.from(first.bytes).toString("base64")}` : first.url, alt: ask.prompt.slice(0, 80) };
        return { ok: true, image };
      } catch (e) {
        // The provider's own verdict, verbatim; anything else the core says (no route, unknown model) is a plain failure.
        if (e instanceof ImageMediaError) return { ok: false, reason: e.reason, detail: e.detail };
        if (e instanceof MediaError) return failed(e.message);
        throw e;
      }
    },
  };
}

export type CoreAdapterOpts = {
  /** The `ImageProvider` id (limiter `<id>-image`, logs). */
  id: ImageProviderId;
  /** Shortest useful time for one picture (the limiter does not start a call with less left). */
  minMs: number;
  /** Param values recorded in `media_jobs.params` and priced (the user's prompt, style, ratio, the model's own params). */
  values?: Readonly<Record<string, unknown>>;
};

/**
 * A provider's `MediaError` in the engines' `ImageFailure` terms. A content-policy refusal keeps the
 * `moderation_blocked` lead (`image-studio.ts isRefusal` gives the user the «change the description» message, as for
 * OpenAI); an account answer (401 / 402 / 403) is `blocked`; 429 is `rate`; a timeout is `timeout`.
 */
export function failureOf(e: MediaError): { reason: ImageFailure; detail: string } {
  const detail = `${e.status ? `${e.status} ` : ""}${e.message}`.replace(/^(\d{3}) \1 /, "$1 ");
  if (e.safety) return { reason: "failed", detail: `moderation_blocked (${e.provider}): ${e.message}` };
  if (e.status === 401 || e.status === 402 || e.status === 403) return { reason: "blocked", detail };
  if (e.status === 429) return { reason: "rate", detail };
  if (/vaqt tugadi|byudjet|timeout|aborted/i.test(e.message)) return { reason: "timeout", detail };
  return { reason: "failed", detail };
}

/**
 * An `ImageProvider` that draws with a NATIVE media-core adapter (fal, docs/studio/P2-SPEC.md) — no legacy provider
 * behind it. Each `fetchImage` is one `runMedia` call (router, breaker, a `media_jobs` row), bounded by the job's
 * deadline AND the model's own `limits.timeoutMs`; the inline output comes back as a `data:` URL, the spend is metered
 * (`recordImageUsd`, the catalog cost of one picture with these params), and a failure is translated by `failureOf`.
 * The limiter wraps it from outside, as for the other providers (`limitedProvider(coreAdapterImageProvider(…))`).
 */
export function coreAdapterImageProvider(purpose: string, modelId: string, adapter: MediaAdapter, opts: CoreAdapterOpts): ImageProvider {
  const entry = MEDIA_CATALOG.byId(modelId);
  const route = entry?.routes.find((r) => r.adapter === adapter.id);
  return {
    id: opts.id,
    minMs: opts.minMs,
    hasKey: () => adapter.configured(),
    async fetchImage(ask, deadline) {
      if (!entry || !route) return { ok: false, reason: "failed", detail: `media core: ${modelId} has no ${adapter.id} route` };
      const values = { prompt: ask.prompt, imageRatio: nearestRatio(ask.size), ...opts.values, imageCount: 1 };
      const cap = Date.now() + entry.limits.timeoutMs;
      try {
        const out = await runMedia({
          purpose,
          modelId,
          values,
          extra: { prompt: ask.prompt, width: ask.size.width, height: ask.size.height },
          step: nextMediaStep("image", tagOf(ask)),
          adapters: { [adapter.id]: adapter },
          deps: { deadline: deadline === undefined ? cap : Math.min(deadline, cap) },
        });
        const first = out.outputs[0];
        if (!first || first.kind !== "inline") return { ok: false, reason: "failed", detail: "javobda rasm yo'q (media core: no inline output)" };
        recordImageUsd(out.route.provider, out.route.upstreamModel, costUsd(entry.cost, normalize(entry.params, values)));
        return { ok: true, image: { url: `data:${first.mime};base64,${Buffer.from(first.bytes).toString("base64")}`, alt: ask.prompt.slice(0, 80) } };
      } catch (e) {
        if (e instanceof MediaError) return { ok: false, ...failureOf(e) };
        throw e;
      }
    },
  };
}
