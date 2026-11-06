/**
 * KLING AI adapter of the `kling` provider (program-17 item 5).
 *
 * Official docs (markdown, read 2026-11-06): https://kling.ai/document-api/llms.txt
 *   auth      `Authorization: Bearer <API key>`: one key from kling.ai/dev/api-key, no signing
 *             (api/get-started/authentication.md).
 *   Kling 3.0 POST {BASE}/text-to-video/kling-3.0   { prompt, settings: { multi_shot, audio, resolution, aspect_ratio, duration } }
 *             POST {BASE}/image-to-video/kling-3.0  { contents: [{ type: "prompt", text }, { type: "first_frame", url },
 *             { type: "last_frame", url }], settings } (api/video/3-0-omni/*.md); `url` takes a link or raw base64.
 *   query     GET {BASE}/tasks?task_ids=<id>, `data` is an ARRAY of { id, status: submitted|processing|succeeded|failed,
 *             message, outputs: [{ type: "video", url, duration }], billing }.
 *   effects   POST {BASE}/v1/videos/effects  { effect_scene, input: { image } | { images: [a, b] } }; query GET
 *             {BASE}/v1/videos/effects/{task_id}, `data` is ONE object with task_status succeed|failed and
 *             task_result.videos (api/effects/video-effects.md, 219 scenes). The page lists no other `input` field.
 *   The result URL is a CDN link that expires, so the finalizer downloads it at once.
 *
 * The old «Video» tool keeps `buildKlingRequest` and its op ids byte for byte: POST {BASE}/v1/videos/text2video |
 * image2video with `model_name`, query GET {BASE}/v1/videos/{kind}/{task_id}. The docs index no longer lists these
 * paths; a real key is accepted by the list read of text2video (live, 2026-11-06), and creating a task there has not
 * been tried live. The `{ code, message, data }` envelope and its error mapping are the same on every path.
 *
 * In image-to-video the aspect ratio comes from the picture (the endpoint has no `aspect_ratio`); the form says so.
 */
import { safeFetchUrl, UnsafeUrlError } from "../safe-fetch";
import { keyUsable } from "../../server/providers/registry";
import { getProviderKey } from "../../server/providers/resolve";
import { isMp4 } from "./mp4";
import type { KlingV3Aspect, KlingV3Mode } from "./kling-options";
import {
  VIDEO_MAX_BYTES,
  VIDEO_SAFETY_MESSAGE,
  VideoProviderError,
  looksLikeSafetyRefusal,
  scrubSecrets,
  type VideoAdapter,
  type VideoAdapterDeps,
  type VideoMedia,
  type VideoPollResult,
  type VideoRequest,
  type VideoRequestInput,
} from "./types";

export const KLING_BASE = "https://api-singapore.klingai.com";
export const KLING_MODEL = "kling-v2-master";
export const KLING_MODE = "std";
/** The Studio tiers on the new API, which names the resolution instead of a mode. */
const KLING_V3_RESOLUTION: Readonly<Record<KlingV3Mode, string>> = { std: "720p", pro: "1080p" };
/** Kling's code for a prompt / image that tripped its content-safety policy. */
const KLING_SAFETY_CODES: ReadonlySet<number> = new Set([1301]);


/** The query of an op; the kind is the part of the op id before the colon (`<kind>:<task_id>`). `task` = `GET /tasks`. */
export type KlingTaskKind = "text2video" | "image2video" | "effects" | "task";
const OLD_KINDS: readonly KlingTaskKind[] = ["text2video", "image2video"];
export const KLING_TASK_KINDS: readonly KlingTaskKind[] = [...OLD_KINDS, "effects", "task"];

export const klingKey = (): string => getProviderKey("kling");

export function buildKlingRequest(input: VideoRequestInput): VideoRequest {
  const base = { model_name: KLING_MODEL, prompt: input.prompt, duration: String(input.seconds), mode: KLING_MODE };
  if (input.image) {
    return {
      url: `${KLING_BASE}/v1/videos/image2video`,
      headers: { "Content-Type": "application/json" },
      body: { ...base, image: input.image.base64 },
    };
  }
  return {
    url: `${KLING_BASE}/v1/videos/text2video`,
    headers: { "Content-Type": "application/json" },
    body: { ...base, aspect_ratio: input.aspect },
  };
}

/** A built request plus the query kind its op id will carry. */
export type KlingTaskRequest = VideoRequest & { kind: KlingTaskKind };

/** One Kling 3.0 clip (Studio). With `image` it is image to video and the aspect comes from the picture. */
export type KlingV3Input = {
  model: string;
  prompt: string;
  seconds: number;
  aspect: KlingV3Aspect;
  mode: KlingV3Mode;
  sound: boolean;
  image?: { mime: string; base64: string };
  /**
   * End frame (Studio P4): the `last_frame` item, raw base64 like `image`; only together with `image`, since the docs
   * refuse a last frame alone.
   */
  imageTail?: { mime: string; base64: string };
};

export function buildKlingV3Request(input: KlingV3Input): KlingTaskRequest {
  const headers = { "Content-Type": "application/json" };
  // `multi_shot` defaults to true on Kling's side; the Studio sells one continuous clip of the chosen length.
  const settings = { multi_shot: false, audio: input.sound ? "native" : "off", resolution: KLING_V3_RESOLUTION[input.mode], duration: input.seconds };
  if (input.image) {
    const contents = [
      ...(input.prompt ? [{ type: "prompt", text: input.prompt }] : []),
      { type: "first_frame", url: input.image.base64 },
      ...(input.imageTail ? [{ type: "last_frame", url: input.imageTail.base64 }] : []),
    ];
    return { kind: "task", url: `${KLING_BASE}/image-to-video/${input.model}`, headers, body: { contents, settings } };
  }
  return { kind: "task", url: `${KLING_BASE}/text-to-video/${input.model}`, headers, body: { prompt: input.prompt, settings: { ...settings, aspect_ratio: input.aspect } } };
}

/** One photo → a ready scene. The raw base64 goes in `input.image`. */
export function buildKlingEffectRequest(input: { effect: string; image: { mime: string; base64: string } }): KlingTaskRequest {
  return {
    kind: "effects",
    url: `${KLING_BASE}/v1/videos/effects`,
    headers: { "Content-Type": "application/json" },
    body: { effect_scene: input.effect, input: { image: input.image.base64 } },
  };
}

/** Two photos → one scene (Studio P4, «Quchoqlash» = `hug_pro`): `input.images`, exactly two. */
export function buildKlingDualEffectRequest(input: { effect: string; images: readonly [{ mime: string; base64: string }, { mime: string; base64: string }] }): KlingTaskRequest {
  return {
    kind: "effects",
    url: `${KLING_BASE}/v1/videos/effects`,
    headers: { "Content-Type": "application/json" },
    body: { effect_scene: input.effect, input: { images: input.images.map((i) => i.base64) } },
  };
}

/** `data` of the `/v1/videos/*` paths, and of a create on the new paths (`id`). */
type TaskData = {
  id?: string;
  task_id?: string;
  task_status?: string;
  task_status_msg?: string;
  task_result?: { videos?: { url?: string; duration?: string | number }[] };
};
/** One row of `GET /tasks`. */
type TaskRow = { status?: string; message?: string; outputs?: { type?: string; url?: string }[] };
type Envelope<D> = { code?: number; message?: string; data?: D };

/**
 * The ONE Kling transport: the API key as Bearer, the `{ code, message, data }` envelope, the error mapping (429 / 5xx /
 * network → retryable; code 1301 or a refusal text → safety; the key never in a message). Every request shape uses it.
 */
export async function klingCall<D = TaskData>(key: () => string, method: "GET" | "POST", url: string, body: unknown, deps: VideoAdapterDeps): Promise<Envelope<D>> {
  const token = key().trim();
  if (!keyUsable("kling", token)) throw new VideoProviderError("kling", "KLING_API_KEY yaroqsiz (Kling API kaliti kerak)");
  const secrets = [token];
  let res: Response;
  try {
    res = await (deps.fetchImpl ?? fetch)(url, {
      method,
      signal: AbortSignal.timeout(Math.max(1_000, deps.timeoutMs ?? 30_000)),
      headers: { Authorization: `Bearer ${token}`, ...(method === "POST" ? { "Content-Type": "application/json" } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (e) {
    throw new VideoProviderError("kling", scrubSecrets(e instanceof Error ? e.message : "tarmoq xatosi", secrets), { retryable: true });
  }
  const text = await res.text().catch(() => "");
  let env: Envelope<D> = {};
  try {
    env = text ? (JSON.parse(text) as Envelope<D>) : {};
  } catch {
    env = {};
  }
  const msg = scrubSecrets(String(env.message ?? text).slice(0, 300), secrets);
  if (!res.ok || (typeof env.code === "number" && env.code !== 0)) {
    const safety = (typeof env.code === "number" && KLING_SAFETY_CODES.has(env.code)) || looksLikeSafetyRefusal(msg);
    throw new VideoProviderError("kling", `${res.status} ${env.code ?? ""} ${msg}`.trim(), {
      status: res.status,
      // 429 (rate / concurrency limit) and 5xx are worth another look; auth, balance and validation are not.
      retryable: res.status === 429 || res.status >= 500,
      safety,
    });
  }
  return env;
}

/** Starts a built request; the op id carries the query kind. */
export async function submitKlingTask(key: () => string, req: KlingTaskRequest, deps: VideoAdapterDeps = {}): Promise<{ opId: string }> {
  const env = await klingCall(key, "POST", req.url, req.body, deps);
  const id = env.data?.task_id ?? env.data?.id;
  if (!id) throw new VideoProviderError("kling", "javobda vazifa id yo'q");
  return { opId: `${req.kind}:${id}` };
}

/** The state of a task from a provider-side status and failure text; shared by both query shapes. */
function failedTask(key: () => string, text: string | undefined): VideoPollResult {
  const msg = scrubSecrets(String(text ?? ""), [key().trim()]);
  const safety = looksLikeSafetyRefusal(msg);
  return { state: "failed", message: safety ? VIDEO_SAFETY_MESSAGE : msg || "Provayder videoni yaratmadi", safety };
}

async function pollTaskRow(key: () => string, id: string, deps: VideoAdapterDeps): Promise<VideoPollResult> {
  const env = await klingCall<TaskRow[]>(key, "GET", `${KLING_BASE}/tasks?task_ids=${encodeURIComponent(id)}`, undefined, deps);
  const row = Array.isArray(env.data) ? env.data[0] : undefined;
  // A task Kling does not list: retryable, so a brief lag after the create is forgiven and a dead op stops at the
  // transient-error limit (`MAX_TRANSIENT_ERRORS`) with its refund, without being failed on one empty answer.
  if (!row) throw new VideoProviderError("kling", "vazifa topilmadi", { retryable: true });
  if (row.status === "succeeded") {
    const url = row.outputs?.find((o) => o.type === "video")?.url;
    if (!url) return { state: "failed", message: "Provayder videoni qaytarmadi", safety: false };
    return { state: "done", media: { kind: "url", url } };
  }
  return row.status === "failed" ? failedTask(key, row.message) : { state: "running" };
}

/** Asks Kling about an op (`<kind>:<task_id>`); `kinds` = the queries this caller may ask. */
export async function pollKlingTask(key: () => string, opId: string, deps: VideoAdapterDeps = {}, kinds: readonly KlingTaskKind[] = KLING_TASK_KINDS): Promise<VideoPollResult> {
  const [kind, id] = opId.split(":");
  if (!kind || !(kinds as readonly string[]).includes(kind) || !id) throw new VideoProviderError("kling", "noto'g'ri operatsiya id");
  if (kind === "task") return pollTaskRow(key, id, deps);
  const env = await klingCall(key, "GET", `${KLING_BASE}/v1/videos/${kind}/${encodeURIComponent(id)}`, undefined, deps);
  const status = env.data?.task_status;
  if (status === "succeed") {
    const url = env.data?.task_result?.videos?.[0]?.url;
    if (!url) return { state: "failed", message: "Provayder videoni qaytarmadi", safety: false };
    return { state: "done", media: { kind: "url", url } };
  }
  return status === "failed" ? failedTask(key, env.data?.task_status_msg) : { state: "running" };
}

/** Downloads the finished MP4 (the CDN link expires, so the finalizer calls this at once). */
export async function downloadKlingVideo(media: VideoMedia, deps: VideoAdapterDeps = {}): Promise<Uint8Array> {
  if (media.kind === "inline") return media.bytes;
  let res: Response;
  try {
    res = await safeFetchUrl(media.url, { fetchImpl: deps.fetchImpl, timeoutMs: Math.max(5_000, deps.timeoutMs ?? 60_000), maxBytes: VIDEO_MAX_BYTES });
  } catch (e) {
    if (e instanceof UnsafeUrlError && e.reason === "size") throw new VideoProviderError("kling", "video fayli juda katta");
    throw new VideoProviderError("kling", e instanceof Error ? e.message : "yuklab bo'lmadi", { retryable: !(e instanceof UnsafeUrlError) });
  }
  if (!res.ok) throw new VideoProviderError("kling", `yuklash ${res.status}`, { status: res.status, retryable: res.status === 429 || res.status >= 500 });
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!isMp4(bytes)) throw new VideoProviderError("kling", "yuklangan fayl MP4 emas", { retryable: true });
  return bytes;
}

export function makeKlingAdapter(opts: { key?: () => string } = {}): VideoAdapter {
  const key = opts.key ?? klingKey;
  return {
    id: "kling",
    configured: () => keyUsable("kling", key()),
    buildRequest: buildKlingRequest,
    submit: (input, deps = {}) =>
      // The kind is part of the op id: the query path differs between text2video and image2video.
      submitKlingTask(key, { ...buildKlingRequest(input), kind: input.image ? "image2video" : "text2video" }, deps),
    poll: (opId, deps = {}) => pollKlingTask(key, opId, deps, OLD_KINDS),
    download: (media, deps = {}) => downloadKlingVideo(media, deps),
  };
}

export const klingAdapter = makeKlingAdapter();
