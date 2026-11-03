import { klingAdapter } from "./kling";
import { omniAdapter } from "./omni";
import type { VideoAdapter } from "./types";
import type { VideoProviderId } from "./registry";

export * from "./registry";
export * from "./types";
export { isMp4, mp4Seconds } from "./mp4";
export { klingAdapter, makeKlingAdapter, parseKlingKey, signKlingJwt, buildKlingRequest, KLING_MODEL, KLING_BASE } from "./kling";
export {
  buildKlingDualEffectRequest,
  buildKlingEffectRequest,
  buildKlingV3Request,
  downloadKlingVideo,
  klingKey,
  pollKlingTask,
  submitKlingTask,
  type KlingTaskRequest,
  type KlingV3Input,
} from "./kling";
export { KLING_DUAL_EFFECT_MODE, KLING_DUAL_EFFECT_MODEL, KLING_EFFECT_SECONDS, KLING_V3_ASPECTS, KLING_V3_MODEL, KLING_V3_MODES, KLING_V3_SECONDS } from "./kling-options";
export type { KlingV3Aspect, KlingV3Mode } from "./kling-options";
export { omniAdapter, makeOmniAdapter, buildOmniRequest, OMNI_MODEL, OMNI_BASE } from "./omni";

/** The adapters by registry id; tests pass their own map to `video-ops` instead. */
export const VIDEO_ADAPTERS: Readonly<Record<VideoProviderId, VideoAdapter>> = { veo: omniAdapter, kling: klingAdapter };
