/**
 * fal.ai adapter of the media core (docs/studio/P2-SPEC.md, PLAN §4 / §12): ONE generic adapter for every fal model.
 * A model is a request builder in `FAL_MODELS` (keyed by the fal endpoint id the catalog route names), nothing else.
 *
 * Protocol (fal queue API, https://fal.ai/docs/model-apis/model-endpoints/queue, read 2026-11-02):
 *   submit  POST https://queue.fal.run/<endpoint>  `Authorization: Key <FAL_KEY>`, the model's input JSON
 *           → `{ request_id, status_url, response_url, cancel_url }`;
 *   status  GET status_url  → `{ status: IN_QUEUE | IN_PROGRESS | COMPLETED, error?, error_type? }`;
 *   result  GET response_url → the model's output (`images[].url`, a `data:` URI when `sync_mode` is set);
 *   cancel  PUT cancel_url (best effort when our deadline passes, so a queued job is not drawn — and billed — for nobody).
 * The status / result / cancel URLs are used only when they are https on `queue.fal.run` (the key travels in their
 * header); otherwise they are rebuilt from the endpoint's owner/app. No call follows a redirect (`redirect: "manual"`,
 * a 3xx is an error): the key is never sent to a host this file did not name.
 *
 * The Studio path is synchronous (`runMedia` wants the outputs), so `submit` runs the whole cycle inside the job's
 * deadline and returns the pictures as INLINE bytes, each type sniffed (`checkOutput`) — a provider URL never leaves
 * this file. Output URLs are downloaded WITHOUT the key, through `safeFetchUrl` (https + public host on every hop,
 * size cap).
 *
 * Failure mapping (`MediaError`, the router and the refund act on it):
 *   before acceptance  401 / 402 / 403 account (key, balance — fal answered 403 «exhausted balance» in 2026-09):
 *                      not retryable; 400 / 404 / 422 validation: not retryable; 422 `content_policy_violation`: safety;
 *                      429 / 5xx / network before an answer: retryable; a 3xx: not retryable;
 *   after acceptance   (a request id exists) every failure is `accepted: true` — the router never sends the picture to
 *                      a second route (double cost); a timeout after submit is retryable + accepted; a content-policy
 *                      answer (422 on the result, or `has_nsfw_concepts`) is safety.
 * fal has no idempotency key on submit (the queue docs name none, 2026-11-02): a resubmit is a new paid job, which is
 * why nothing here retries a submit and the router never falls back after acceptance.
 *
 * Error texts never contain the key: every message passes `scrub` (the key itself and `Key …` header shapes).
 *
 * VIDEO (Studio P4, docs/studio/P4-SPEC.md) is a separate ASYNC adapter at the end of this file (`falVideoAdapter`):
 * submit only queues and returns an op id; the shared video poll loop polls it. The picture cycle above is unchanged.
 *
 * AUDIO (Studio P11 package E, `fal-audio-models.ts`): the same blocking cycle for speech-to-text, sound effects, noise
 * cleaning and text-to-speech. Only the model's shape differs: an input file travels through fal storage (`fal-storage.ts`,
 * uploaded after every pure check, deleted after the call), the output is `audio` or a JSON answer, and the bytes are
 * sniffed as for a picture. Dubbing is async: `fal-dub.ts`, a variant of the video adapter.
 */
import { MediaError, checkOutput, isRetryableStatus, type AdapterAsset, type AdapterDeps, type AdapterInput, type MediaAdapter, type MediaOutput, type NormalizedParams, type PollResult } from "../../studio-core";
import { FAL_AUDIO_MODELS } from "./fal-audio-models";
import { FAL_FILE_PENDING, deleteFalFile, falFileAsset, falLifecycleHeader, uploadFalFile } from "./fal-storage";
import { IMAGE_RATIOS } from "../../generation/image-studio-options";
import { safeFetchUrl, UnsafeUrlError, type LookupFn } from "../../generation/safe-fetch";
import { isMp4 } from "../../generation/video/mp4";
import { VIDEO_MAX_BYTES, looksLikeSafetyRefusal, stripUrls } from "../../generation/video/types";
import { getProviderKey } from "../../server/providers/resolve";

export const FAL_PROVIDER = "fal";
export const FAL_ADAPTER_ID = "fal";
export const FAL_QUEUE_HOST = "queue.fal.run";

type Ratio = (typeof IMAGE_RATIOS)[number]["id"];

const ratioOf = (p: NormalizedParams): (typeof IMAGE_RATIOS)[number] => IMAGE_RATIOS.find((r) => r.id === p.imageRatio) ?? IMAGE_RATIOS[0];

/**
 * Seedream 5 Lite draws natively between 2560×1440 and 4096×4096 pixels (schema of
 * https://fal.ai/models/bytedance/seedream/v5/lite/text-to-image, 2026-11-02): each preset is the catalog ratio at
 * ≥ 3.69 MP. The price is flat per picture, the size does not change it.
 */
export const SEEDREAM_SIZES: Readonly<Record<Ratio, { width: number; height: number }>> = {
  "1:1": { width: 2048, height: 2048 },
  "16:9": { width: 2560, height: 1440 },
  "9:16": { width: 1440, height: 2560 },
  "4:3": { width: 2304, height: 1728 },
  "3:4": { width: 1728, height: 2304 },
  "3:2": { width: 2400, height: 1600 },
};

/**
 * Seedream 5 Pro bills $0.0675 up to 1536 × 1536 pixels of area and twice that above (its llms.txt, 2026-11-02); its
 * schema wants 921 600 – 4 624 220 pixels. Each preset is the catalog ratio at ≈ 2.1 MP, under the price step with room.
 */
export const SEEDREAM_PRO_SIZES: Readonly<Record<Ratio, { width: number; height: number }>> = {
  "1:1": { width: 1440, height: 1440 },
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "4:3": { width: 1664, height: 1248 },
  "3:4": { width: 1248, height: 1664 },
  "3:2": { width: 1776, height: 1184 },
};

/** Ideogram V4.5 accepts 36 exact sizes (its schema, 2026-11-02); these six are in that list. */
export const IDEOGRAM_SIZES: Readonly<Record<Ratio, { width: number; height: number }>> = {
  "1:1": { width: 1024, height: 1024 },
  "16:9": { width: 1280, height: 720 },
  "9:16": { width: 720, height: 1280 },
  "4:3": { width: 1152, height: 864 },
  "3:4": { width: 864, height: 1152 },
  "3:2": { width: 1248, height: 832 },
};

/**
 * Recraft V4.1 (standard and Pro) `image_size` presets (both schemas, 2026-11-02); 3:2 has none, so a custom 1536×1024
 * (max side 14 142). Both tiers bill per picture whatever the size.
 */
export const RECRAFT_SIZES: Readonly<Record<Ratio, string | { width: number; height: number }>> = {
  "1:1": "square_hd",
  "16:9": "landscape_16_9",
  "9:16": "portrait_16_9",
  "4:3": "landscape_4_3",
  "3:4": "portrait_4_3",
  "3:2": { width: 1536, height: 1024 },
};

export type FalModel = {
  /**
   * The model's input JSON from the normalized params (+ the engine's composed `prompt` in `extra`) and, for the P2b
   * edit / utility models, the input pictures (`assets.inputImages`, resolved and ownership-checked by the host). Pure.
   * `fileUrl`: the uploaded input of a `fileInput` model.
   */
  body(p: NormalizedParams, inputs?: readonly AdapterAsset[], fileUrl?: string): Record<string, unknown>;
  /** Pictures the model needs at least (P2b); a request with fewer is a programmer error, refused before any call. */
  minInputs?: number;
  /** The output check, when it differs from the default (PNG / JPEG / WebP); `alpha`: a PNG must carry transparency. */
  output?: { mimes: readonly string[]; alpha?: boolean; maxBytes?: number };
  /** The input is a file (`assets.audio` / `assets.media`) that travels by URL through fal storage. */
  fileInput?: boolean;
  /** The result's single file field, when it is not `images[]` / `image`. */
  resultFile?: "audio";
  /** The model answers with data, not a file: the normalized answer (handed back as inline JSON), `null` when unusable. */
  json?: (result: unknown) => unknown;
  /** How long fal keeps the files this call makes (`X-Fal-Object-Lifecycle-Preference`). */
  retentionSec?: number;
};

/**
 * Request builders, keyed by fal endpoint id. Every field is from the endpoint's own schema (`llms.txt` /
 * OpenAPI via `https://api.fal.ai/v1/models?endpoint_id=<id>&expand=openapi-3.0`, read 2026-11-02). Shared rules:
 *   - ONE picture per call (`num_images: 1` where the field exists): «Soni» is N calls, so a failed picture is refunded
 *     alone (`delivered`), exactly like Nano Banana / GPT Image;
 *   - the prompt is the engine's composed English prompt (style suffix included: «Uslub» works through it), so the
 *     model's own prompt expansion is off where it exists — the user's scene is not rewritten twice;
 *   - `sync_mode: true` where the schema has it: the picture comes back as a `data:` URI and is not kept in fal's
 *     request history; models without it return a URL that `submit` downloads;
 *   - the safety checker stays on (fal's default; turning it off needs account authorization anyway).
 */
export const FAL_MODELS: Readonly<Record<string, FalModel>> = {
  // https://fal.ai/models/blackforestlabs/flux-3/text-to-image/llms.txt (2026-11-02): aspect_ratio lists all six ids.
  "blackforestlabs/flux-3/text-to-image": {
    body: (p) => ({
      prompt: String(p.prompt ?? ""),
      aspect_ratio: ratioOf(p).id,
      resolution: "1k",
      output_format: "jpeg",
      enable_prompt_expansion: false,
      safety_tolerance: 2,
      sync_mode: true,
    }),
  },
  // https://fal.ai/models/bytedance/seedream/v5/lite/text-to-image/llms.txt (2026-11-02).
  "bytedance/seedream/v5/lite/text-to-image": {
    body: (p) => ({
      prompt: String(p.prompt ?? ""),
      image_size: SEEDREAM_SIZES[ratioOf(p).id],
      num_images: 1,
      output_format: "jpeg",
      enable_safety_checker: true,
      sync_mode: true,
    }),
  },
  // https://fal.ai/models/bytedance/seedream/v5/pro/text-to-image/llms.txt (2026-11-02): `enhance_prompt_mode` standard
  // = the quality mode (its default, sent explicitly so a default change at fal cannot change our picture silently).
  "bytedance/seedream/v5/pro/text-to-image": {
    body: (p) => ({
      prompt: String(p.prompt ?? ""),
      image_size: SEEDREAM_PRO_SIZES[ratioOf(p).id],
      num_images: 1,
      output_format: "jpeg",
      enhance_prompt_mode: "standard",
      enable_safety_checker: true,
      sync_mode: true,
    }),
  },
  // https://fal.ai/models/ideogram/v4.5/llms.txt (2026-11-02): `quality` low / medium / high sets the price.
  "ideogram/v4.5": {
    body: (p) => ({
      prompt: String(p.prompt ?? ""),
      image_size: IDEOGRAM_SIZES[ratioOf(p).id],
      quality: ["low", "medium", "high"].includes(String(p.quality)) ? String(p.quality) : "medium",
      num_images: 1,
      enable_prompt_expansion: false,
      enable_safety_checker: true,
      sync_mode: true,
    }),
  },
  // https://fal.ai/models/fal-ai/recraft/v4.1/text-to-image/llms.txt (2026-11-02): no num_images / sync_mode / format.
  "fal-ai/recraft/v4.1/text-to-image": {
    body: (p) => ({
      prompt: String(p.prompt ?? ""),
      image_size: RECRAFT_SIZES[ratioOf(p).id],
      enable_safety_checker: true,
    }),
  },
  // https://fal.ai/models/fal-ai/recraft/v4.1/pro/text-to-image/llms.txt (2026-11-02): same inputs as the standard tier.
  "fal-ai/recraft/v4.1/pro/text-to-image": {
    body: (p) => ({
      prompt: String(p.prompt ?? ""),
      image_size: RECRAFT_SIZES[ratioOf(p).id],
      enable_safety_checker: true,
    }),
  },
};

/* ═════════════════════ Studio P2b: edit + utility builders (docs/studio/P2B-SPEC.md) ═════════════════════
 * Input pictures go to fal INLINE, as `data:` URIs: «models also accept base64-encoded data URIs» (fal CDN docs,
 * https://fal.ai/docs/documentation/model-apis/fal-cdn.md, read 2026-11-02; the page recommends CDN uploads for files
 * over a few KB — inputs are capped at 5 MB, a CDN upload step is a listed follow-up).
 */

/** An input picture as the `data:` URI fal reads (mime as resolved by the host, never a provider URL). */
export function dataUri(a: AdapterAsset): string {
  return `data:${a.mime};base64,${a.base64}`;
}

/** The first input as a data URI; the builder is only reached with one (`minInputs`, checked in `buildRequest`). */
function firstInput(inputs: readonly AdapterAsset[] | undefined): string {
  const a = inputs?.[0];
  if (!a) throw new MediaError(FAL_PROVIDER, "kirish rasmi yo'q");
  return dataUri(a);
}

/** Seedream 5 Lite edit takes up to 10 inputs (its schema); the catalog allows 3. */
export const SEEDREAM_EDIT_MAX_INPUTS = 10;

export const FAL_TOOL_MODELS: Readonly<Record<string, FalModel>> = {
  // https://fal.ai/models/bytedance/seedream/v5/lite/edit/llms.txt (2026-11-02): `image_urls` (≤ 10), `image_size`
  // default `auto_2K` (follows the input's frame), $0.035 per picture.
  "bytedance/seedream/v5/lite/edit": {
    minInputs: 1,
    body: (p, inputs) => ({
      prompt: String(p.prompt ?? ""),
      image_urls: (inputs ?? []).slice(0, SEEDREAM_EDIT_MAX_INPUTS).map(dataUri),
      image_size: "auto_2K",
      num_images: 1,
      output_format: "jpeg",
      enable_safety_checker: true,
      sync_mode: true,
    }),
  },
  // https://fal.ai/models/fal-ai/seedvr/upscale/image/llms.txt (2026-11-02): `upscale_mode: factor` + `upscale_factor`
  // 1–10 (we sell 2 and 4), `output_format` jpg / png / webp.
  "fal-ai/seedvr/upscale/image": {
    minInputs: 1,
    body: (p, inputs) => ({
      image_url: firstInput(inputs),
      upscale_mode: "factor",
      upscale_factor: String(p.factor) === "4" ? 4 : 2,
      output_format: "jpg",
      enable_safety_checker: true,
      sync_mode: true,
    }),
  },
  // https://fal.ai/models/fal-ai/bria/background/remove/llms.txt (2026-11-02): `image_url`, no prompt (a prompt raises
  // the price to $0.03), output `image` — a PNG with transparency.
  "fal-ai/bria/background/remove": {
    minInputs: 1,
    output: { mimes: ["image/png"], alpha: true },
    body: (_p, inputs) => ({ image_url: firstInput(inputs), sync_mode: true }),
  },
};

/**
 * Does a PNG carry transparency: an alpha colour type (4 grey + alpha, 6 RGBA) in IHDR, or a `tRNS` chunk before the
 * first `IDAT`. `false` for anything that is not a well-formed PNG head. Pure.
 */
export function pngHasAlpha(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 33) return false;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!sig.every((b, i) => bytes[i] === b)) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = (at: number) => String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
  if (type(12) !== "IHDR") return false;
  const colour = bytes[25]!;
  if (colour === 4 || colour === 6) return true;
  let at = 8;
  while (at + 8 <= bytes.byteLength) {
    const len = view.getUint32(at);
    const t = type(at + 4);
    if (t === "tRNS") return true;
    if (t === "IDAT" || t === "IEND") return false;
    at += 12 + len;
  }
  return false;
}
/* ═════════════════════ end of the P2b block ═════════════════════ */

/** Removes the key, `Key …` / `Authorization` shapes and every URL (a user's upload may be quoted) from a provider text; clips it. */
export function scrub(text: string, key: string | null | undefined): string {
  let out = stripUrls(String(text ?? ""));
  if (key) out = out.split(key).join("…");
  out = out.replace(/\bKey\s+[\x21-\x7e]{8,}/gi, "Key …").replace(/(authorization["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, "$1…");
  out = out.replace(/\s+/g, " ").trim();
  return out.length > 300 ? `${out.slice(0, 297)}...` : out;
}

/** `owner/app` of an endpoint id: the queue serves status / result under it (queue docs). */
export function ownerApp(endpoint: string): string {
  return endpoint.split("/").slice(0, 2).join("/");
}

const REQUEST_ID = /^[A-Za-z0-9-]{8,80}$/;

/** A queue URL from the answer when it is https on the queue host, else the documented one. */
export function queueUrl(given: unknown, fallback: string): string {
  if (typeof given === "string") {
    try {
      const u = new URL(given);
      if (u.protocol === "https:" && u.hostname === FAL_QUEUE_HOST && !u.username && !u.password) return u.toString();
    } catch {
      // not a URL: the documented one
    }
  }
  return fallback;
}

type Detail = { type?: unknown; msg?: unknown };

/** fal's error text: `detail` as a string (request errors) or an array of `{ type, msg }` (model errors). */
function detailOf(body: unknown): { text: string; types: string[] } {
  const b = (body && typeof body === "object" ? body : {}) as { detail?: unknown; error?: unknown; error_type?: unknown; message?: unknown };
  const types: string[] = [];
  if (typeof b.error_type === "string") types.push(b.error_type);
  if (Array.isArray(b.detail)) {
    const parts = (b.detail as Detail[]).map((d) => {
      if (typeof d?.type === "string") types.push(d.type);
      return typeof d?.msg === "string" ? d.msg : "";
    });
    return { text: parts.filter(Boolean).join("; "), types };
  }
  const text = typeof b.detail === "string" ? b.detail : typeof b.error === "string" ? b.error : typeof b.message === "string" ? b.message : "";
  return { text, types };
}

const POLICY = "content_policy_violation";

export type FalDeps = {
  /** The key (tests); absent = the provider store / env (`getProviderKey("fal")`). */
  key?: () => string | null;
  sleep?: (ms: number) => Promise<void>;
  /** DNS seam of `safeFetchUrl` for output downloads (tests). */
  lookup?: LookupFn;
  /** First status poll after this many ms, then +50 % up to `pollMaxMs`. */
  pollMs?: number;
  pollMaxMs?: number;
};

/** Default budget when the caller gives no deadline (scripts): the catalog's longest per-picture limit. */
const DEFAULT_BUDGET_MS = 120_000;
const MIN_BUDGET_MS = 2_000;
/** One HTTP call of the cycle (submit / status / result / download) never waits longer than this. */
const CALL_MS = 30_000;
const MAX_STATUS_ERRORS = 5;
/**
 * Regular polling stops this long before the deadline; that tail is for ONE last status look and, if the job finished
 * in the final window, the result fetch — so a picture fal completed (and bills) is delivered, not cancelled + refunded.
 */
const FINAL_MS = 4_000;
/** The last look is made only with at least this much time left, and waits at most `LAST_LOOK_MS`. */
const LAST_LOOK_MIN_MS = 1_000;
const LAST_LOOK_MS = 1_500;
/** Largest JSON answer read (a `sync_mode` data URI of a 12 MB picture is ≈ 16 MB of base64). */
export const FAL_JSON_MAX_CHARS = 64 * 1024 * 1024;
const IMAGE_SPEC = { mimes: ["image/png", "image/jpeg", "image/webp"], maxBytes: 12 * 1024 * 1024 };

const sleepReal = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * The whole answer parsed as JSON; `null` when it is not JSON. An answer over `FAL_JSON_MAX_CHARS` (declared or read) is
 * never cut and parsed: `tooLarge()` is thrown instead, so the caller fails the call with a clear reason.
 */
async function json(res: Response, tooLarge: (size: number) => Error): Promise<unknown> {
  const declared = Number(res.headers?.get?.("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > FAL_JSON_MAX_CHARS) {
    await res.body?.cancel().catch(() => {});
    throw tooLarge(declared);
  }
  let text: string;
  try {
    text = await res.text();
  } catch {
    return null;
  }
  if (text.length > FAL_JSON_MAX_CHARS) throw tooLarge(text.length);
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function decodeDataUri(uri: string): Uint8Array | null {
  const m = /^data:[\w.+-]+\/[\w.+-]+;base64,([\s\S]*)$/.exec(uri);
  if (!m) return null;
  try {
    return new Uint8Array(Buffer.from(m[1]!, "base64"));
  } catch {
    return null;
  }
}

export function falAdapter(o: FalDeps = {}): MediaAdapter {
  const keyOf = o.key ?? (() => getProviderKey(FAL_PROVIDER));
  const sleep = o.sleep ?? sleepReal;
  const pollMs = o.pollMs ?? 1_000;
  const pollMaxMs = o.pollMaxMs ?? 3_000;

  function modelOf(upstreamModel: string): FalModel | undefined {
    return FAL_MODELS[upstreamModel] ?? FAL_TOOL_MODELS[upstreamModel] ?? FAL_AUDIO_MODELS[upstreamModel];
  }

  function buildRequest(input: AdapterInput, fileUrl: string = FAL_FILE_PENDING) {
    const model = modelOf(input.upstreamModel);
    if (!model) throw new MediaError(FAL_PROVIDER, `unknown fal model ${input.upstreamModel}`);
    const inputs = input.assets?.inputImages ?? [];
    if (inputs.length < (model.minInputs ?? 0)) throw new MediaError(FAL_PROVIDER, `${input.upstreamModel}: kirish rasmi yo'q`);
    if (model.fileInput && !falFileAsset(input)) throw new MediaError(FAL_PROVIDER, `${input.upstreamModel}: kirish fayli yo'q`);
    return {
      url: `https://${FAL_QUEUE_HOST}/${input.upstreamModel}`,
      headers: { "Content-Type": "application/json", ...(model.retentionSec ? falLifecycleHeader(model.retentionSec) : {}) },
      body: model.body(input.params, inputs, fileUrl),
    };
  }

  /** The whole queue cycle of one call; `fileUrl` is the uploaded input of a `fileInput` model. */
  async function cycle(input: AdapterInput, deps: AdapterDeps, key: string, fileUrl?: string): Promise<{ done: MediaOutput[] }> {
      const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
      const now = deps.now ?? Date.now;
      const deadline = deps.deadline ?? now() + DEFAULT_BUDGET_MS;
      const left = () => deadline - now();
      const fail = (msg: string, f: { status?: number; retryable?: boolean; safety?: boolean; accepted?: boolean }) => new MediaError(FAL_PROVIDER, scrub(msg, key), f);
      const signal = () => AbortSignal.timeout(Math.max(1, Math.min(CALL_MS, left())));
      const auth = { Authorization: `Key ${key}` };

      if (left() < MIN_BUDGET_MS) throw fail("byudjet 2 s dan kam", { retryable: true });
      const req = buildRequest(input, fileUrl);
      const model = modelOf(input.upstreamModel);

      // 1. Submit. The start timeout makes fal drop the job when it could not start before our deadline.
      let res: Response;
      try {
        res = await fetchImpl(req.url, {
          method: "POST",
          headers: { ...req.headers, ...auth, "X-Fal-Request-Start-Timeout": String(Math.max(1, Math.floor(left() / 1000))) },
          body: JSON.stringify(req.body),
          redirect: "manual",
          signal: signal(),
        });
      } catch (e) {
        // No answer: the request may have reached fal and started a job (the video adapters' rule).
        throw fail(`submit: ${e instanceof Error ? e.message : String(e)}`, { retryable: true, accepted: true });
      }
      if (res.status >= 300 && res.status < 400) throw fail(`submit: ${res.status} redirect rad etildi`, { status: res.status });
      const big = (where: string, isAccepted: boolean) => (n: number) => fail(`${where}: javob juda katta (${n} belgi)`, { accepted: isAccepted });
      if (!res.ok) {
        const d = detailOf(await json(res, big("submit", false)));
        const safety = d.types.includes(POLICY);
        throw fail(`${res.status} ${d.text || "submit failed"}`, { status: res.status, retryable: !safety && isRetryableStatus(res.status), safety });
      }
      const sub = (await json(res, big("submit", true))) as { request_id?: unknown; status_url?: unknown; response_url?: unknown; cancel_url?: unknown } | null;
      const id = typeof sub?.request_id === "string" && REQUEST_ID.test(sub.request_id) ? sub.request_id : null;
      if (!id) throw fail("submit: javobda request_id yo'q", { accepted: true });
      const base = `https://${FAL_QUEUE_HOST}/${ownerApp(input.upstreamModel)}/requests/${id}`;
      const statusUrl = queueUrl(sub?.status_url, `${base}/status`);
      const resultUrl = queueUrl(sub?.response_url, base);
      const cancelUrl = queueUrl(sub?.cancel_url, `${base}/cancel`);

      // From here the job exists at fal: every failure is `accepted`.
      const accepted = (msg: string, f: { status?: number; retryable?: boolean; safety?: boolean } = {}) => fail(msg, { ...f, accepted: true });
      const timedOut = async () => {
        try {
          await fetchImpl(cancelUrl, { method: "PUT", headers: auth, redirect: "manual", signal: AbortSignal.timeout(3_000) });
        } catch {
          // best effort
        }
        return accepted(`vaqt tugadi (fal ${id})`, { retryable: true });
      };

      // One last status look in the final window: `true` when the job completed there (fetch it instead of cancelling).
      const lastLook = async (): Promise<boolean> => {
        if (left() < LAST_LOOK_MIN_MS) return false;
        try {
          const st = await fetchImpl(statusUrl, { method: "GET", headers: auth, redirect: "manual", signal: AbortSignal.timeout(Math.min(LAST_LOOK_MS, left())) });
          if (!st.ok) return false;
          return ((await json(st, big("status", true))) as { status?: unknown } | null)?.status === "COMPLETED";
        } catch {
          return false;
        }
      };
      const nap = (ms: number) => sleep(Math.min(ms, Math.max(0, left() - FINAL_MS)));

      // 2. Status until COMPLETED or the deadline (the last FINAL_MS keep one last look + the result fetch).
      let wait = pollMs;
      let errors = 0;
      for (;;) {
        if (left() < FINAL_MS) {
          if (await lastLook()) break;
          throw await timedOut();
        }
        let st: Response;
        try {
          st = await fetchImpl(statusUrl, { method: "GET", headers: auth, redirect: "manual", signal: signal() });
        } catch (e) {
          if (++errors >= MAX_STATUS_ERRORS) throw accepted(`status: ${e instanceof Error ? e.message : String(e)}`, { retryable: true });
          await nap(wait);
          continue;
        }
        if (st.status >= 300 && st.status < 400) throw accepted(`status: ${st.status} redirect rad etildi`, { status: st.status });
        if (!st.ok) {
          const d = detailOf(await json(st, big("status", true)));
          if (!isRetryableStatus(st.status) || ++errors >= MAX_STATUS_ERRORS) throw accepted(`status ${st.status} ${d.text}`, { status: st.status, retryable: isRetryableStatus(st.status) });
        } else {
          errors = 0;
          const body = (await json(st, big("status", true))) as { status?: unknown } | null;
          if (body?.status === "COMPLETED") break;
          if (body?.status !== "IN_QUEUE" && body?.status !== "IN_PROGRESS") {
            const d = detailOf(body);
            throw accepted(`status: ${String(body?.status ?? "?")} ${d.text}`, { safety: d.types.includes(POLICY) });
          }
        }
        await nap(wait);
        wait = Math.min(pollMaxMs, Math.round(wait * 1.5));
      }

      // 3. Result.
      let out: Response;
      try {
        out = await fetchImpl(resultUrl, { method: "GET", headers: auth, redirect: "manual", signal: signal() });
      } catch (e) {
        throw accepted(`result: ${e instanceof Error ? e.message : String(e)}`, { retryable: true });
      }
      if (out.status >= 300 && out.status < 400) throw accepted(`result: ${out.status} redirect rad etildi`, { status: out.status });
      const result = (await json(out, big("result", true))) as { images?: { url?: unknown }[]; image?: { url?: unknown }; audio?: { url?: unknown }; has_nsfw_concepts?: unknown } | null;
      if (!out.ok) {
        const d = detailOf(result);
        const safety = d.types.includes(POLICY);
        throw accepted(`${out.status} ${d.text || "result failed"}`, { status: out.status, safety, retryable: !safety && isRetryableStatus(out.status) });
      }
      // A data answer (speech-to-text): nothing to download; an unusable one was still billed, so it stays `accepted`.
      if (model?.json) {
        const data = model.json(result);
        if (data === null || data === undefined) throw accepted("javobda ma'lumot yo'q", {});
        return { done: [{ kind: "inline", bytes: new TextEncoder().encode(JSON.stringify(data)), mime: "application/json" }] };
      }
      const nsfw = Array.isArray(result?.has_nsfw_concepts) ? (result!.has_nsfw_concepts as unknown[]) : [];
      // `images[]` (generate / edit), a single `image` (upscale, background removal — P2b) or the audio models' `audio`.
      const single = model?.resultFile ? result?.[model.resultFile] : result?.image;
      const listed = Array.isArray(result?.images) && !model?.resultFile ? result!.images : single && typeof single === "object" ? [single] : [];
      const urls = listed.map((im, i) => ({ url: typeof im?.url === "string" ? im.url : "", flagged: nsfw[i] === true }));
      const usable = urls.filter((u) => u.url && !u.flagged);
      if (usable.length === 0) {
        if (urls.some((u) => u.flagged)) throw accepted(`${POLICY}: rasm xavfsizlik filtridan o'tmadi`, { safety: true });
        throw accepted(model?.resultFile ? "javobda fayl yo'q" : "javobda rasm yo'q", {});
      }

      // 4. Bytes: a data URI decoded, a URL downloaded WITHOUT the key; the type sniffed, never trusted.
      const spec = model?.output;
      const maxBytes = spec?.maxBytes ?? IMAGE_SPEC.maxBytes;
      const outputs: MediaOutput[] = [];
      for (const u of usable) {
        let bytes: Uint8Array | null;
        if (u.url.startsWith("data:")) {
          bytes = decodeDataUri(u.url);
        } else {
          try {
            const got = await safeFetchUrl(u.url, { timeoutMs: Math.max(1, Math.min(CALL_MS, left())), maxBytes, fetchImpl, ...(o.lookup ? { lookup: o.lookup } : {}) });
            bytes = got.ok ? new Uint8Array(await got.arrayBuffer()) : null;
          } catch (e) {
            throw accepted(`download: ${e instanceof Error ? e.message : String(e)}`, { retryable: true });
          }
        }
        if (!bytes) throw accepted("rasm yuklab olinmadi", { retryable: true });
        const check = await checkOutput(bytes, spec ? { mimes: spec.mimes, maxBytes } : IMAGE_SPEC);
        if (!check.ok) throw accepted(`rasm: ${check.error}`, {});
        if (spec?.alpha && !pngHasAlpha(bytes)) throw accepted("rasm: shaffof fon yo'q (PNG alfa kanali kutilgan edi)", {});
        outputs.push({ kind: "inline", bytes, mime: check.mime });
      }
      return { done: outputs };
  }

  return {
    id: FAL_ADAPTER_ID,
    configured: () => Boolean(keyOf()),
    buildRequest: (input) => buildRequest(input),
    async submit(input, deps: AdapterDeps = {}) {
      const key = keyOf();
      if (!key) throw new MediaError(FAL_PROVIDER, "FAL_KEY yo'q");
      if (!modelOf(input.upstreamModel)?.fileInput) return cycle(input, deps, key);
      // Every pure check first: nothing is uploaded for a request that cannot be sent.
      buildRequest(input);
      const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
      const now = deps.now ?? Date.now;
      const budget = (deps.deadline ?? now() + DEFAULT_BUDGET_MS) - now();
      const fileUrl = await uploadFalFile(falFileAsset(input)!, { key, fetchImpl, timeoutMs: budget, ...(o.lookup ? { lookup: o.lookup } : {}) });
      try {
        return await cycle(input, deps, key, fileUrl);
      } finally {
        // The URL is readable by anyone who has it: gone with the call (its expiry covers a failed delete).
        await deleteFalFile(fileUrl, { key, fetchImpl });
      }
    },
    async fetchOutput(o2) {
      if (o2.kind === "inline") return o2.bytes;
      throw new MediaError(FAL_PROVIDER, "fal outputs are inline");
    },
  };
}

/* ═════════════════════ Studio P4: VIDEO through the fal queue (docs/studio/P4-SPEC.md) ═════════════════════
 * A clip takes minutes, so a fal video is NOT the blocking cycle above: `submit` only queues the job and returns an op
 * id that the host parks in `media_jobs`; the SHARED video poll loop (`lib/server/video-ops.ts` `pollDueVideoOps`)
 * asks `poll` with its own backoff / deadline, then `fetchOutput` downloads the MP4. Same transport rules as the
 * pictures: the key goes only to `queue.fal.run` (`Authorization: Key …`), no redirect is followed, every message is
 * scrubbed, a failure after the request id exists is `accepted` (fal has no submit idempotency key: nothing resubmits).
 *
 *   op id    `fal:<endpoint>:<request_id>` — the endpoint (one of `FAL_VIDEO_ENDPOINTS`, never a stored free string)
 *            gives the queue's owner/app for the status / result URLs, rebuilt as the queue docs document them
 *            (`GET https://queue.fal.run/{owner}/{app}/requests/{request_id}/status` and `…/{request_id}`), so nothing a
 *            database row holds can steer the key to another host;
 *   status   200 / 202 `{ status: IN_QUEUE | IN_PROGRESS | COMPLETED, error?, error_type? }` — «a failed or cancelled
 *            request also has the status COMPLETED» (queue OpenAPI, https://fal.ai/docs/api-reference/inference-api/
 *            queue/status.md, read 2026-11-02); 404 = the request does not exist → failed;
 *   result   200 `{ video: { url } }` (every endpoint below, its llms.txt output schema); 404 / 422 / 499 / 500 / 504 are
 *            the model's final answer (https://fal.ai/docs/api-reference/inference-api/queue/result.md) → failed,
 *            `content_policy_violation` → safety; 429 / 502 / 503 / network → retry later (the result is kept ≥ 1 h);
 *   output   the MP4 URL downloaded WITHOUT the key through `safeFetchUrl` (https + public host on every hop, capped at
 *            `VIDEO_MAX_BYTES`), checked to be an MP4 (`isMp4`).
 * `X-Fal-Request-Start-Timeout` = `FAL_VIDEO_START_TIMEOUT_SEC`: a job fal could not START within that is dropped by fal
 * (504 on the result; fal bills «only successful outputs», https://fal.ai/docs/documentation/model-apis/pricing).
 */

/** The fal video adapter's id in the catalog routes. */
export const FAL_VIDEO_ADAPTER_ID = "fal-video";
/** fal drops a queued clip that could not start within this (half the 20-minute job deadline). */
export const FAL_VIDEO_START_TIMEOUT_SEC = 600;
/** One status / result call of a poll never waits longer than this; the MP4 download gets a minute. */
const VIDEO_CALL_MS = 30_000;
const VIDEO_DOWNLOAD_MS = 60_000;
/** A deadline cancel is best effort and must not hold the refund up. */
const FAL_VIDEO_CANCEL_MS = 5_000;

/** The start / end frames of a clip, resolved by the host (ownership checked there), sent to fal as data URIs. */
export type FalVideoFrames = { start?: AdapterAsset; end?: AdapterAsset };

export type FalVideoModel = {
  /** Text → video endpoint (no start frame). */
  t2v: string;
  /** Image → video endpoint (a start frame, optional end frame). */
  i2v: string;
  /** The endpoint's input JSON from the normalized params and the frames. Pure. */
  body(p: NormalizedParams, frames: FalVideoFrames): Record<string, unknown>;
};

const vInt = (p: NormalizedParams, name: string, fallback: number) => (Number.isFinite(Number(p[name])) && p[name] !== "" ? Math.round(Number(p[name])) : fallback);
const vStr = (p: NormalizedParams, name: string, fallback: string) => (typeof p[name] === "string" && p[name] ? String(p[name]) : fallback);
const vBool = (p: NormalizedParams, name: string, fallback: boolean) => (typeof p[name] === "boolean" ? (p[name] as boolean) : fallback);
/** The end frame: `falVideoFrames` is the ONE guard that it travels only with a start (review: no second copy here). */
const endFrame = (key: string, f: FalVideoFrames) => (f.end ? { [key]: dataUri(f.end) } : {});

/** Seedance 2.x: one body for text / image → video; `bitrate` only where the endpoint has `bitrate_mode` (2.5). */
function seedanceBody(p: NormalizedParams, f: FalVideoFrames, bitrate: boolean): Record<string, unknown> {
  return {
    prompt: String(p.prompt ?? ""),
    ...(f.start ? { image_url: dataUri(f.start) } : {}),
    ...endFrame("end_image_url", f),
    resolution: vStr(p, "resolution", "720p"),
    // The DurationEnum is a string ("4".."15"); never "auto": the price is per second of what we asked for.
    duration: String(vInt(p, "seconds", 5)),
    // Image → video: «Always "auto"» (its schema) — the frame decides the canvas.
    aspect_ratio: f.start ? "auto" : vStr(p, "aspect", "16:9"),
    generate_audio: vBool(p, "sound", true),
    ...(bitrate ? { bitrate_mode: "standard" } : {}),
    // H.264 explicitly: «auto» may return H.265, which many phones / browsers do not play.
    codec: "H264",
  };
}

/** MiniMax H3 (and fal's H3 Max Turbo): resolution ids are upper-case on the endpoint (`480P`, `768P`, `1080P`). */
function minimaxBody(p: NormalizedParams, f: FalVideoFrames): Record<string, unknown> {
  return {
    prompt: String(p.prompt ?? ""),
    // Image → video has no aspect_ratio: «the output canvas follows this image».
    ...(f.start ? { image_url: dataUri(f.start) } : { aspect_ratio: vStr(p, "aspect", "16:9") }),
    ...endFrame("end_image_url", f),
    duration: vInt(p, "seconds", 5),
    resolution: vStr(p, "resolution", "768p").toUpperCase(),
    // The endpoint's default, sent explicitly so a default change at fal cannot change our clip silently.
    prompt_expansion_mode: "balanced",
    enable_safety_checker: true,
  };
}

/**
 * Sora 2 / Sora 2 Pro (P9, `fal-ai/sora-2/…`): duration is a string enum; image → video takes `image_url` and aspect
 * «auto» (the frame decides). The resolution is ALWAYS sent (never «auto»): the price is per tier. The standard
 * endpoint has the field too (default "720p" in its schema); our Sora 2 entry has no «Sifat» row, so it is always 720p. `delete_video` is its default, true (OpenAI drops its copy; the fal
 * result URL is what we download), and the standard endpoint's `model` is pinned to its «latest snapshot» default.
 */
function soraBody(p: NormalizedParams, f: FalVideoFrames, pro: boolean): Record<string, unknown> {
  return {
    prompt: String(p.prompt ?? ""),
    ...(f.start ? { image_url: dataUri(f.start) } : {}),
    resolution: vStr(p, "resolution", "720p"),
    aspect_ratio: f.start ? "auto" : vStr(p, "aspect", "16:9"),
    duration: String(vInt(p, "seconds", 4)),
    delete_video: true,
    ...(pro ? {} : { model: "sora-2" }),
  };
}

/**
 * Video request builders, keyed by the catalog route's `upstreamModel` (a model FAMILY: the builder picks the text or
 * the image endpoint). Every field is from the endpoint's own schema (`https://fal.ai/models/<endpoint>/llms.txt`,
 * read 2026-11-02).
 */
export const FAL_VIDEO_MODELS: Readonly<Record<string, FalVideoModel>> = {
  // https://fal.ai/models/alibaba/wan-3.0/text-to-video/llms.txt + …/image-to-video/llms.txt (2026-11-02).
  "alibaba/wan-3.0": {
    t2v: "alibaba/wan-3.0/text-to-video",
    i2v: "alibaba/wan-3.0/image-to-video",
    body: (p, f) => ({
      prompt: String(p.prompt ?? ""),
      ...(f.start ? { start_image_url: dataUri(f.start) } : {}),
      ...endFrame("end_image_url", f),
      resolution: vStr(p, "resolution", "720p"),
      // «adaptive» = the endpoint picks the canvas (from the start frame in image → video).
      aspect_ratio: f.start ? "adaptive" : vStr(p, "aspect", "16:9"),
      duration: vInt(p, "seconds", 5),
      audio: vBool(p, "sound", true),
      enable_prompt_expansion: true,
      enable_safety_checker: true,
    }),
  },
  // https://fal.ai/models/bytedance/seedance-2.5/us/text-to-video/llms.txt + …/image-to-video/llms.txt (2026-11-02).
  "bytedance/seedance-2.5/us": {
    t2v: "bytedance/seedance-2.5/us/text-to-video",
    i2v: "bytedance/seedance-2.5/us/image-to-video",
    body: (p, f) => seedanceBody(p, f, true),
  },
  // https://fal.ai/models/bytedance/seedance-2.0/mini/text-to-video/llms.txt + …/image-to-video/llms.txt (2026-11-02).
  "bytedance/seedance-2.0/mini": {
    t2v: "bytedance/seedance-2.0/mini/text-to-video",
    i2v: "bytedance/seedance-2.0/mini/image-to-video",
    body: (p, f) => seedanceBody(p, f, false),
  },
  // https://fal.ai/models/minimax/h3/text-to-video/llms.txt + …/image-to-video/llms.txt (2026-11-02).
  "minimax/h3": { t2v: "minimax/h3/text-to-video", i2v: "minimax/h3/image-to-video", body: minimaxBody },
  // https://fal.ai/models/minimax/h3-max-turbo/text-to-video/llms.txt + …/image-to-video/llms.txt (2026-11-02).
  "minimax/h3-max-turbo": { t2v: "minimax/h3-max-turbo/text-to-video", i2v: "minimax/h3-max-turbo/image-to-video", body: minimaxBody },
  // https://fal.ai/docs/model-api-reference/video-generation-api/sora-2-text-to-video + …/sora-2-image-to-video (2026-11-03).
  "fal-ai/sora-2": { t2v: "fal-ai/sora-2/text-to-video", i2v: "fal-ai/sora-2/image-to-video", body: (p, f) => soraBody(p, f, false) },
  "fal-ai/sora-2/pro": { t2v: "fal-ai/sora-2/text-to-video/pro", i2v: "fal-ai/sora-2/image-to-video/pro", body: (p, f) => soraBody(p, f, true) },
};

/** Every endpoint a fal video op id may name (the poll refuses anything else). */
export const FAL_VIDEO_ENDPOINTS: ReadonlySet<string> = new Set(Object.values(FAL_VIDEO_MODELS).flatMap((m) => [m.t2v, m.i2v]));

/** The frames of a job: the start image, and the end frame only together with a start (fal's rule and our form's). */
export function falVideoFrames(input: Pick<AdapterInput, "assets">): FalVideoFrames {
  const start = input.assets?.imageAssetId?.[0];
  const end = input.assets?.endImageAssetId?.[0];
  return { ...(start ? { start } : {}), ...(start && end ? { end } : {}) };
}

/** The request `submit` sends (no key inside): endpoint, URL, body. Pure. */
export function falVideoRequest(input: Pick<AdapterInput, "upstreamModel" | "params" | "assets">): { endpoint: string; url: string; headers: Record<string, string>; body: Record<string, unknown> } {
  const model = FAL_VIDEO_MODELS[input.upstreamModel];
  if (!model) throw new MediaError(FAL_PROVIDER, `unknown fal video model ${input.upstreamModel}`);
  const frames = falVideoFrames(input);
  const endpoint = frames.start ? model.i2v : model.t2v;
  return { endpoint, url: `https://${FAL_QUEUE_HOST}/${endpoint}`, headers: { "Content-Type": "application/json" }, body: model.body(input.params, frames) };
}

/**
 * What differs when the same queue protocol serves another async kind (`fal-dub.ts`): the request and which endpoints an op
 * may name, the result's file, the download's check and cap. Absent = the clip behaviour above.
 */
export type FalQueueVariant = {
  id: string;
  endpoints: ReadonlySet<string>;
  request(input: Pick<AdapterInput, "upstreamModel" | "params" | "assets">): { endpoint: string; url: string; headers: Record<string, string>; body: Record<string, unknown> };
  startTimeoutSec: number;
  /** The result's file URL, `null` when it has none. */
  outputOf(result: unknown): string | null;
  /** The downloaded bytes are what this kind delivers (sniffed: a page's or an answer's content type is never trusted). */
  accepts(bytes: Uint8Array): boolean;
  maxBytes: number;
};

/** `fal:<endpoint>:<request_id>` → its parts; `null` for anything this adapter did not issue. */
export function parseFalVideoOp(opId: string, endpoints: ReadonlySet<string> = FAL_VIDEO_ENDPOINTS): { endpoint: string; requestId: string } | null {
  if (!opId.startsWith("fal:")) return null;
  const at = opId.lastIndexOf(":");
  const endpoint = opId.slice(4, at);
  const requestId = opId.slice(at + 1);
  if (at <= 4 || !endpoints.has(endpoint) || !REQUEST_ID.test(requestId)) return null;
  return { endpoint, requestId };
}

/** Result statuses that are the model's final answer (queue result OpenAPI): the clip will not come. */
const FINAL_RESULT_STATUSES: ReadonlySet<number> = new Set([404, 422, 499, 500, 504]);

export function falVideoAdapter(o: Pick<FalDeps, "key" | "lookup"> & { variant?: FalQueueVariant } = {}): MediaAdapter {
  const keyOf = o.key ?? (() => getProviderKey(FAL_PROVIDER));
  const variant = o.variant;
  const requestOf = variant?.request ?? falVideoRequest;
  const endpoints = variant?.endpoints ?? FAL_VIDEO_ENDPOINTS;
  const failOf = (key: string | null) => (msg: string, f: { status?: number; retryable?: boolean; safety?: boolean; accepted?: boolean }) => new MediaError(FAL_PROVIDER, scrub(msg, key), f);

  return {
    id: variant?.id ?? FAL_VIDEO_ADAPTER_ID,
    configured: () => Boolean(keyOf()),
    buildRequest(input) {
      const r = requestOf(input);
      return { url: r.url, headers: r.headers, body: r.body };
    },

    async submit(input, deps: AdapterDeps = {}) {
      const key = keyOf();
      // Nothing was sent: fal holds no job of ours.
      if (!key) throw new MediaError(FAL_PROVIDER, "FAL_KEY yo'q", { accepted: false });
      const fail = failOf(key);
      const req = requestOf(input);
      let res: Response;
      try {
        res = await (deps.fetchImpl ?? globalThis.fetch)(req.url, {
          method: "POST",
          headers: { ...req.headers, Authorization: `Key ${key}`, "X-Fal-Request-Start-Timeout": String(variant?.startTimeoutSec ?? FAL_VIDEO_START_TIMEOUT_SEC) },
          body: JSON.stringify(req.body),
          redirect: "manual",
          signal: AbortSignal.timeout(VIDEO_CALL_MS),
        });
      } catch (e) {
        // No answer: the request may have reached fal and queued a paid clip (never resubmitted elsewhere).
        throw fail(`submit: ${e instanceof Error ? e.message : String(e)}`, { retryable: true, accepted: true });
      }
      if (res.status >= 300 && res.status < 400) throw fail(`submit: ${res.status} redirect rad etildi`, { status: res.status });
      const big = (isAccepted: boolean) => (n: number) => fail(`submit: javob juda katta (${n} belgi)`, { accepted: isAccepted });
      if (!res.ok) {
        const d = detailOf(await json(res, big(false)));
        const safety = d.types.includes(POLICY);
        throw fail(`${res.status} ${d.text || "submit failed"}`, { status: res.status, retryable: !safety && isRetryableStatus(res.status), safety });
      }
      const sub = (await json(res, big(true))) as { request_id?: unknown } | null;
      const id = typeof sub?.request_id === "string" && REQUEST_ID.test(sub.request_id) ? sub.request_id : null;
      if (!id) throw fail("submit: javobda request_id yo'q", { accepted: true });
      return { opId: `fal:${req.endpoint}:${id}` };
    },

    async poll(opId, deps: AdapterDeps = {}): Promise<PollResult> {
      const key = keyOf();
      const fail = failOf(key);
      const op = parseFalVideoOp(opId, endpoints);
      if (!op) throw fail("noto'g'ri operatsiya id", { accepted: true });
      // The key was removed after the submit: wait (the admin may put it back) until the job's deadline refunds it.
      if (!key) throw fail("FAL_KEY yo'q", { accepted: true, retryable: true });
      const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
      const base = `https://${FAL_QUEUE_HOST}/${ownerApp(op.endpoint)}/requests/${op.requestId}`;
      const get = (url: string) => fetchImpl(url, { method: "GET", headers: { Authorization: `Key ${key}` }, redirect: "manual", signal: AbortSignal.timeout(VIDEO_CALL_MS) });
      const big = (where: string) => (n: number) => fail(`${where}: javob juda katta (${n} belgi)`, { accepted: true, retryable: true });

      let st: Response;
      try {
        st = await get(`${base}/status`);
      } catch (e) {
        throw fail(`status: ${e instanceof Error ? e.message : String(e)}`, { retryable: true, accepted: true });
      }
      if (st.status >= 300 && st.status < 400) throw fail(`status: ${st.status} redirect rad etildi`, { status: st.status, accepted: true });
      if (st.status === 404) return { state: "failed", message: "fal: so'rov topilmadi", safety: false };
      if (!st.ok) {
        const d = detailOf(await json(st, big("status")));
        throw fail(`status ${st.status} ${d.text}`, { status: st.status, retryable: isRetryableStatus(st.status), accepted: true });
      }
      const body = (await json(st, big("status"))) as { status?: unknown; error?: unknown; error_type?: unknown } | null;
      if (body?.status === "IN_QUEUE" || body?.status === "IN_PROGRESS") return { state: "running" };
      if (body?.status !== "COMPLETED") throw fail(`status: ${String(body?.status ?? "?")}`, { retryable: true, accepted: true });
      if (typeof body.error === "string" && body.error) {
        const safety = body.error_type === POLICY || looksLikeSafetyRefusal(body.error);
        return { state: "failed", message: scrub(body.error, key), safety };
      }

      let out: Response;
      try {
        out = await get(base);
      } catch (e) {
        throw fail(`result: ${e instanceof Error ? e.message : String(e)}`, { retryable: true, accepted: true });
      }
      if (out.status >= 300 && out.status < 400) throw fail(`result: ${out.status} redirect rad etildi`, { status: out.status, accepted: true });
      const result = (await json(out, big("result"))) as { video?: { url?: unknown } } | null;
      if (!out.ok) {
        const d = detailOf(result);
        const safety = d.types.includes(POLICY);
        if (safety || FINAL_RESULT_STATUSES.has(out.status)) return { state: "failed", message: scrub(`${out.status} ${d.text || "result failed"}`, key), safety };
        throw fail(`result ${out.status} ${d.text}`, { status: out.status, retryable: isRetryableStatus(out.status), accepted: true });
      }
      const url = variant ? (variant.outputOf(result) ?? "") : typeof result?.video?.url === "string" ? result.video.url : "";
      if (!url) return { state: "failed", message: "fal: javobda video yo'q", safety: false };
      return { state: "done", outputs: [{ kind: "url", url, ...(variant ? {} : { mime: "video/mp4" }) }] };
    },

    /**
     * Best-effort cancel (the host's deadline passed): `PUT https://queue.fal.run/{owner}/{app}/requests/{id}/cancel`
     * (https://fal.ai/docs/api-reference/inference-api/queue/cancel.md, read 2026-11-02) — same key / host / redirect /
     * scrub rules. A queued request is removed, a running one gets a cancel signal. Throws on any failure; the caller
     * logs it and refunds anyway.
     */
    async cancel(opId, deps: AdapterDeps = {}) {
      const key = keyOf();
      const fail = failOf(key);
      const op = parseFalVideoOp(opId, endpoints);
      if (!op) throw fail("noto'g'ri operatsiya id", { accepted: true });
      if (!key) throw fail("FAL_KEY yo'q", { accepted: true });
      let res: Response;
      try {
        res = await (deps.fetchImpl ?? globalThis.fetch)(`https://${FAL_QUEUE_HOST}/${ownerApp(op.endpoint)}/requests/${op.requestId}/cancel`, {
          method: "PUT",
          headers: { Authorization: `Key ${key}` },
          redirect: "manual",
          signal: AbortSignal.timeout(FAL_VIDEO_CANCEL_MS),
        });
      } catch (e) {
        throw fail(`cancel: ${e instanceof Error ? e.message : String(e)}`, { accepted: true });
      }
      await res.body?.cancel().catch(() => {});
      // 200 removed from the queue / 202 cancel signal sent; 400 «already complete» (fal may bill it: reconcile).
      if (res.status === 400) return "completed";
      if (!res.ok) throw fail(`cancel ${res.status}`, { status: res.status, accepted: true });
      return "cancelled";
    },

    async fetchOutput(output, deps: AdapterDeps = {}) {
      const fail = failOf(keyOf());
      const accepts = variant?.accepts ?? isMp4;
      if (output.kind === "inline") {
        if (!accepts(output.bytes)) throw fail("video: MP4 emas", { accepted: true });
        return output.bytes;
      }
      let res: Response;
      try {
        // WITHOUT the key: a CDN URL, checked host by host, capped.
        res = await safeFetchUrl(output.url, { timeoutMs: VIDEO_DOWNLOAD_MS, maxBytes: variant?.maxBytes ?? VIDEO_MAX_BYTES, ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}), ...(o.lookup ? { lookup: o.lookup } : {}) });
      } catch (e) {
        if (e instanceof UnsafeUrlError) throw fail(e.reason === "size" ? "video fayli juda katta" : `video URL rad etildi (${e.reason})`, { accepted: true });
        throw fail(`download: ${e instanceof Error ? e.message : String(e)}`, { retryable: true, accepted: true });
      }
      if (!res.ok) throw fail(`download ${res.status}`, { status: res.status, retryable: isRetryableStatus(res.status), accepted: true });
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (!accepts(bytes)) throw fail("yuklangan fayl MP4 emas", { retryable: true, accepted: true });
      return bytes;
    },
  };
}
/* ═════════════════════ end of the P4 video block ═════════════════════ */
