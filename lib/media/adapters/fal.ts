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
 */
import { MediaError, checkOutput, isRetryableStatus, type AdapterDeps, type AdapterInput, type MediaAdapter, type MediaOutput, type NormalizedParams } from "../../studio-core";
import { IMAGE_RATIOS } from "../../generation/image-studio-options";
import { safeFetchUrl, type LookupFn } from "../../generation/safe-fetch";
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
  /** The model's input JSON from the normalized params (+ the engine's composed `prompt` in `extra`). Pure. */
  body(p: NormalizedParams): Record<string, unknown>;
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

/** Removes the key and `Key …` / `Authorization` shapes from a provider text; clips it. */
export function scrub(text: string, key: string | null | undefined): string {
  let out = String(text ?? "");
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

  function buildRequest(input: AdapterInput) {
    const model = FAL_MODELS[input.upstreamModel];
    if (!model) throw new MediaError(FAL_PROVIDER, `unknown fal model ${input.upstreamModel}`);
    return { url: `https://${FAL_QUEUE_HOST}/${input.upstreamModel}`, headers: { "Content-Type": "application/json" }, body: model.body(input.params) };
  }

  return {
    id: FAL_ADAPTER_ID,
    configured: () => Boolean(keyOf()),
    buildRequest,
    async submit(input, deps: AdapterDeps = {}) {
      const key = keyOf();
      if (!key) throw new MediaError(FAL_PROVIDER, "FAL_KEY yo'q");
      const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
      const now = deps.now ?? Date.now;
      const deadline = deps.deadline ?? now() + DEFAULT_BUDGET_MS;
      const left = () => deadline - now();
      const fail = (msg: string, f: { status?: number; retryable?: boolean; safety?: boolean; accepted?: boolean }) => new MediaError(FAL_PROVIDER, scrub(msg, key), f);
      const signal = () => AbortSignal.timeout(Math.max(1, Math.min(CALL_MS, left())));
      const auth = { Authorization: `Key ${key}` };

      if (left() < MIN_BUDGET_MS) throw fail("byudjet 2 s dan kam", { retryable: true });
      const req = buildRequest(input);

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
      const result = (await json(out, big("result", true))) as { images?: { url?: unknown }[]; has_nsfw_concepts?: unknown } | null;
      if (!out.ok) {
        const d = detailOf(result);
        const safety = d.types.includes(POLICY);
        throw accepted(`${out.status} ${d.text || "result failed"}`, { status: out.status, safety, retryable: !safety && isRetryableStatus(out.status) });
      }
      const nsfw = Array.isArray(result?.has_nsfw_concepts) ? (result!.has_nsfw_concepts as unknown[]) : [];
      const urls = (Array.isArray(result?.images) ? result!.images : []).map((im, i) => ({ url: typeof im?.url === "string" ? im.url : "", flagged: nsfw[i] === true }));
      const usable = urls.filter((u) => u.url && !u.flagged);
      if (usable.length === 0) {
        if (urls.some((u) => u.flagged)) throw accepted(`${POLICY}: rasm xavfsizlik filtridan o'tmadi`, { safety: true });
        throw accepted("javobda rasm yo'q", {});
      }

      // 4. Bytes: a data URI decoded, a URL downloaded WITHOUT the key; the type sniffed, never trusted.
      const outputs: MediaOutput[] = [];
      for (const u of usable) {
        let bytes: Uint8Array | null;
        if (u.url.startsWith("data:")) {
          bytes = decodeDataUri(u.url);
        } else {
          try {
            const got = await safeFetchUrl(u.url, { timeoutMs: Math.max(1, Math.min(CALL_MS, left())), maxBytes: IMAGE_SPEC.maxBytes, fetchImpl, ...(o.lookup ? { lookup: o.lookup } : {}) });
            bytes = got.ok ? new Uint8Array(await got.arrayBuffer()) : null;
          } catch (e) {
            throw accepted(`download: ${e instanceof Error ? e.message : String(e)}`, { retryable: true });
          }
        }
        if (!bytes) throw accepted("rasm yuklab olinmadi", { retryable: true });
        const check = await checkOutput(bytes, IMAGE_SPEC);
        if (!check.ok) throw accepted(`rasm: ${check.error}`, {});
        outputs.push({ kind: "inline", bytes, mime: check.mime });
      }
      return { done: outputs };
    },
    async fetchOutput(o2) {
      if (o2.kind === "inline") return o2.bytes;
      throw new MediaError(FAL_PROVIDER, "fal outputs are inline");
    },
  };
}
