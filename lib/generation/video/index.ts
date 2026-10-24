import { klingAdapter } from "./kling";
import { omniAdapter } from "./omni";
import type { VideoAdapter } from "./types";
import type { VideoProviderId } from "./registry";

export * from "./registry";
export * from "./types";
export { isMp4, mp4Seconds } from "./mp4";
export { klingAdapter, makeKlingAdapter, parseKlingKey, signKlingJwt, buildKlingRequest, KLING_MODEL, KLING_BASE } from "./kling";
export { omniAdapter, makeOmniAdapter, buildOmniRequest, OMNI_MODEL, OMNI_BASE } from "./omni";

/** The adapters by registry id; tests pass their own map to `video-ops` instead. */
export const VIDEO_ADAPTERS: Readonly<Record<VideoProviderId, VideoAdapter>> = { veo: omniAdapter, kling: klingAdapter };
