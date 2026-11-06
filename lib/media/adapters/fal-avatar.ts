/**
 * Studio P11 package F: photo avatars through fal (`bytedance/omnihuman/v2`, `fal-ai/kling-video/ai-avatar/v2/standard`). A photo
 * speaks the user's own speech. Async, like a clip: the op id is `fal:<endpoint>:<request_id>` and the shared video poll loop
 * drives it. The audio reaches fal through fal storage; the photo goes as a `data:` URI, as every fal video frame does.
 * Pages and limits: the block in `catalog-video.ts`.
 */
import { MediaError, type AdapterAsset, type AdapterInput, type MediaAdapter } from "../../studio-core";
import { isMp4 } from "../../generation/video/mp4";
import { VIDEO_MAX_BYTES } from "../../generation/video/types";
import { FAL_AVATAR_AUDIO_MIMES, OMNIHUMAN_AUDIO_MAX_BYTES, OWN_AUDIO_PARAM } from "../catalog-video";
import { FAL_QUEUE_HOST, FAL_VIDEO_START_TIMEOUT_SEC, dataUri, type FalDeps, type FalQueueVariant } from "./fal";
import { FAL_RETENTION_SEC, falLifecycleHeader } from "./fal-storage";
import { falStoredInputAdapter } from "./fal-stored-input";

export const FAL_AVATAR_ADAPTER_ID = "fal-avatar";
export const OMNIHUMAN_ENDPOINT = "bytedance/omnihuman/v2";
export const KLING_AVATAR_ENDPOINT = "fal-ai/kling-video/ai-avatar/v2/standard";
export const FAL_AVATAR_ENDPOINTS: ReadonlySet<string> = new Set([OMNIHUMAN_ENDPOINT, KLING_AVATAR_ENDPOINT]);

const audioOf = (input: Pick<AdapterInput, "assets">): AdapterAsset | null => input.assets?.[OWN_AUDIO_PARAM]?.[0] ?? null;
const decodedBytes = (base64: string) => Math.floor((base64.length * 3) / 4);

function outputOf(result: unknown): string | null {
  const video = result && typeof result === "object" ? (result as { video?: { url?: unknown } }).video : null;
  return typeof video?.url === "string" && video.url ? video.url : null;
}

/** The endpoint's input JSON. OmniHuman's page has no safety switch; Kling's is its default, sent so a change cannot surprise us. */
export function falAvatarBody(endpoint: string, image: AdapterAsset, audioUrl: string): Record<string, unknown> {
  const base = { image_url: dataUri(image), audio_url: audioUrl };
  return endpoint === KLING_AVATAR_ENDPOINT ? { ...base, enable_safety_checker: true } : base;
}

function variant(fileUrl: string): FalQueueVariant {
  return {
    id: FAL_AVATAR_ADAPTER_ID,
    endpoints: FAL_AVATAR_ENDPOINTS,
    startTimeoutSec: FAL_VIDEO_START_TIMEOUT_SEC,
    maxBytes: VIDEO_MAX_BYTES,
    outputOf,
    accepts: isMp4,
    request(input) {
      const endpoint = input.upstreamModel;
      if (!FAL_AVATAR_ENDPOINTS.has(endpoint)) throw new MediaError("fal", `unknown fal avatar endpoint ${endpoint}`);
      const image = input.assets?.imageAssetId?.[0];
      const audio = audioOf(input);
      // Nothing is uploaded or sent for any of these (the host checks them before charging; this is a guard).
      if (!image) throw new MediaError("fal", "avatar surati yo'q");
      if (!audio) throw new MediaError("fal", "avatar ovozi yo'q");
      if (!FAL_AVATAR_AUDIO_MIMES.includes(audio.mime)) throw new MediaError("fal", `avatar ovozi: ${audio.mime} turi qabul qilinmaydi`);
      if (endpoint === OMNIHUMAN_ENDPOINT && decodedBytes(audio.base64) > OMNIHUMAN_AUDIO_MAX_BYTES) throw new MediaError("fal", "avatar ovozi 15 MB dan katta");
      return {
        endpoint,
        url: `https://${FAL_QUEUE_HOST}/${endpoint}`,
        headers: { "Content-Type": "application/json", ...falLifecycleHeader(FAL_RETENTION_SEC) },
        body: falAvatarBody(endpoint, image, fileUrl),
      };
    },
  };
}

export function falAvatarAdapter(o: Pick<FalDeps, "key" | "lookup"> = {}): MediaAdapter {
  return falStoredInputAdapter(o, variant, audioOf);
}
