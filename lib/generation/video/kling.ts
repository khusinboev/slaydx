/**
 * KLING AI adapter of the `kling` provider (program-17 item 5).
 *
 * Official docs: https://app.klingai.com/global/dev/document-api/apiReference/model/textToVideo (it redirects to
 * https://kling.ai/document-api/apiReference/model/textToVideo). That site is a JavaScript app and could not be read
 * by the research tool on 2026-10-24, so the shapes below come from the widely used client implementations that mirror
 * it (ComfyUI's Kling nodes, the CometAPI / Novita wrappers that quote the original paths) and are FLAGGED for the
 * first live call:
 *
 *   auth      `Authorization: Bearer <JWT>`, HS256, header {alg:"HS256",typ:"JWT"}, payload {iss: <access key>,
 *             exp: now+1800, nbf: now-5}, signed with the secret key. The registry holds ONE secret, so the key is
 *             stored as `<accessKey>:<secretKey>`.
 *   create    POST {BASE}/v1/videos/text2video   { model_name, prompt, duration: "5"|"10", aspect_ratio, mode }
 *             POST {BASE}/v1/videos/image2video  { model_name, image: <raw base64>, prompt, duration, mode }
 *   query     GET  {BASE}/v1/videos/text2video/{task_id}   (image2video likewise)
 *   response  { code: 0, message, request_id, data: { task_id, task_status: submitted|processing|succeed|failed,
 *             task_status_msg, task_result: { videos: [{ id, url, duration }] } } }; a non-zero `code` is an error.
 *   The result URL is a CDN link that expires, so the finalizer downloads it at once.
 *
 * In image-to-video the aspect ratio comes from the picture (the endpoint has no `aspect_ratio`); the form says so.
 * Price and model: `kling-v2-master` is the model name the ComfyUI node defaults to; the account's current best model
 * and its per-second cost must be checked with the first key (`registry.ts` flags the price).
 *
 * STUDIO «Video» tab (docs/studio/P3-SPEC.md) — two more request shapes over the SAME transport (`klingCall`: JWT,
 * envelope, error mapping), so auth and errors stay one code path:
 *   Kling 3.0  POST {BASE}/v1/videos/text2video | image2video  { model_name: "kling-v3", prompt, duration: "3".."15",
 *              mode: "std" (720p) | "pro" (1080p), sound: "on" | "off", aspect_ratio (text2video only), image (i2v) }
 *              — the shape ComfyUI's «Kling 3.0 Video» partner node sends (`comfy_api_nodes/nodes_kling.py`
 *              `KlingVideoNode` → `TextToVideoWithAudioRequest` / `ImageToVideoWithAudioRequest`, ComfyUI commit
 *              de37ca2, 2026-10-26; read 2026-11-02);
 *   effects    POST {BASE}/v1/videos/effects  { effect_scene, input: { image: <raw base64>, duration: "5" } },
 *              query GET {BASE}/v1/videos/effects/{task_id} — Kling's OpenAPI as vendored by ComfyUI
 *              (`comfy_api_nodes/apis/__init__.py` `KlingVideoEffectsRequest` / `KlingSingleImageEffectInput`).
 *              UNVERIFIED: that OpenAPI also lists `model_name: "kling-v1-6"` for its five legacy scenes; the newer
 *              scenes the Studio sells (fal / WaveSpeed pass-through lists, see catalog-video.ts) are called without
 *              a model name. Checked on the first live effect.
 * The old «Video» tool keeps `buildKlingRequest` and its op ids byte for byte (`tests/video-adapters.test.mts`).
 */
import { createHmac } from "node:crypto";
import { safeFetchUrl, UnsafeUrlError } from "../safe-fetch";
import { getProviderKey } from "../../server/providers/resolve";
import { isMp4 } from "./mp4";
import { KLING_EFFECT_SECONDS, type KlingV3Aspect, type KlingV3Mode } from "./kling-options";
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
/** Kling's code for a prompt / image that tripped its content-safety policy. */
const KLING_SAFETY_CODES: ReadonlySet<number> = new Set([1301]);


/** The query path of an op; the kind is the part of the op id before the colon (`<kind>:<task_id>`). */
export type KlingTaskKind = "text2video" | "image2video" | "effects";
const OLD_KINDS: readonly KlingTaskKind[] = ["text2video", "image2video"];
export const KLING_TASK_KINDS: readonly KlingTaskKind[] = [...OLD_KINDS, "effects"];

export const klingKey = (): string => getProviderKey("kling");

/** `<accessKey>:<secretKey>` -> both halves, or `null` when the stored key does not have that shape. */
export function parseKlingKey(raw: string): { accessKey: string; secretKey: string } | null {
  const at = raw.indexOf(":");
  if (at <= 0 || at === raw.length - 1) return null;
  return { accessKey: raw.slice(0, at).trim(), secretKey: raw.slice(at + 1).trim() };
}

const b64url = (v: Buffer | string): string => Buffer.from(v).toString("base64url");

/** HS256 JWT, valid 30 minutes (Kling's documented maximum lifetime of a token). */
export function signKlingJwt(accessKey: string, secretKey: string, nowSec: number = Math.floor(Date.now() / 1000)): string {
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ iss: accessKey, exp: nowSec + 1800, nbf: nowSec - 5 }));
  const sig = createHmac("sha256", secretKey).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

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
};

export function buildKlingV3Request(input: KlingV3Input): KlingTaskRequest {
  const base = { model_name: input.model, prompt: input.prompt, duration: String(input.seconds), mode: input.mode, sound: input.sound ? "on" : "off" };
  const headers = { "Content-Type": "application/json" };
  if (input.image) return { kind: "image2video", url: `${KLING_BASE}/v1/videos/image2video`, headers, body: { ...base, image: input.image.base64 } };
  return { kind: "text2video", url: `${KLING_BASE}/v1/videos/text2video`, headers, body: { ...base, aspect_ratio: input.aspect } };
}

/** One photo → a ready 5-second scene. The raw base64 goes in, as image2video's `image`. */
export function buildKlingEffectRequest(input: { effect: string; image: { mime: string; base64: string } }): KlingTaskRequest {
  return {
    kind: "effects",
    url: `${KLING_BASE}/v1/videos/effects`,
    headers: { "Content-Type": "application/json" },
    body: { effect_scene: input.effect, input: { image: input.image.base64, duration: String(KLING_EFFECT_SECONDS) } },
  };
}

type Envelope = {
  code?: number;
  message?: string;
  data?: {
    task_id?: string;
    task_status?: string;
    task_status_msg?: string;
    task_result?: { videos?: { url?: string; duration?: string | number }[] };
  };
};

/**
 * The ONE Kling transport: a fresh JWT per call, the `{ code, message, data }` envelope, the error mapping (429 / 5xx /
 * network → retryable; code 1301 or a refusal text → safety; the key never in a message). Every request shape uses it.
 */
export async function klingCall(key: () => string, method: "GET" | "POST", url: string, body: unknown, deps: VideoAdapterDeps): Promise<Envelope> {
  const raw = key();
  const creds = parseKlingKey(raw);
  if (!creds) throw new VideoProviderError("kling", "KLING_API_KEY yaroqsiz (<accessKey>:<secretKey> kerak)");
  const secrets = [raw, creds.accessKey, creds.secretKey];
  const nowSec = Math.floor((deps.now?.() ?? Date.now()) / 1000);
  let res: Response;
  try {
    res = await (deps.fetchImpl ?? fetch)(url, {
      method,
      signal: AbortSignal.timeout(Math.max(1_000, deps.timeoutMs ?? 30_000)),
      headers: { Authorization: `Bearer ${signKlingJwt(creds.accessKey, creds.secretKey, nowSec)}`, ...(method === "POST" ? { "Content-Type": "application/json" } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (e) {
    throw new VideoProviderError("kling", scrubSecrets(e instanceof Error ? e.message : "tarmoq xatosi", secrets), { retryable: true });
  }
  const text = await res.text().catch(() => "");
  let env: Envelope = {};
  try {
    env = text ? (JSON.parse(text) as Envelope) : {};
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
  const id = env.data?.task_id;
  if (!id) throw new VideoProviderError("kling", "javobda task_id yo'q");
  return { opId: `${req.kind}:${id}` };
}

/** Asks Kling about an op (`<kind>:<task_id>`); `kinds` = the query paths this caller may ask. */
export async function pollKlingTask(key: () => string, opId: string, deps: VideoAdapterDeps = {}, kinds: readonly KlingTaskKind[] = KLING_TASK_KINDS): Promise<VideoPollResult> {
  const [kind, id] = opId.split(":");
  if (!kind || !(kinds as readonly string[]).includes(kind) || !id) throw new VideoProviderError("kling", "noto'g'ri operatsiya id");
  const env = await klingCall(key, "GET", `${KLING_BASE}/v1/videos/${kind}/${encodeURIComponent(id)}`, undefined, deps);
  const status = env.data?.task_status;
  if (status === "succeed") {
    const url = env.data?.task_result?.videos?.[0]?.url;
    if (!url) return { state: "failed", message: "Provayder videoni qaytarmadi", safety: false };
    return { state: "done", media: { kind: "url", url } };
  }
  if (status === "failed") {
    const msg = scrubSecrets(String(env.data?.task_status_msg ?? ""), [key()]);
    const safety = looksLikeSafetyRefusal(msg);
    return { state: "failed", message: safety ? VIDEO_SAFETY_MESSAGE : msg || "Provayder videoni yaratmadi", safety };
  }
  return { state: "running" };
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
    configured: () => parseKlingKey(key()) !== null,
    buildRequest: buildKlingRequest,
    submit: (input, deps = {}) =>
      // The kind is part of the op id: the query path differs between text2video and image2video.
      submitKlingTask(key, { ...buildKlingRequest(input), kind: input.image ? "image2video" : "text2video" }, deps),
    poll: (opId, deps = {}) => pollKlingTask(key, opId, deps, OLD_KINDS),
    download: (media, deps = {}) => downloadKlingVideo(media, deps),
  };
}

export const klingAdapter = makeKlingAdapter();
