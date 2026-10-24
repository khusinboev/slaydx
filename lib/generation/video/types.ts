/**
 * Video provider adapter contract (program-17 item 5). Isomorphic: no node/server imports, so the request builders
 * can be unit-tested and probed without a database.
 *
 * A video takes minutes, so an adapter is two calls and a download, never one blocking call:
 *   submit()    starts the provider operation and returns its id (seconds);
 *   poll()      asks whether it finished (called by the leader's `video-poll` housekeeping step, with backoff);
 *   download()  fetches the finished MP4.
 * The server stores the op id in `video_ops` between the calls (`lib/server/video-ops.ts`).
 */
import type { VideoAspect, VideoProviderId } from "./registry";

/** The optional start image, already read from `photo_uploads` (ownership checked there). */
export type VideoImage = { mime: string; base64: string };

export type VideoRequestInput = {
  prompt: string;
  seconds: number;
  aspect: VideoAspect;
  image?: VideoImage;
};

/** What a request builder returns: everything the probe compares. The API key is NOT part of it (added by `submit`). */
export type VideoRequest = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

export type VideoMedia =
  | { kind: "inline"; bytes: Uint8Array }
  | { kind: "url"; url: string };

export type VideoPollResult =
  | { state: "running" }
  | { state: "done"; media: VideoMedia }
  /** `safety`: the provider's own content-safety refusal (the user sees a clear Uzbek message and is refunded). */
  | { state: "failed"; message: string; safety: boolean };

export class VideoProviderError extends Error {
  readonly provider: VideoProviderId;
  readonly status?: number;
  /** A retry may succeed (429, 5xx, network): the op stays pending. Otherwise the job fails and is refunded. */
  readonly retryable: boolean;
  /** The provider refused the content (safety policy). */
  readonly safety: boolean;

  constructor(provider: VideoProviderId, message: string, o: { status?: number; retryable?: boolean; safety?: boolean } = {}) {
    super(message);
    this.name = "VideoProviderError";
    this.provider = provider;
    if (o.status !== undefined) this.status = o.status;
    this.retryable = o.retryable ?? false;
    this.safety = o.safety ?? false;
  }
}

export type VideoAdapterDeps = { fetchImpl?: typeof fetch; timeoutMs?: number; now?: () => number };

export type VideoAdapter = {
  id: VideoProviderId;
  /** A usable key is present (Kling needs both halves of its credential). */
  configured(): boolean;
  /** Pure: the HTTP request `submit` sends, for tests and the differential probe. */
  buildRequest(input: VideoRequestInput): VideoRequest;
  submit(input: VideoRequestInput, deps?: VideoAdapterDeps): Promise<{ opId: string }>;
  poll(opId: string, deps?: VideoAdapterDeps): Promise<VideoPollResult>;
  download(media: VideoMedia, deps?: VideoAdapterDeps): Promise<Uint8Array>;
};

/** Hard cap of a stored result (`storage.ts MAX_FILE_BYTES` is 25 MB). */
export const VIDEO_MAX_BYTES = 25 * 1024 * 1024;

/** Uzbek text of a provider safety refusal: shown to the user as is. No technical words (see `user-error.ts`). */
export const VIDEO_SAFETY_MESSAGE =
  "Provayder tavsifni xavfsizlik qoidalariga ko‘ra rad etdi. Pul qaytarildi — tavsifni o‘zgartirib, qayta urinib ko‘ring.";

/** Heuristic over a provider's own refusal text (neither API documents a machine-readable code we could rely on). */
export function looksLikeSafetyRefusal(text: string): boolean {
  return /safety|policy|moderat|sensitive|prohibited|blocked|violat|harm|unsafe|inappropriate|illegal|content[_ ]filter|responsible ai/i.test(text);
}

/** Error text with the key (and any bearer token) removed. Never throws. */
export function scrubSecrets(text: string, secrets: readonly string[]): string {
  let out = String(text ?? "");
  for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join("[key]");
  return out.replace(/AIza[0-9A-Za-z_-]{20,}/g, "[key]").replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [key]");
}
