/**
 * GOOGLE adapter of the `veo` provider (program-17 item 5): Gemini Omni Flash through the Interactions API.
 *
 * WHY NOT THE VEO REST ENDPOINT. The brief asked for «Veo via the Gemini API long-running operation»
 * (`models/veo-*:predictLongRunning`). On 2026-10-24 Google's own pages say that path is gone from the Gemini API:
 *   - https://ai.google.dev/gemini-api/docs/video : «The Veo 3.1 Preview in the Gemini API has been shut down»
 *     (`veo-3.1-generate-preview`, `-fast-`, `-lite-` shut down on October 22, 2026), «migrate to Gemini Omni Flash
 *     (`gemini-omni-1.1-flash`) or the GA models on the Gemini Enterprise Agent Platform»;
 *   - https://ai.google.dev/gemini-api/docs/deprecations : `veo-3.0-generate-001` and `veo-3.0-fast-generate-001`
 *     were scheduled for shutdown on June 30, 2026, replacement `gemini-omni-1.1-flash`.
 * So building the dead endpoint would ship an adapter that cannot work. The provider id stays `veo` (the key store
 * row, the env var GEMINI_API_KEY and the owner's mental model do not change); the model behind it is the one Google
 * names as the video model of the Gemini API.
 *
 * API (https://ai.google.dev/gemini-api/docs/omni and /background-execution):
 *   POST https://generativelanguage.googleapis.com/v1beta/interactions   header `x-goog-api-key`
 *     { model: "gemini-omni-1.1-flash", input: <text | [image part, text part]>, background: true,
 *       response_format: { type: "video", aspect_ratio: "16:9"|"9:16", resolution: "720p", delivery: "uri" } }
 *     -> { id, status: "in_progress" }                      (`background: true` returns at once; `store` stays true)
 *   GET  .../interactions/{id}  -> status in_progress | completed | failed | cancelled | requires_action | incomplete;
 *     completed: steps[].content[] holds a part { type: "video", mime_type: "video/mp4", data | uri }.
 *   A `uri` is a Files API resource: it is fetched with `...:download?alt=media` and the same key header.
 * Pricing: $17.50 / 1M output tokens, 5 792 tokens per second of 720p = ~$0.10 / s (…/docs/pricing).
 *
 * WHAT THE DOCS DO NOT SAY (needs the first live call, see the report):
 *   - there is NO duration parameter: the requested length goes into the prompt as a hint, and the length actually
 *     delivered is measured from the MP4 (`mp4Seconds`) and refunded pro rata when it is short;
 *   - the error object of a failed / blocked interaction is only «an `errors` array of {code, message}»; a completed
 *     interaction with no video part is treated as a safety refusal (refund + clear Uzbek message).
 */
import { safeFetchUrl, UnsafeUrlError } from "../safe-fetch";
import { getProviderKey } from "../../server/providers/resolve";
import { isMp4 } from "./mp4";
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

export const OMNI_BASE = "https://generativelanguage.googleapis.com/v1beta";
export const OMNI_MODEL = "gemini-omni-1.1-flash";
/** The `Api-Revision` the background-execution guide sends with its curl examples. */
export const OMNI_API_REVISION = "2026-05-20";
export const OMNI_RESOLUTION = "720p";

export const omniKey = (): string => getProviderKey("veo");

/** The length goes into the prompt: the API has no duration field (see the file header). */
export function omniPrompt(prompt: string, seconds: number): string {
  return `${prompt.trim()}\n\nThe video should last about ${seconds} seconds.`;
}

export function buildOmniRequest(input: VideoRequestInput): VideoRequest {
  const text = omniPrompt(input.prompt, input.seconds);
  return {
    url: `${OMNI_BASE}/interactions`,
    headers: { "Content-Type": "application/json", "Api-Revision": OMNI_API_REVISION },
    body: {
      model: OMNI_MODEL,
      input: input.image
        ? [
            { type: "image", data: input.image.base64, mime_type: input.image.mime },
            { type: "text", text },
          ]
        : text,
      ...(input.image ? { generation_config: { video_config: { task: "image_to_video" } } } : {}),
      background: true,
      response_format: { type: "video", aspect_ratio: input.aspect, resolution: OMNI_RESOLUTION, delivery: "uri" },
    },
  };
}

type Part = { type?: string; mime_type?: string; data?: string; uri?: string };
type Interaction = {
  id?: string;
  status?: string;
  steps?: { content?: Part[] }[];
  errors?: { code?: string; message?: string }[];
};

function videoPartOf(it: Interaction): Part | null {
  for (const step of it.steps ?? []) for (const part of step.content ?? []) if (part.type === "video" && (part.data || part.uri)) return part;
  return null;
}

/** `https://…/v1beta/files/abc` -> `…/files/abc:download?alt=media`; anything else is fetched as given. */
export function omniDownloadUrl(uri: string): string {
  if (uri.includes(":download")) return uri;
  return /\/files\/[^/?]+$/.test(uri) ? `${uri}:download?alt=media` : uri;
}

const isGoogleHost = (url: string): boolean => {
  try {
    return new URL(url).hostname.endsWith(".googleapis.com");
  } catch {
    return false;
  }
};

export function makeOmniAdapter(opts: { key?: () => string } = {}): VideoAdapter {
  const key = opts.key ?? omniKey;
  const authed = (extra: Record<string, string> = {}) => ({ "x-goog-api-key": key(), "Api-Revision": OMNI_API_REVISION, ...extra });

  async function call(method: "GET" | "POST", url: string, body: unknown, deps: VideoAdapterDeps): Promise<{ status: number; json: unknown }> {
    const k = key();
    let res: Response;
    try {
      res = await (deps.fetchImpl ?? fetch)(url, {
        method,
        signal: AbortSignal.timeout(Math.max(1_000, deps.timeoutMs ?? 30_000)),
        headers: authed(method === "POST" ? { "Content-Type": "application/json" } : {}),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (e) {
      throw new VideoProviderError("veo", scrubSecrets(e instanceof Error ? e.message : "tarmoq xatosi", [k]), { retryable: true });
    }
    const text = await res.text().catch(() => "");
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const msg = scrubSecrets(((json as { error?: { message?: string } } | null)?.error?.message ?? text).slice(0, 300), [k]);
      throw new VideoProviderError("veo", `${res.status} ${msg}`, {
        status: res.status,
        retryable: res.status === 429 || res.status >= 500,
        safety: res.status === 400 && looksLikeSafetyRefusal(msg),
      });
    }
    return { status: res.status, json };
  }

  return {
    id: "veo",
    configured: () => Boolean(key()),
    buildRequest: buildOmniRequest,

    async submit(input, deps = {}) {
      if (!key()) throw new VideoProviderError("veo", "GEMINI_API_KEY yo'q");
      const req = buildOmniRequest(input);
      const { json } = await call("POST", req.url, req.body, deps);
      const it = (json ?? {}) as Interaction;
      if (!it.id) throw new VideoProviderError("veo", "javobda interaction id yo'q");
      if (it.status === "failed" || it.status === "cancelled") {
        const msg = it.errors?.[0]?.message ?? "";
        throw new VideoProviderError("veo", scrubSecrets(msg || "so'rov rad etildi", [key()]), { safety: looksLikeSafetyRefusal(msg) });
      }
      return { opId: it.id };
    },

    async poll(opId, deps = {}): Promise<VideoPollResult> {
      const { json } = await call("GET", `${OMNI_BASE}/interactions/${encodeURIComponent(opId)}`, undefined, deps);
      const it = (json ?? {}) as Interaction;
      switch (it.status) {
        case "completed": {
          const part = videoPartOf(it);
          if (part?.data) return { state: "done", media: { kind: "inline", bytes: new Uint8Array(Buffer.from(part.data, "base64")) } };
          if (part?.uri) return { state: "done", media: { kind: "url", url: omniDownloadUrl(part.uri) } };
          // Completed without a video part: the model answered with text only -- a refusal. Neither doc page names a field.
          return { state: "failed", message: VIDEO_SAFETY_MESSAGE, safety: true };
        }
        case "failed":
        case "cancelled":
        case "incomplete": {
          const msg = scrubSecrets(it.errors?.[0]?.message ?? "", [key()]);
          const safety = looksLikeSafetyRefusal(msg);
          return { state: "failed", message: safety ? VIDEO_SAFETY_MESSAGE : msg || "Provayder videoni yaratmadi", safety };
        }
        case "requires_action":
          return { state: "failed", message: "Provayder qo'shimcha amal talab qildi", safety: false };
        default:
          // in_progress, or a status this version of the API added: keep waiting until the deadline.
          return { state: "running" };
      }
    },

    async download(media: VideoMedia, deps = {}) {
      if (media.kind === "inline") {
        if (!isMp4(media.bytes)) throw new VideoProviderError("veo", "javob MP4 emas");
        return media.bytes;
      }
      const k = key();
      let res: Response;
      try {
        /*
         * Redirects are followed HERE, one hop at a time, so the key is decided per hop: it travels only to a Google host
         * (`isGoogleHost`) and never across a redirect to anything else (`safeFetchUrl` itself would resend the same
         * headers to the redirect target). Each hop still passes the public-https / DNS checks of `safeFetchUrl`.
         */
        let url = media.url;
        for (let hop = 0; ; hop++) {
          res = await safeFetchUrl(url, {
            fetchImpl: deps.fetchImpl,
            timeoutMs: Math.max(5_000, deps.timeoutMs ?? 60_000),
            maxBytes: VIDEO_MAX_BYTES,
            maxRedirects: 0,
            headers: isGoogleHost(url) ? { "x-goog-api-key": k } : {},
          });
          if (res.status < 300 || res.status >= 400) break;
          const loc = res.headers.get("location");
          if (!loc || hop >= 3) throw new UnsafeUrlError("redirect", "redirect zanjiri yaroqsiz");
          url = new URL(loc, url).toString();
        }
      } catch (e) {
        if (e instanceof UnsafeUrlError && e.reason === "size") throw new VideoProviderError("veo", "video fayli juda katta");
        throw new VideoProviderError("veo", scrubSecrets(e instanceof Error ? e.message : "yuklab bo'lmadi", [k]), { retryable: !(e instanceof UnsafeUrlError) });
      }
      // 404 right after completion: the Files API resource is not ACTIVE yet -- retry on the next poll.
      if (!res.ok) throw new VideoProviderError("veo", `yuklash ${res.status}`, { status: res.status, retryable: res.status === 404 || res.status === 429 || res.status >= 500 });
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (!isMp4(bytes)) throw new VideoProviderError("veo", "yuklangan fayl MP4 emas", { retryable: true });
      return bytes;
    },
  };
}

export const omniAdapter = makeOmniAdapter();
