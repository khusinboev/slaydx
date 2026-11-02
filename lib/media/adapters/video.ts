/**
 * Video adapters on the media core (docs/studio/P0-SPEC.md §3.8, §6.4): today's `VideoAdapter`s (`lib/generation/video`)
 * wrapped as `MediaAdapter`s. Nothing about the provider HTTP calls changes: `buildRequest` / `submit` / `poll` /
 * `download` are the same functions, only the shapes are translated.
 *
 * Failure mapping (`VideoProviderError` → `MediaError`): `retryable` and `safety` are kept as they are. `accepted` is
 * `false` ONLY for a submit the provider answered with an HTTP error status (it said no: it holds no job of ours). A
 * submit error without a status (timeout, network drop, abort, an answer without an operation id) may have reached the
 * provider and started a paid job we never heard about, so it is `accepted: true` -- the router must not send the same
 * clip to a second route. Errors of `poll` / `fetchOutput` are always `accepted: true` (the operation exists).
 *
 * Client-safe like the wrapped adapters: no server imports.
 */
import { MediaError, type AdapterDeps, type AdapterInput, type MediaAdapter, type MediaOutput, type PollResult } from "../../studio-core";
import { MEDIA_CATALOG, VIDEO_PROVIDER_TO_MEDIA } from "../catalog";
import {
  KLING_V3_ASPECTS,
  VIDEO_ASPECTS,
  VIDEO_PROVIDER_IDS,
  VideoProviderError,
  buildKlingEffectRequest,
  buildKlingV3Request,
  downloadKlingVideo,
  klingKey,
  omniAdapter,
  parseKlingKey,
  pollKlingTask,
  submitKlingTask,
  type KlingTaskRequest,
  type KlingV3Aspect,
  type KlingV3Input,
  type KlingV3Mode,
  type VideoAdapter,
  type VideoAspect,
  type VideoMedia,
  type VideoProviderId,
  type VideoRequestInput,
} from "../../generation/video";

/** The provider's own request input, from the core input (normalized params + the resolved start image). */
export function videoRequestInput(input: Omit<AdapterInput, "upstreamModel" | "idempotencyKey">): VideoRequestInput {
  const p = input.params;
  const aspect: VideoAspect = (VIDEO_ASPECTS as readonly string[]).includes(String(p.aspect)) ? (p.aspect as VideoAspect) : VIDEO_ASPECTS[0];
  const image = input.assets?.imageAssetId?.[0];
  return { prompt: String(p.prompt ?? ""), seconds: Number(p.seconds), aspect, ...(image ? { image: { mime: image.mime, base64: image.base64 } } : {}) };
}

/** Any other error (a bug, a TypeError) is passed through unchanged: the router rethrows it and the host fails the job. */
function toMediaError(e: unknown, accepted: boolean): unknown {
  if (!(e instanceof VideoProviderError)) return e;
  return new MediaError(e.provider, e.message, { status: e.status, retryable: e.retryable, safety: e.safety, accepted });
}

const toOutput = (m: VideoMedia): MediaOutput => (m.kind === "inline" ? { kind: "inline", bytes: m.bytes, mime: "video/mp4" } : { kind: "url", url: m.url, mime: "video/mp4" });
const toMedia = (o: MediaOutput): VideoMedia => (o.kind === "inline" ? { kind: "inline", bytes: o.bytes } : { kind: "url", url: o.url });
const videoDeps = (deps?: AdapterDeps) => (deps?.fetchImpl ? { fetchImpl: deps.fetchImpl } : {});

export function videoAdapter(adapterId: string, a: VideoAdapter): MediaAdapter {
  return {
    id: adapterId,
    configured: () => a.configured(),
    buildRequest: (input) => a.buildRequest(videoRequestInput(input)),
    async submit(input, deps) {
      try {
        return await a.submit(videoRequestInput(input), videoDeps(deps));
      } catch (e) {
        throw toMediaError(e, !(e instanceof VideoProviderError && e.status !== undefined));
      }
    },
    async poll(opId, deps): Promise<PollResult> {
      let r;
      try {
        r = await a.poll(opId, videoDeps(deps));
      } catch (e) {
        throw toMediaError(e, true);
      }
      if (r.state === "done") return { state: "done", outputs: [toOutput(r.media)] };
      return r;
    },
    async fetchOutput(o, deps) {
      try {
        return await a.download(toMedia(o), videoDeps(deps));
      } catch (e) {
        throw toMediaError(e, true);
      }
    },
  };
}

/** The catalog route of a video provider (one route per model in P0). */
export function videoRoute(provider: VideoProviderId) {
  const entry = MEDIA_CATALOG.byId(VIDEO_PROVIDER_TO_MEDIA[provider]);
  const route = entry?.routes.find((r) => r.provider === provider);
  if (!entry || !route) throw new Error(`media catalog: no video route for ${provider}`);
  return { entry, route };
}

/* ═════════════════ Studio «Video» tab (docs/studio/P3-SPEC.md) ═════════════════ */

const KLING_V3_TIERS: Readonly<Record<string, KlingV3Mode>> = { "kling-v3-std": "std", "kling-v3-pro": "pro" };

/** The Kling 3.0 request of a Studio job (normalized params of a `kling/kling-3*` entry + the resolved start image). */
export function klingV3Input(mode: KlingV3Mode, input: Omit<AdapterInput, "idempotencyKey">): KlingV3Input {
  const p = input.params;
  const aspect: KlingV3Aspect = (KLING_V3_ASPECTS as readonly string[]).includes(String(p.aspect)) ? (p.aspect as KlingV3Aspect) : KLING_V3_ASPECTS[0];
  const image = input.assets?.imageAssetId?.[0];
  return {
    model: input.upstreamModel,
    prompt: String(p.prompt ?? ""),
    seconds: Number(p.seconds),
    aspect,
    mode,
    sound: p.sound === true,
    ...(image ? { image: { mime: image.mime, base64: image.base64 } } : {}),
  };
}

/** The effect request of a Studio job; `null` without the photo (the host refuses that before charging). */
export function klingEffectRequest(input: Omit<AdapterInput, "idempotencyKey">): KlingTaskRequest | null {
  const image = input.assets?.imageAssetId?.[0];
  if (!image) return null;
  return buildKlingEffectRequest({ effect: String(input.params.effect ?? ""), image });
}

/** A Kling `MediaAdapter` over one request builder; same transport, same error mapping as the «Video» tool's adapter. */
function klingStudioAdapter(id: string, key: () => string, build: (input: AdapterInput) => KlingTaskRequest | null): MediaAdapter {
  const deps = (d?: AdapterDeps) => (d?.fetchImpl ? { fetchImpl: d.fetchImpl } : {});
  return {
    id,
    configured: () => parseKlingKey(key()) !== null,
    buildRequest(input) {
      const req = build(input);
      if (!req) throw new MediaError("kling", "the effect needs a photo");
      return { url: req.url, headers: req.headers, body: req.body };
    },
    async submit(input, d) {
      const req = build(input);
      // Nothing was sent: the provider holds no job (the host checks the photo before charging; this is a guard).
      if (!req) throw new MediaError("kling", "the effect needs a photo", { accepted: false });
      try {
        return await submitKlingTask(key, req, deps(d));
      } catch (e) {
        throw toMediaError(e, !(e instanceof VideoProviderError && e.status !== undefined));
      }
    },
    async poll(opId, d): Promise<PollResult> {
      let r;
      try {
        r = await pollKlingTask(key, opId, deps(d));
      } catch (e) {
        throw toMediaError(e, true);
      }
      if (r.state === "done") return { state: "done", outputs: [toOutput(r.media)] };
      return r;
    },
    async fetchOutput(o, d) {
      try {
        return await downloadKlingVideo(toMedia(o), deps(d));
      } catch (e) {
        throw toMediaError(e, true);
      }
    },
  };
}

/**
 * The adapters of the `studio.video` routes by adapter id: `google-video` (Gemini Omni, the «Video» tool's adapter
 * wrapped as today), `kling-v3-std` / `kling-v3-pro` (Kling 3.0 tiers) and `kling-effects`. `omni` and `klingKeyFn` are
 * test seams; production passes nothing.
 */
export function studioVideoAdapters(opts: { omni?: VideoAdapter; klingKeyFn?: () => string } = {}): Record<string, MediaAdapter> {
  const key = opts.klingKeyFn ?? klingKey;
  const out: Record<string, MediaAdapter> = { "google-video": videoAdapter("google-video", opts.omni ?? omniAdapter) };
  for (const [id, mode] of Object.entries(KLING_V3_TIERS)) out[id] = klingStudioAdapter(id, key, (input) => buildKlingV3Request(klingV3Input(mode, input)));
  out["kling-effects"] = klingStudioAdapter("kling-effects", key, klingEffectRequest);
  return out;
}

/** Every video provider's adapter under the adapter id its catalog route names (`google-video`, `kling-video`). */
export function videoMediaAdapters(adapters: Readonly<Record<VideoProviderId, VideoAdapter>>): Record<string, MediaAdapter> {
  const out: Record<string, MediaAdapter> = {};
  for (const id of VIDEO_PROVIDER_IDS) {
    const { route } = videoRoute(id);
    out[route.adapter] = videoAdapter(route.adapter, adapters[id]);
  }
  return out;
}
