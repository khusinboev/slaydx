/**
 * Video adapters on the media core (docs/studio/P0-SPEC.md §3.8, §6.4): today's `VideoAdapter`s (`lib/generation/video`)
 * wrapped as `MediaAdapter`s. Nothing about the provider HTTP calls changes: `buildRequest` / `submit` / `poll` /
 * `download` are the same functions, only the shapes are translated.
 *
 * Failure mapping (`VideoProviderError` → `MediaError`): `retryable` and `safety` are kept as they are. `accepted` is
 * `false` for an error of `submit` (the provider answered with an error instead of an operation id, so it holds no job
 * of ours) and `true` for an error of `poll` / `fetchOutput` (the operation exists and may already be billed): the
 * router never moves to another route after that.
 *
 * Client-safe like the wrapped adapters: no server imports.
 */
import { MediaError, type AdapterDeps, type AdapterInput, type MediaAdapter, type MediaOutput, type PollResult } from "../../studio-core";
import { MEDIA_CATALOG, VIDEO_PROVIDER_TO_MEDIA } from "../catalog";
import { VIDEO_ASPECTS, VIDEO_PROVIDER_IDS, VideoProviderError, type VideoAdapter, type VideoAspect, type VideoMedia, type VideoProviderId, type VideoRequestInput } from "../../generation/video";

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
        throw toMediaError(e, false);
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

/** Every video provider's adapter under the adapter id its catalog route names (`google-video`, `kling-video`). */
export function videoMediaAdapters(adapters: Readonly<Record<VideoProviderId, VideoAdapter>>): Record<string, MediaAdapter> {
  const out: Record<string, MediaAdapter> = {};
  for (const id of VIDEO_PROVIDER_IDS) {
    const { route } = videoRoute(id);
    out[route.adapter] = videoAdapter(route.adapter, adapters[id]);
  }
  return out;
}
