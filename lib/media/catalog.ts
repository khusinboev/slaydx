/**
 * SlaydX media catalog — the models the product sells, as entries of the media core (docs/studio/P0-SPEC.md §3.6–3.7).
 *
 * Client-safe (no server imports): the forms, the price preview, the server and the admin page read THIS file.
 *
 * P0 holds exactly today's models and today's prices: every sold model carries a `fixed` price override that calls the
 * existing ladder (`imageBasePrice`, `videoPrice`), so a quote through the core equals `priceFor` by construction —
 * `tests/media-catalog.test.mts` proves it for every reachable form value. The CostRules are the provider's real
 * cost (from `llm-pricing.ts`, never a second copy); the owner's «cost × 2» rule takes over in P1 by removing an
 * override.
 *
 * Gemini's upstream image model is not fixed here: the admin routing slot `image.gemini` picks it
 * (`providers/route-effective.ts`), the host swaps it into the route. The value below is only the default.
 */
import { defineCatalog, definePurposes, type CatalogEntry, type NormalizedParams, type ParamSchema, type PriceOverride } from "../studio-core";
import { FAL_IDEOGRAM_QUALITY_USD, IMAGE_PRICES, OPENAI_IMAGE_FALLBACK_USD, TTS_PRICING } from "../generation/llm-pricing";
import { IMAGE_RATIOS, IMAGE_STYLES } from "../generation/image-studio-options";
import { imageBasePrice, imageModelById, type ImageModelId } from "../generation/image-models";
import { IMAGE_PROMPT_LIMIT } from "../generation/image-params";
import { VIDEO_ASPECTS, VIDEO_PROMPT_MAX, VIDEO_PROMPT_MIN, videoProviderById, type VideoProviderId } from "../generation/video/registry";
import { VIDEO_MAX_BYTES } from "../generation/video/types";
import { PPTX_SIZE_LIMIT } from "../generation/size-limits";
import { STUDIO_VIDEO_ENTRIES, STUDIO_VIDEO_PURPOSE_SPEC } from "./catalog-video";

/** Same as `IMAGE_PROMPT_MIN` in `lib/tools.ts` (not imported: tools.ts will read this file; a test keeps them equal). */
export const MEDIA_IMAGE_PROMPT_MIN = 3;

/** Gemini lite image model, the default of the `image.gemini` slot. */
const GEMINI_IMAGE_DEFAULT = "gemini-3.1-flash-lite-image";
const OPENAI_IMAGE_DEFAULT = "gpt-image-2.5-flare";

/** USD per second of video. Omni: $17.50 / 1M output tokens × 5 792 tokens/s (video/registry.ts). Kling: UNVERIFIED. */
export const VIDEO_USD_PER_SECOND: Readonly<Record<VideoProviderId, number>> = { veo: 0.1, kling: 0.1 };

/**
 * Order = the Studio form's row order (P1 contract with the UI): O'lcham, Soni, then Uslub under «Qo'shimcha
 * sozlamalar» (`advanced`). The «Rasm» tool has its own form; validation and prices do not depend on the order.
 */
const imageParams: readonly ParamSchema[] = [
  { name: "prompt", label: "Rasm tavsifi", type: "text", min: MEDIA_IMAGE_PROMPT_MIN, max: IMAGE_PROMPT_LIMIT, affects: "request" },
  { name: "imageRatio", label: "O'lcham", type: "enum", options: IMAGE_RATIOS.map((r) => ({ value: r.id, label: r.label })), default: IMAGE_RATIOS[0].id, affects: "request" },
  { name: "imageCount", label: "Soni", type: "int", min: 1, max: 4, default: 1, affects: "price" },
  { name: "imageStyle", label: "Uslub", type: "enum", options: IMAGE_STYLES.map((s) => ({ value: s.id, label: s.name })), default: IMAGE_STYLES[0].id, affects: "request", advanced: true },
];

/**
 * The provider's allowed clip lengths as an int param that accepts EXACTLY that list (and nothing between).
 *
 * Not an enum: the core's enum compares strings strictly, and the forms / API send `seconds` as a number, so an enum
 * would reject `5` where `videoParamsError` accepts it. An int with `step` accepts exactly the list only when the list
 * is evenly spaced, so that is CHECKED here: a provider whose lengths are not (e.g. 5, 8, 10) fails at load time instead
 * of silently accepting lengths it does not offer. `tests/media-catalog.test.mts` compares the accepted set with the list.
 */
export function videoSecondsParam(secs: readonly number[]): ParamSchema {
  const sorted = [...secs].sort((a, b) => a - b);
  const step = sorted.length > 1 ? sorted[1]! - sorted[0]! : undefined;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]! - sorted[i - 1]! !== step) throw new Error(`media catalog: video seconds ${sorted.join(", ")} are not evenly spaced; an int param cannot express them`);
  }
  return { name: "seconds", label: "Davomiylik", type: "int", min: sorted[0]!, max: sorted[sorted.length - 1]!, ...(step ? { step } : {}), default: secs[0]!, affects: "both" };
}

function videoParams(id: VideoProviderId): readonly ParamSchema[] {
  const secs = videoProviderById(id).seconds;
  return [
    { name: "prompt", label: "Video tavsifi", type: "text", min: VIDEO_PROMPT_MIN, max: VIDEO_PROMPT_MAX, affects: "request" },
    videoSecondsParam(secs),
    { name: "aspect", label: "O'lcham", type: "enum", options: VIDEO_ASPECTS.map((a) => ({ value: a, label: a })), default: VIDEO_ASPECTS[0], affects: "request" },
    { name: "imageAssetId", label: "Boshlang'ich surat", type: "image", max: 1, mimes: ["image/jpeg", "image/png", "image/webp"], maxBytes: 10 * 1024 * 1024, affects: "request" },
  ];
}

const speechParams: readonly ParamSchema[] = [
  { name: "text", label: "Matn", type: "text", min: 1, max: 200_000, affects: "both" },
  { name: "voice", label: "Ovoz", type: "voice", source: "catalog", affects: "request" },
];

function charsUsd(provider: string): number {
  const row = TTS_PRICING.find((r) => r.billing === "chars" && r.provider === provider);
  return row && "usdPerMChars" in row ? row.usdPerMChars / 1000 : 0;
}

const IMAGE_OUT = { mimes: ["image/png", "image/jpeg", "image/webp"], maxBytes: PPTX_SIZE_LIMIT } as const;
const AUDIO_OUT = { mimes: ["audio/mpeg", "audio/wav"], maxBytes: PPTX_SIZE_LIMIT } as const;

export const MEDIA_ENTRIES: readonly CatalogEntry[] = [
  {
    id: "google/nano-banana",
    kind: "image",
    capabilities: ["t2i", "edit"],
    label: "Nano Banana",
    maker: "Google",
    badges: ["tez", "arzon"],
    params: imageParams,
    cost: { per: "output", usd: IMAGE_PRICES[GEMINI_IMAGE_DEFAULT], countParam: "imageCount" },
    routes: [{ provider: "gemini", upstreamModel: GEMINI_IMAGE_DEFAULT, adapter: "google-image" }],
    limits: { timeoutMs: 120_000 },
    output: IMAGE_OUT,
  },
  {
    id: "openai/gpt-image",
    kind: "image",
    capabilities: ["t2i"],
    label: "ChatGPT (GPT Image)",
    maker: "OpenAI",
    badges: ["sifatli", "matn"],
    params: imageParams,
    cost: { per: "output", usd: OPENAI_IMAGE_FALLBACK_USD, countParam: "imageCount" },
    routes: [{ provider: "openai-image", upstreamModel: OPENAI_IMAGE_DEFAULT, adapter: "openai-image" }],
    limits: { timeoutMs: 90_000 },
    output: IMAGE_OUT,
  },
  // fal.ai models (docs/studio/P2-SPEC.md): one generic adapter (`adapters/fal.ts`), the endpoint id is the upstream.
  fal("bfl/flux", "FLUX 3", "Black Forest Labs", ["sifatli"], "blackforestlabs/flux-3/text-to-image", flatFalCost("blackforestlabs/flux-3/text-to-image"), 90_000),
  // Two tiers of one family are two models (owner 2026-11-02): the user sees and pays each tier's own price.
  fal("bytedance/seedream", "Seedream 5 Lite", "ByteDance", ["arzon", "tez"], "bytedance/seedream/v5/lite/text-to-image", flatFalCost("bytedance/seedream/v5/lite/text-to-image"), 120_000),
  fal("bytedance/seedream-pro", "Seedream 5 Pro", "ByteDance", ["sifatli"], "bytedance/seedream/v5/pro/text-to-image", flatFalCost("bytedance/seedream/v5/pro/text-to-image"), 120_000),
  fal(
    "ideogram/ideogram",
    "Ideogram 4.5",
    "Ideogram",
    ["matn", "sifatli"],
    "ideogram/v4.5",
    { per: "output", usd: FAL_IDEOGRAM_QUALITY_USD.medium, countParam: "imageCount", by: { param: "quality", table: FAL_IDEOGRAM_QUALITY_USD } },
    120_000,
    [
      {
        name: "quality",
        label: "Sifat",
        hint: "Yuqori sifat qimmatroq",
        type: "enum",
        options: [
          { value: "low", label: "Tez" },
          { value: "medium", label: "Standart" },
          { value: "high", label: "Yuqori" },
        ],
        default: "medium",
        affects: "both",
        advanced: true,
      },
    ],
  ),
  fal("recraft/recraft", "Recraft 4.1", "Recraft", ["arzon"], "fal-ai/recraft/v4.1/text-to-image", flatFalCost("fal-ai/recraft/v4.1/text-to-image"), 90_000),
  fal("recraft/recraft-pro", "Recraft 4.1 Pro", "Recraft", ["sifatli"], "fal-ai/recraft/v4.1/pro/text-to-image", flatFalCost("fal-ai/recraft/v4.1/pro/text-to-image"), 120_000),
  {
    id: "google/omni-video",
    kind: "video",
    capabilities: ["t2v", "i2v"],
    label: "Google Veo (Gemini)",
    maker: "Google",
    badges: ["sifatli", "ovozli"],
    params: videoParams("veo"),
    cost: { per: "second", usd: VIDEO_USD_PER_SECOND.veo, secondsParam: "seconds" },
    routes: [{ provider: "veo", upstreamModel: "omni-flash", adapter: "google-video" }],
    limits: { timeoutMs: 60_000, deadlineMs: 20 * 60_000 },
    output: { mimes: ["video/mp4"], maxBytes: VIDEO_MAX_BYTES },
  },
  {
    id: "kling/video",
    kind: "video",
    capabilities: ["t2v", "i2v"],
    label: "Kling AI",
    maker: "Kuaishou",
    badges: ["arzon"],
    params: videoParams("kling"),
    cost: { per: "second", usd: VIDEO_USD_PER_SECOND.kling, secondsParam: "seconds" },
    routes: [{ provider: "kling", upstreamModel: "kling-v2-master", adapter: "kling-video" }],
    limits: { timeoutMs: 60_000, deadlineMs: 20 * 60_000 },
    output: { mimes: ["video/mp4"], maxBytes: VIDEO_MAX_BYTES },
  },
  ...STUDIO_VIDEO_ENTRIES,
  speech("google/tts", "Gemini TTS", "Google", "gemini", "gemini-speech", 0.015),
  speech("elevenlabs/tts", "ElevenLabs", "ElevenLabs", "elevenlabs", "elevenlabs-speech", charsUsd("elevenlabs")),
  speech("azure/tts", "Azure Speech", "Microsoft", "azure", "azure-speech", charsUsd("azure")),
  speech("aisha/tts", "Aisha", "Aisha", "aisha", "aisha-speech", 0.078),
];

/**
 * Speech is sold inside its tool's price (podcast per minute, greeting, domla), never per call: these entries exist
 * for routing, telemetry and margins. Gemini's per-kchar figure is an estimate of its token billing (~1 000 chars ≈
 * 1 min ≈ $0.015, PLAN §3); Aisha bills 1 so'm/char (~$0.078 per 1 000 at 12 800 so'm/$).
 */
function speech(id: string, label: string, maker: string, provider: string, adapter: string, usdPerKchar: number): CatalogEntry {
  return {
    id,
    kind: "speech",
    capabilities: ["tts"],
    label,
    maker,
    badges: [],
    params: speechParams,
    cost: { per: "kchar", usd: usdPerKchar, textParam: "text" },
    routes: [{ provider, upstreamModel: provider, adapter }],
    limits: { timeoutMs: 90_000 },
    output: AUDIO_OUT,
  };
}

/** Flat fal price per picture from the price book (`IMAGE_PRICES`, sources there); a missing row fails at load. */
function flatFalCost(endpoint: string): CatalogEntry["cost"] {
  const usd = IMAGE_PRICES[endpoint];
  if (!(typeof usd === "number" && usd > 0)) throw new Error(`media catalog: no fal price for ${endpoint}`);
  return { per: "output", usd, countParam: "imageCount" };
}

/**
 * A text-to-image model on fal: the Studio's image params (same rows, same validation) + the model's own params, if
 * any (each changes the request or the price: «every param must work», `tests/media-fal.test.mts`). The provider id
 * `fal` decides availability (key + switch in «Provayderlar»), the adapter `fal` speaks to it.
 */
function fal(
  id: string,
  label: string,
  maker: string,
  badges: CatalogEntry["badges"],
  endpoint: string,
  cost: CatalogEntry["cost"],
  timeoutMs: number,
  extra: readonly ParamSchema[] = [],
): CatalogEntry {
  return {
    id,
    kind: "image",
    capabilities: ["t2i"],
    label,
    maker,
    badges,
    params: [...imageParams, ...extra],
    cost,
    routes: [{ provider: "fal", upstreamModel: endpoint, adapter: "fal" }],
    limits: { timeoutMs },
    output: IMAGE_OUT,
  };
}

export const MEDIA_CATALOG = defineCatalog(MEDIA_ENTRIES);

/** The Studio image models drawn through fal (catalog order). */
export const FAL_IMAGE_MODELS: readonly string[] = MEDIA_ENTRIES.filter((e) => e.kind === "image" && e.routes.some((r) => r.provider === "fal")).map((e) => e.id);

/**
 * Short model name for the image viewer: the «Rasm» names for its two models (old docs store `gemini` / `openai`, the
 * Studio stores their catalog ids), the catalog label for every other catalog model, `null` for an unknown id.
 */
export function imageModelLabel(id: string): string | null {
  const rasm = IMAGE_MODEL_TO_MEDIA[id as ImageModelId] ? id : Object.entries(IMAGE_MODEL_TO_MEDIA).find(([, v]) => v === id)?.[0];
  if (rasm) return imageModelById(rasm).short;
  return MEDIA_CATALOG.byId(id)?.label ?? null;
}

/** Today's `rasm` / `video` model ids ↔ catalog ids (the forms keep sending the old values in P0). */
export const IMAGE_MODEL_TO_MEDIA: Readonly<Record<ImageModelId, string>> = { gemini: "google/nano-banana", openai: "openai/gpt-image" };
export const VIDEO_PROVIDER_TO_MEDIA: Readonly<Record<VideoProviderId, string>> = { veo: "google/omni-video", kling: "kling/video" };

const imageLadder = (model: ImageModelId): PriceOverride => ({ mode: "fixed", price: (p: NormalizedParams) => imageBasePrice(model, Number(p.imageCount)) });
const videoLadder = (id: VideoProviderId): PriceOverride => ({ mode: "fixed", price: (p: NormalizedParams) => videoProviderById(id).soumPerSecond * Number(p.seconds) });

/** P0 price overrides: today's hand-set ladders, so nothing a user pays changes (P0-SPEC §3.6). */
export const LEGACY_PRICE_OVERRIDES: Readonly<Record<string, PriceOverride>> = {
  "google/nano-banana": imageLadder("gemini"),
  "openai/gpt-image": imageLadder("openai"),
  "google/omni-video": videoLadder("veo"),
  "kling/video": videoLadder("kling"),
};

const SPEECH_CHAIN = ["azure/tts", "aisha/tts", "google/tts"];

/** Purpose of the Studio «Rasm» tab (tool `studio-image`). */
export const STUDIO_IMAGE_PURPOSE = "studio.image";

export const MEDIA_PURPOSES = definePurposes(MEDIA_CATALOG, [
  { id: "rasm.image", kind: "image", allowed: ["google/nano-banana", "openai/gpt-image"], default: "google/nano-banana", userCanChoose: true },
  { id: "proslide.illustration", kind: "image", allowed: ["google/nano-banana"], default: "google/nano-banana", userCanChoose: false },
  { id: "portrait.edit", kind: "image", allowed: ["google/nano-banana"], default: "google/nano-banana", userCanChoose: false },
  { id: "video.clip", kind: "video", allowed: ["google/omni-video", "kling/video"], default: "google/omni-video", userCanChoose: true },
  // Speech order is the admin `tts.order` slot (azure → aisha → gemini by default); ElevenLabs is the opt-in premium voice.
  { id: "podcast.voice", kind: "speech", allowed: [...SPEECH_CHAIN, "elevenlabs/tts"], default: "azure/tts", userCanChoose: false },
  { id: "greeting.voice", kind: "speech", allowed: [...SPEECH_CHAIN, "elevenlabs/tts"], default: "azure/tts", userCanChoose: false },
  { id: "domla.voice", kind: "speech", allowed: ["google/tts"], default: "google/tts", userCanChoose: false },
  // The operator may put ElevenLabs into `tts.order`; the listening chain then speaks through it (N3: allowed, not chosen).
  { id: "listening.voice", kind: "speech", allowed: [...SPEECH_CHAIN, "elevenlabs/tts"], default: "azure/tts", userCanChoose: false },
  // Studio «Rasm» tab (docs/studio/P1-SPEC.md): the user picks the model; priced cost × markup (lib/media/studio-pricing.ts).
  // P2a: + the fal models, Nano Banana stays the default.
  { id: STUDIO_IMAGE_PURPOSE, kind: "image", allowed: ["google/nano-banana", "openai/gpt-image", ...FAL_IMAGE_MODELS], default: "google/nano-banana", userCanChoose: true },
  STUDIO_VIDEO_PURPOSE_SPEC,
]);
