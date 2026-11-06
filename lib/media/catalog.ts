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
import { PHOTO_MAX_BYTES } from "../photo-accept";
import { STUDIO_VIDEO_ENTRIES, STUDIO_VIDEO_PURPOSE_SPEC } from "./catalog-video";
import { STUDIO_CLONE_PURPOSE_SPEC, STUDIO_SPEECH_ENTRIES, STUDIO_SPEECH_PURPOSE_SPEC } from "./catalog-speech";
import { STUDIO_AUDIO_ENTRIES, STUDIO_AUDIO_PURPOSE_SPECS } from "./catalog-audio";
import { STUDIO_TRANSCRIBE_ENTRIES, STUDIO_TRANSCRIBE_PURPOSE_SPECS } from "./catalog-transcribe";

/** Same as `IMAGE_PROMPT_MIN` in `lib/tools.ts` (not imported: tools.ts will read this file; a test keeps them equal). */
export const MEDIA_IMAGE_PROMPT_MIN = 3;

/** Gemini lite image model, the default of the `image.gemini` slot. */
const GEMINI_IMAGE_DEFAULT = "gemini-3.1-flash-lite-image";
const OPENAI_IMAGE_DEFAULT = "gpt-image-2.5-flare";

/** USD per second of video. Omni: $17.50 / 1M output tokens × 5 792 tokens/s (video/registry.ts). Kling: 4.0 Flash 720p (Kling's price table). */
export const VIDEO_USD_PER_SECOND: Readonly<Record<VideoProviderId, number>> = { veo: 0.1, kling: 0.094 };

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
    { name: "imageAssetId", label: "Boshlang'ich surat", type: "image", max: 1, mimes: id === "kling" ? ["image/jpeg", "image/png"] : ["image/jpeg", "image/png", "image/webp"], maxBytes: 10 * 1024 * 1024, affects: "request" },
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

/* ═════════════════════ Studio P2b: edit + utility models (docs/studio/P2B-SPEC.md) ═════════════════════
 * One block on purpose (P3 appends video entries in `catalog-video.ts`; keep merges trivial). Each entry takes the
 * user's pictures as the `inputImages` param: asset ids of `photo_uploads` rows the user OWNS (an upload, or one of
 * their own Studio results copied in by `POST /api/media/inputs/from-result`) — checked in SQL before any charge
 * (`lib/server/media/inputs.ts`), resolved to bytes by the worker. Prices: provider cost × markup like every Studio
 * model (`studio-pricing.ts`); the cost rows live in the price book (`IMAGE_PRICES`, sources there).
 */

/** Largest input picture (bytes): the photo upload limit (`lib/photo-accept.ts`) — fal receives inputs inline as data URIs (P2B-SPEC «gaps»). */
export const STUDIO_INPUT_MAX_BYTES = PHOTO_MAX_BYTES;
export const STUDIO_INPUT_MIMES = ["image/png", "image/jpeg"] as const;
/** The one param name every edit / utility model reads its pictures from (the adapters' `assets` key). */
export const INPUT_IMAGES_PARAM = "inputImages";
/** Upscale: the longest input side per factor, so the output stays ≤ 4096 px (≤ 16.8 MP — the priced upper bound). */
export const UPSCALE_MAX_INPUT_SIDE: Readonly<Record<string, number>> = { "2": 2048, "4": 1024 };

const inputImagesParam = (max: number): ParamSchema => ({
  name: INPUT_IMAGES_PARAM,
  label: max > 1 ? "Rasmlar" : "Rasm",
  hint: max > 1 ? `PNG yoki JPEG, ${max} tagacha` : "PNG yoki JPEG",
  type: "image",
  min: 1,
  max,
  mimes: STUDIO_INPUT_MIMES,
  maxBytes: STUDIO_INPUT_MAX_BYTES,
  affects: "request",
});

const editParams = (maxImages: number): readonly ParamSchema[] => [
  { name: "prompt", label: "Nimani o'zgartiramiz?", type: "text", min: MEDIA_IMAGE_PROMPT_MIN, max: IMAGE_PROMPT_LIMIT, affects: "request" },
  inputImagesParam(maxImages),
  { name: "imageCount", label: "Soni", type: "int", min: 1, max: 4, default: 1, affects: "price" },
];

function bookPrice(key: string): number {
  const usd = IMAGE_PRICES[key];
  if (!(typeof usd === "number" && usd > 0)) throw new Error(`media catalog: no price for ${key}`);
  return usd;
}

/** The P2b entries (edit: Nano Banana + Seedream 5 Lite; upscale: SeedVR; background removal: Bria). */
function studioToolEntries(): CatalogEntry[] {
  return [
    {
      id: "google/nano-banana-edit",
      kind: "image",
      capabilities: ["edit"],
      label: "Nano Banana",
      maker: "Google",
      badges: ["tez", "arzon"],
      params: editParams(3),
      cost: { per: "output", usd: IMAGE_PRICES[GEMINI_IMAGE_DEFAULT], countParam: "imageCount" },
      // The same Gemini route as Nano Banana (the admin `image.gemini` slot picks the upstream; the input pictures travel
      // as `inputImages`, as the graduation portrait sends its selfie).
      routes: [{ provider: "gemini", upstreamModel: GEMINI_IMAGE_DEFAULT, adapter: "google-image" }],
      limits: { timeoutMs: 120_000 },
      output: IMAGE_OUT,
    },
    {
      id: "bytedance/seedream-edit",
      kind: "image",
      capabilities: ["edit"],
      label: "Seedream 5 Lite",
      maker: "ByteDance",
      badges: ["sifatli"],
      params: editParams(3),
      cost: { per: "output", usd: bookPrice("bytedance/seedream/v5/lite/edit"), countParam: "imageCount" },
      routes: [{ provider: "fal", upstreamModel: "bytedance/seedream/v5/lite/edit", adapter: "fal" }],
      limits: { timeoutMs: 120_000 },
      output: IMAGE_OUT,
    },
    {
      id: "bytedance/seedvr-upscale",
      kind: "image",
      capabilities: ["upscale"],
      label: "SeedVR Upscale",
      maker: "ByteDance",
      badges: ["arzon"],
      params: [
        inputImagesParam(1),
        {
          name: "factor",
          label: "Kattalashtirish",
          hint: "×2 — 2048 px gacha rasm, ×4 — 1024 px gacha",
          type: "enum",
          options: [
            { value: "2", label: "×2" },
            { value: "4", label: "×4" },
          ],
          default: "2",
          affects: "request",
        },
      ],
      cost: { per: "job", usd: bookPrice("fal-ai/seedvr/upscale/image") },
      routes: [{ provider: "fal", upstreamModel: "fal-ai/seedvr/upscale/image", adapter: "fal" }],
      limits: { timeoutMs: 120_000 },
      output: IMAGE_OUT,
    },
    {
      id: "bria/background-remove",
      kind: "image",
      capabilities: ["bg-remove"],
      label: "Bria RMBG",
      maker: "Bria",
      badges: ["tez", "arzon"],
      params: [inputImagesParam(1)],
      cost: { per: "job", usd: bookPrice("fal-ai/bria/background/remove") },
      routes: [{ provider: "fal", upstreamModel: "fal-ai/bria/background/remove", adapter: "fal" }],
      limits: { timeoutMs: 60_000 },
      // A cut-out must keep its transparency: PNG only (the adapter also checks the alpha channel).
      output: { mimes: ["image/png"], maxBytes: PPTX_SIZE_LIMIT },
    },
  ];
}
/* ═════════════════════ end of the P2b block ═════════════════════ */

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
    routes: [{ provider: "kling", upstreamModel: "kling-4.0-flash", adapter: "kling-video" }],
    limits: { timeoutMs: 60_000, deadlineMs: 20 * 60_000 },
    output: { mimes: ["video/mp4"], maxBytes: VIDEO_MAX_BYTES },
  },
  ...STUDIO_VIDEO_ENTRIES,
  // ───── Studio P2b: edit + utility models (docs/studio/P2B-SPEC.md) — kept as one block, see `STUDIO_TOOL_ENTRIES`.
  ...studioToolEntries(),
  speech("google/tts", "Gemini TTS", "Google", "gemini", "gemini-speech", 0.015),
  speech("elevenlabs/tts", "ElevenLabs", "ElevenLabs", "elevenlabs", "elevenlabs-speech", charsUsd("elevenlabs")),
  speech("azure/tts", "Azure Speech", "Microsoft", "azure", "azure-speech", charsUsd("azure")),
  speech("aisha/tts", "Aisha", "Aisha", "aisha", "aisha-speech", 0.078),
  // Studio P5 «Ovoz» tab (docs/studio/P5-SPEC.md, `catalog-speech.ts`).
  ...STUDIO_SPEECH_ENTRIES,
  // Studio P6 «Audio» tab (docs/studio/P6-SPEC.md, `catalog-audio.ts`).
  ...STUDIO_AUDIO_ENTRIES,
  // Studio P10 «Transkripsiya» / «Dublyaj» (docs/studio/P10-SPEC.md, `catalog-transcribe.ts`).
  ...STUDIO_TRANSCRIBE_ENTRIES,
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
export const FAL_IMAGE_MODELS: readonly string[] = MEDIA_ENTRIES.filter((e) => e.kind === "image" && e.capabilities.includes("t2i") && e.routes.some((r) => r.provider === "fal")).map((e) => e.id);

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
/** P2b purposes (docs/studio/P2B-SPEC.md): edit with a prompt, upscale, background removal. */
export const STUDIO_EDIT_PURPOSE = "studio.edit";
export const STUDIO_UPSCALE_PURPOSE = "studio.upscale";
export const STUDIO_BGREMOVE_PURPOSE = "studio.bgremove";

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
  // P5 (docs/studio/P5-SPEC.md): the «Ovoz» tab and voice cloning.
  STUDIO_SPEECH_PURPOSE_SPEC,
  STUDIO_CLONE_PURPOSE_SPEC,
  // P6 (docs/studio/P6-SPEC.md): the «Audio» tab — music, sound effects, voice changer, isolator (one model each).
  ...STUDIO_AUDIO_PURPOSE_SPECS,
  // P10 (docs/studio/P10-SPEC.md): speech to text and dubbing (one model each).
  ...STUDIO_TRANSCRIBE_PURPOSE_SPECS,
  // P2b (docs/studio/P2B-SPEC.md): the Studio's edit and utility jobs — same tool, same charge / refund / gallery.
  { id: STUDIO_EDIT_PURPOSE, kind: "image", allowed: ["google/nano-banana-edit", "bytedance/seedream-edit"], default: "google/nano-banana-edit", userCanChoose: true },
  { id: STUDIO_UPSCALE_PURPOSE, kind: "image", allowed: ["bytedance/seedvr-upscale"], default: "bytedance/seedvr-upscale", userCanChoose: false },
  { id: STUDIO_BGREMOVE_PURPOSE, kind: "image", allowed: ["bria/background-remove"], default: "bria/background-remove", userCanChoose: false },
]);

/** Every purpose the Studio «Rasm» tab sells through tool `studio-image` (one model belongs to exactly one). */
export const STUDIO_PURPOSES: readonly string[] = [STUDIO_IMAGE_PURPOSE, STUDIO_EDIT_PURPOSE, STUDIO_UPSCALE_PURPOSE, STUDIO_BGREMOVE_PURPOSE];

/** The Studio purpose that sells `modelId`, or `null` when the Studio does not sell it. */
export function studioPurposeOf(modelId: string): string | null {
  return STUDIO_PURPOSES.find((p) => MEDIA_PURPOSES.byId(p)!.allowed.includes(modelId)) ?? null;
}
