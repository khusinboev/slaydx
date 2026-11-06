/**
 * Studio «Video» tab models (docs/studio/P3-SPEC.md) — Kling 3.0 (two tiers) and Kling effect templates, plus the
 * `studio.video` purpose. `catalog.ts` spreads these into `MEDIA_ENTRIES` / `MEDIA_PURPOSES`; Gemini Omni is the
 * existing `google/omni-video` entry (one model, two sellers: the «Video» tool's ladder, the Studio's cost × markup).
 *
 * Client-safe (no server imports, and NOT importing `catalog.ts`: that file imports this one).
 *
 * PROVIDER COSTS (USD), Kling's own price table (https://kling.ai/document-api/pricing/base/video.md, read 2026-11-06):
 *   Kling 4.0        per second without an input video: 720p $0.157 (1.0 unit), 1080p $0.235 (1.5 units).
 *   Kling 4.0 Flash  per second without an input video: 720p $0.094 (0.6 units).
 *   Kling 3.0        per second, by resolution × sound: 720p $0.084 / s silent, $0.126 / s with sound; 1080p $0.112 / $0.168.
 *                    4K ($0.42 / s) is not sold: a 4K clip does not fit the 25 MB result cap.
 *
 * The account's resource pack (2026-11-06) is «available only for Kling 4.0 and Kling 4.0 Flash»: Kling 3.0 and the effects
 * answer 1102, so they are `defaultOff` until a pack covers them and the admin switches them on.
 *
 *   effects    per clip: $0.84 — WaveSpeed's Kling Effects page («most effects start at $0.84»,
 *              https://wavespeed.ai/docs/docs-api/kwaivgi/kwaivgi-kling-effects) and docs/studio/PLAN.md §3
 *              («effects ~$0.84 each»). fal's v1.6 effects endpoint bills $0.056 / s (= $0.28 per 5 s) for the same
 *              scenes; the higher figure is used so a direct Kling bill can never exceed the quote.
 *
 * EFFECT SCENES: Kling documents 219 effect scenes but its list page is not readable; the nine below are single-image
 * scenes that appear by these exact ids in BOTH pass-through lists — fal `fal-ai/kling-video/v1.6/standard/effects`
 * (https://fal.ai/models/fal-ai/kling-video/v1.6/standard/effects/llms.txt) and WaveSpeed `kwaivgi/kling-effects`
 * (URL above). «Xotira tiriladi», «Trampolin» and «Kiyim» have no scene with a documented id and are not sold.
 *
 * STUDIO P4 (docs/studio/P4-SPEC.md): «Quchoqlash» is the direct API's documented TWO-photo scene `hug_pro`
 * (`KLING_DUAL_EFFECTS`, api/effects/video-effects.md, read 2026-11-06); Kling 3.0 takes an end frame
 * (`endImageAssetId` → the `last_frame` item); five more models through fal (`FAL_VIDEO_ENTRIES`, block below).
 */
import { normalizeText, type CatalogEntry, type ParamSchema, type PurposeSpec } from "../studio-core";
import { VIDEO_PROMPT_MAX, VIDEO_PROMPT_MIN } from "../generation/video/registry";
import { VIDEO_MAX_BYTES } from "../generation/video/types";
import { PHOTO_MAX_BYTES } from "../photo-accept";
import { KLING_EFFECT_SECONDS, KLING_V3_ASPECTS, KLING_V3_MODEL, KLING_V3_SECONDS, KLING_V4_ASPECTS, KLING_V4_FLASH_MODEL, KLING_V4_MODEL, KLING_V4_SECONDS } from "../generation/video/kling-options";

/** Purpose of the Studio «Video» tab (tool `studio-video`). */
export const STUDIO_VIDEO_PURPOSE = "studio.video";

/** Kling 3.0 USD per second: [silent, with sound], by tier. */
export const KLING_V3_USD_PER_SECOND = {
  std: { silent: 0.084, sound: 0.126 },
  pro: { silent: 0.112, sound: 0.168 },
} as const;

export const KLING_V4_USD_PER_SECOND = { "720p": 0.157, "1080p": 0.235 } as const;
export const KLING_V4_FLASH_USD_PER_SECOND = 0.094;

/** USD of one effect clip. */
export const KLING_EFFECT_USD = 0.84;

/** The effect scenes the Studio sells: Kling `effect_scene` id → Uzbek label (grid order). */
export const KLING_EFFECTS: readonly { id: string; label: string }[] = [
  { id: "happy_birthday", label: "Tug‘ilgan kun" },
  { id: "surprise_bouquet", label: "Gul guldasta" },
  { id: "glamour_photo_shoot", label: "Fotosessiya" },
  { id: "box_of_joy", label: "Bayram" },
  { id: "zombie_transform", label: "Zombi" },
  { id: "pure_white_wings", label: "Oq qanotlar" },
  { id: "bullet_time_360", label: "360° kadr" },
  { id: "throne_of_king", label: "Shoh taxti" },
  { id: "snowglobe", label: "Qorli shar" },
];

const START_IMAGE: Extract<ParamSchema, { type: "image" }> = {
  name: "imageAssetId",
  label: "Boshlang'ich surat",
  type: "image",
  max: 1,
  // What the photo upload accepts and enforces (`POST /api/uploads/photo`): the schema states the real limit.
  mimes: ["image/jpeg", "image/png"],
  maxBytes: PHOTO_MAX_BYTES,
  affects: "request",
};

/** Studio P4: the last frame of an image → video clip (only together with the start image; same price). */
export const END_IMAGE_PARAM = "endImageAssetId";
const END_IMAGE: ParamSchema = { ...START_IMAGE, name: END_IMAGE_PARAM, label: "Oxirgi kadr" };

/** Studio P4: the second photo of a two-photo effect («Quchoqlash»). */
export const SECOND_IMAGE_PARAM = "secondImageAssetId";

/**
 * Two-photo effect scenes (Studio P4): `hug_pro` is one of the 15 dual-image scenes of the direct API, `images` exactly
 * two (api/effects/video-effects.md, read 2026-11-06). Only «Quchoqlash» is sold (the owner's canvas); priced as every
 * effect (UNVERIFIED, see P4-SPEC).
 */
export const KLING_DUAL_EFFECTS: readonly { id: string; label: string }[] = [{ id: "hug_pro", label: "Quchoqlash" }];

/** Every effect scene the Studio sells, grid order: the single-photo ones, then the two-photo ones. */
export const KLING_EFFECT_SCENES: readonly { id: string; label: string }[] = [...KLING_EFFECTS, ...KLING_DUAL_EFFECTS];

/** The direct Kling effects entry (hidden until a pack covers it): the only one with two-photo scenes. */
export const KLING_EFFECTS_MODEL = "kling/effects";

/**
 * Photos an effect scene needs on a model: 2 for a dual-character scene of the direct Kling API. fal's Kling endpoint takes
 * the same `hug_pro` id with exactly one image (see `FAL_EFFECT_ENTRIES`), so the model decides, not the scene id alone.
 */
export function effectPhotos(effect: unknown, modelId: string = KLING_EFFECTS_MODEL): 1 | 2 {
  return modelId === KLING_EFFECTS_MODEL && KLING_DUAL_EFFECTS.some((e) => e.id === effect) ? 2 : 1;
}

function klingV3Params(): readonly ParamSchema[] {
  return [
    { name: "prompt", label: "Video tavsifi", type: "text", min: VIDEO_PROMPT_MIN, max: VIDEO_PROMPT_MAX, affects: "request" },
    { name: "seconds", label: "Davomiylik", hint: "Soniya", type: "int", min: KLING_V3_SECONDS.min, max: KLING_V3_SECONDS.max, step: 1, default: 5, affects: "both" },
    {
      name: "aspect",
      label: "O'lcham",
      hint: "Surat bilan boshlanganda nisbat suratdan olinadi",
      type: "enum",
      options: KLING_V3_ASPECTS.map((a) => ({ value: a, label: a })),
      default: KLING_V3_ASPECTS[0],
      affects: "request",
    },
    { name: "sound", label: "Ovoz", hint: "Video bilan birga ovoz yaratiladi (qimmatroq)", type: "bool", default: false, affects: "both" },
    START_IMAGE,
    END_IMAGE,
  ];
}

const VIDEO_OUT = { mimes: ["video/mp4"], maxBytes: VIDEO_MAX_BYTES } as const;
const VIDEO_LIMITS = { timeoutMs: 60_000, deadlineMs: 20 * 60_000 } as const;

function klingV3(id: string, label: string, badges: CatalogEntry["badges"], tier: keyof typeof KLING_V3_USD_PER_SECOND): CatalogEntry {
  const usd = KLING_V3_USD_PER_SECOND[tier];
  return {
    id,
    kind: "video",
    capabilities: ["t2v", "i2v"],
    label,
    maker: "Kuaishou",
    badges,
    params: klingV3Params(),
    cost: { per: "second", usd: usd.silent, secondsParam: "seconds", by: { param: "sound", table: { false: usd.silent, true: usd.sound } } },
    // One adapter per tier: the mode (`std` / `pro`) is part of the route, the upstream is the model name.
    routes: [{ provider: "kling", upstreamModel: KLING_V3_MODEL, adapter: `kling-v3-${tier}` }],
    defaultOff: true,
    limits: VIDEO_LIMITS,
    output: VIDEO_OUT,
  };
}

function klingV4Base(): readonly ParamSchema[] {
  return [
    { name: "prompt", label: "Video tavsifi", type: "text", min: VIDEO_PROMPT_MIN, max: VIDEO_PROMPT_MAX, affects: "request" },
    { name: "seconds", label: "Davomiylik", hint: "Soniya", type: "int", min: KLING_V4_SECONDS.min, max: KLING_V4_SECONDS.max, step: 1, default: 5, affects: "both" },
    {
      name: "aspect",
      label: "O'lcham",
      hint: "Surat bilan boshlanganda nisbat suratdan olinadi",
      type: "enum",
      options: KLING_V4_ASPECTS.map((a) => ({ value: a, label: a })),
      default: KLING_V4_ASPECTS[0],
      affects: "request",
    },
  ];
}

const KLING_V4_ENTRIES: readonly CatalogEntry[] = [
  {
    id: "kling/kling-4",
    kind: "video",
    capabilities: ["t2v", "i2v"],
    label: "Kling 4.0",
    maker: "Kuaishou",
    badges: ["sifatli"],
    params: [
      ...klingV4Base(),
      {
        name: "resolution",
        label: "Sifat",
        hint: "Yuqori sifat qimmatroq",
        type: "enum",
        options: [
          { value: "720p", label: "720p (HD)" },
          { value: "1080p", label: "1080p (Full HD)" },
        ],
        default: "720p",
        affects: "both",
      },
      START_IMAGE,
      END_IMAGE,
    ],
    cost: { per: "second", usd: KLING_V4_USD_PER_SECOND["720p"], secondsParam: "seconds", by: { param: "resolution", table: KLING_V4_USD_PER_SECOND } },
    routes: [{ provider: "kling", upstreamModel: KLING_V4_MODEL, adapter: "kling-v4" }],
    limits: VIDEO_LIMITS,
    output: VIDEO_OUT,
  },
  {
    id: "kling/kling-4-flash",
    kind: "video",
    capabilities: ["t2v", "i2v"],
    label: "Kling 4.0 Flash",
    maker: "Kuaishou",
    badges: ["arzon"],
    params: [...klingV4Base(), START_IMAGE],
    cost: { per: "second", usd: KLING_V4_FLASH_USD_PER_SECOND, secondsParam: "seconds" },
    routes: [{ provider: "kling", upstreamModel: KLING_V4_FLASH_MODEL, adapter: "kling-v4" }],
    limits: VIDEO_LIMITS,
    output: VIDEO_OUT,
  },
];

const KLING_V3_ENTRIES: readonly CatalogEntry[] = [
  klingV3("kling/kling-3", "Kling 3.0", ["arzon"], "std"),
  klingV3("kling/kling-3-pro", "Kling 3.0 Pro", ["sifatli"], "pro"),
];

const KLING_EFFECTS_ENTRY: CatalogEntry = {
  id: KLING_EFFECTS_MODEL,
  kind: "video",
  capabilities: ["effect"],
  label: "Kling effektlar",
  maker: "Kuaishou",
  badges: [],
  params: [
    { name: "effect", label: "Effekt", type: "enum", options: KLING_EFFECT_SCENES.map((e) => ({ value: e.id, label: e.label })), default: KLING_EFFECTS[0]!.id, affects: "request" },
    { ...START_IMAGE, label: "Surat" },
    // Sent only for a two-photo scene (`effectPhotos`); a single-photo scene never reads it.
    { ...START_IMAGE, name: SECOND_IMAGE_PARAM, label: "Ikkinchi surat" },
  ],
  cost: { per: "job", usd: KLING_EFFECT_USD },
  routes: [{ provider: "kling", upstreamModel: "effects", adapter: "kling-effects" }],
  defaultOff: true,
  limits: VIDEO_LIMITS,
  output: VIDEO_OUT,
};

/* ═════════════════ Studio P4: video models through fal (docs/studio/P4-SPEC.md) ═════════════════
 * USD per second of output by resolution tier, each from the endpoint's own page (read 2026-11-02; the text- and
 * image-to-video endpoints of a model state the same numbers):
 *   Wan 3.0            https://fal.ai/models/alibaba/wan-3.0/text-to-video/llms.txt        480p 0.05 · 720p 0.10 · 1080p 0.20
 *   Seedance 2.5       https://fal.ai/models/bytedance/seedance-2.5/us/text-to-video/llms.txt  «roughly» 480p 0.2205 · 720p 0.473
 *                      (1080p $1.164 / s not sold: price and the 25 MB result cap)
 *   Seedance 2.0 Mini  https://fal.ai/models/bytedance/seedance-2.0/mini/text-to-video/llms.txt «roughly» 480p 0.0721 · 720p 0.1547
 *   MiniMax H3         https://fal.ai/models/minimax/h3/text-to-video/llms.txt             480p 0.05 · 768p 0.06 (2K / 4K are
 *                      upscales of 768p, not sold)
 *   MiniMax H3 Max Turbo https://fal.ai/models/minimax/h3-max-turbo/text-to-video/llms.txt standard rates from 2026-11-16
 *                      480p 0.025 · 768p 0.04 · 1080p 0.08 (fal's November promotion is 30 % lower; the quote is the
 *                      standard rate, so the price does not jump on the 16th)
 * Seedance bills tokens = width × height × seconds × 24 / 1024 at a flat token price; the per-second figures are fal's own
 * for its tier sizes (UNVERIFIED for 1:1 / 9:16 — the tier keeps the pixel count in ByteDance's size tables).
 * Length: 10 s at most for every fal model (each takes up to 15–30 s): a longer 1080p clip risks the 25 MB result cap,
 * and fal bills a clip we then cannot store.
 */
export const FAL_VIDEO_USD_PER_SECOND = {
  "alibaba/wan-3": { "480p": 0.05, "720p": 0.1, "1080p": 0.2 },
  "bytedance/seedance-2.5": { "480p": 0.2205, "720p": 0.473 },
  "bytedance/seedance-2-mini": { "480p": 0.0721, "720p": 0.1547 },
  "minimax/h3": { "480p": 0.05, "768p": 0.06 },
  "minimax/h3-max-turbo": { "480p": 0.025, "768p": 0.04, "1080p": 0.08 },
} as const satisfies Record<string, Record<string, number>>;

/** Longest clip sold through fal (see above). */
export const FAL_VIDEO_MAX_SECONDS = 10;
/** Aspect ratios every fal video model accepts in text → video (image → video follows the picture). */
export const FAL_VIDEO_ASPECTS = ["16:9", "9:16", "1:1"] as const;

type FalVideoSpec = {
  id: keyof typeof FAL_VIDEO_USD_PER_SECOND;
  label: string;
  maker: string;
  badges: CatalogEntry["badges"];
  /** The fal model family (`FAL_VIDEO_MODELS` key in `adapters/fal.ts`). */
  upstream: string;
  minSeconds: number;
  defaultResolution: string;
  /** The model makes sound (`audio` / `generate_audio`, same price): a switch, on by default as at fal. */
  sound: boolean;
};

const RESOLUTION_LABEL: Readonly<Record<string, string>> = { "480p": "480p", "720p": "720p (HD)", "768p": "768p", "1080p": "1080p (Full HD)" };

function falVideo(s: FalVideoSpec): CatalogEntry {
  const table = FAL_VIDEO_USD_PER_SECOND[s.id] as Readonly<Record<string, number>>;
  const tiers = Object.keys(table);
  const params: ParamSchema[] = [
    { name: "prompt", label: "Video tavsifi", type: "text", min: VIDEO_PROMPT_MIN, max: VIDEO_PROMPT_MAX, affects: "request" },
    { name: "seconds", label: "Davomiylik", hint: "Soniya", type: "int", min: s.minSeconds, max: FAL_VIDEO_MAX_SECONDS, step: 1, default: 5, affects: "both" },
    {
      name: "resolution",
      label: "Sifat",
      hint: "Yuqori sifat qimmatroq",
      type: "enum",
      options: tiers.map((t) => ({ value: t, label: RESOLUTION_LABEL[t] ?? t })),
      default: s.defaultResolution,
      affects: "both",
    },
    {
      name: "aspect",
      label: "O'lcham",
      hint: "Surat bilan boshlanganda nisbat suratdan olinadi",
      type: "enum",
      options: FAL_VIDEO_ASPECTS.map((a) => ({ value: a, label: a })),
      default: FAL_VIDEO_ASPECTS[0],
      affects: "request",
    },
    ...(s.sound ? [{ name: "sound", label: "Ovoz", hint: "Video bilan birga ovoz yaratiladi (narx o‘zgarmaydi)", type: "bool", default: true, affects: "request" } as const] : []),
    START_IMAGE,
    END_IMAGE,
  ];
  return {
    id: s.id,
    kind: "video",
    capabilities: ["t2v", "i2v"],
    label: s.label,
    maker: s.maker,
    badges: s.badges,
    params,
    cost: { per: "second", usd: table[s.defaultResolution]!, secondsParam: "seconds", by: { param: "resolution", table } },
    routes: [{ provider: "fal", upstreamModel: s.upstream, adapter: "fal-video" }],
    limits: VIDEO_LIMITS,
    output: VIDEO_OUT,
  };
}

/** The fal video models, picker order (after Kling 3.0). */
export const FAL_VIDEO_ENTRIES: readonly CatalogEntry[] = [
  falVideo({ id: "alibaba/wan-3", label: "Wan 3.0", maker: "Alibaba", badges: ["ovozli"], upstream: "alibaba/wan-3.0", minSeconds: 2, defaultResolution: "720p", sound: true }),
  falVideo({ id: "bytedance/seedance-2.5", label: "Seedance 2.5", maker: "ByteDance", badges: ["sifatli", "ovozli"], upstream: "bytedance/seedance-2.5/us", minSeconds: 4, defaultResolution: "720p", sound: true }),
  falVideo({ id: "bytedance/seedance-2-mini", label: "Seedance 2.0 Mini", maker: "ByteDance", badges: ["ovozli"], upstream: "bytedance/seedance-2.0/mini", minSeconds: 4, defaultResolution: "720p", sound: true }),
  falVideo({ id: "minimax/h3", label: "MiniMax H3", maker: "MiniMax", badges: ["arzon"], upstream: "minimax/h3", minSeconds: 5, defaultResolution: "768p", sound: false }),
  falVideo({ id: "minimax/h3-max-turbo", label: "MiniMax H3 Max Turbo", maker: "MiniMax", badges: ["arzon"], upstream: "minimax/h3-max-turbo", minSeconds: 2, defaultResolution: "768p", sound: false }),
];

/* ═════════════════ Studio P11 package F: more video through fal ═════════════════
 * USD per second of output, each from the endpoint's own page (read 2026-11-06). Text and image endpoints state the same rates.
 *   Grok Imagine Lite  https://fal.ai/models/xai/grok-imagine-video/v1.5/lite/text-to-video/llms.txt and …/image-to-video/llms.txt
 *                      720p $0.03 / s; the image endpoint bills «$0.01» per input image on top (`plus`). 480p ($0.02) and
 *                      1080p ($0.14) are not sold: the owner's list names 720p.
 *   PixVerse V6        https://fal.ai/models/fal-ai/pixverse/v6/text-to-video/llms.txt and …/image-to-video/llms.txt
 *                      720p $0.045 / s without audio, $0.06 with. The prompt limit counts UTF-8 BYTES (2048): `maxBytes`.
 *   Happy Horse 1.1    https://fal.ai/models/alibaba/happy-horse/v1.1/text-to-video/llms.txt and …/image-to-video/llms.txt
 *                      720p $0.14 / s, 1080p $0.18 / s. Sound is native, no switch. 3–15 s, prompt ≤ 2500 characters.
 * Billing rounds are not stated. Grok's example clip of 6 s measures 6.04 s, so a clip may bill a fraction more than quoted:
 * the quote stays per requested second, the markup covers it (UNVERIFIED until the first bills are compared).
 * Grok's prompt limit is not stated (UNVERIFIED): `VIDEO_PROMPT_MAX` holds. None of these models takes an end frame.
 */
export const GROK_LITE_USD_PER_SECOND = 0.03;
export const GROK_LITE_USD_PER_IMAGE = 0.01;
export const PIXVERSE_V6_USD_PER_SECOND = { false: 0.045, true: 0.06 } as const;
export const HAPPY_HORSE_USD_PER_SECOND = { "720p": 0.14, "1080p": 0.18 } as const;
/** PixVerse's stated prompt limit, in UTF-8 bytes. */
export const PIXVERSE_PROMPT_MAX_BYTES = 2048;

const SECONDS_ROW = (min: number): ParamSchema => ({ name: "seconds", label: "Davomiylik", hint: "Soniya", type: "int", min, max: FAL_VIDEO_MAX_SECONDS, step: 1, default: 5, affects: "both" });
const FAL_ASPECT_ROW: ParamSchema = {
  name: "aspect",
  label: "O'lcham",
  hint: "Surat bilan boshlanganda nisbat suratdan olinadi",
  type: "enum",
  options: FAL_VIDEO_ASPECTS.map((a) => ({ value: a, label: a })),
  default: FAL_VIDEO_ASPECTS[0],
  affects: "request",
};
const VIDEO_PROMPT: Extract<ParamSchema, { type: "text" }> = { name: "prompt", label: "Video tavsifi", type: "text", min: VIDEO_PROMPT_MIN, max: VIDEO_PROMPT_MAX, affects: "request" };

function falVideoP11(id: string, label: string, maker: string, badges: CatalogEntry["badges"], upstream: string, params: readonly ParamSchema[], cost: CatalogEntry["cost"]): CatalogEntry {
  return {
    id,
    kind: "video",
    capabilities: ["t2v", "i2v"],
    label,
    maker,
    badges,
    params: [...params, START_IMAGE],
    cost,
    routes: [{ provider: "fal", upstreamModel: upstream, adapter: "fal-video" }],
    defaultOff: true,
    limits: VIDEO_LIMITS,
    output: VIDEO_OUT,
  };
}

/** Package F's text / image → video models, picker order (after the P4 fal models and Sora). */
export const FAL_VIDEO_P11_ENTRIES: readonly CatalogEntry[] = [
  falVideoP11("xai/grok-imagine-lite", "Grok Imagine Lite", "xAI", ["arzon", "yangi"], "xai/grok-imagine-video/v1.5/lite", [VIDEO_PROMPT, SECONDS_ROW(1), FAL_ASPECT_ROW], {
    per: "second",
    usd: GROK_LITE_USD_PER_SECOND,
    secondsParam: "seconds",
    plus: { param: "imageAssetId", usd: GROK_LITE_USD_PER_IMAGE },
  }),
  falVideoP11(
    "pixverse/v6",
    "PixVerse V6",
    "PixVerse",
    ["arzon", "yangi"],
    "fal-ai/pixverse/v6",
    [
      { ...VIDEO_PROMPT, maxBytes: PIXVERSE_PROMPT_MAX_BYTES },
      SECONDS_ROW(1),
      FAL_ASPECT_ROW,
      { name: "sound", label: "Ovoz", hint: "Video bilan birga ovoz yaratiladi (qimmatroq)", type: "bool", default: false, affects: "both" },
    ],
    { per: "second", usd: PIXVERSE_V6_USD_PER_SECOND.false, secondsParam: "seconds", by: { param: "sound", table: PIXVERSE_V6_USD_PER_SECOND } },
  ),
  falVideoP11(
    "alibaba/happy-horse",
    "Happy Horse 1.1",
    "Alibaba",
    ["sifatli", "ovozli", "yangi"],
    "alibaba/happy-horse/v1.1",
    [
      VIDEO_PROMPT,
      SECONDS_ROW(3),
      {
        name: "resolution",
        label: "Sifat",
        hint: "Yuqori sifat qimmatroq",
        type: "enum",
        options: Object.keys(HAPPY_HORSE_USD_PER_SECOND).map((t) => ({ value: t, label: RESOLUTION_LABEL[t] ?? t })),
        default: "720p",
        affects: "both",
      },
      FAL_ASPECT_ROW,
    ],
    { per: "second", usd: HAPPY_HORSE_USD_PER_SECOND["720p"], secondsParam: "seconds", by: { param: "resolution", table: HAPPY_HORSE_USD_PER_SECOND } },
  ),
];

/* ═════════════════ Studio P11 package F: effects through fal ═════════════════
 * A fixed 5 s clip from one photo, sold per clip as the direct Kling effects are. Both pages read 2026-11-06:
 *   PixVerse   https://fal.ai/models/fal-ai/pixverse/v5.5/effects/llms.txt  «a 5s video in single-clip mode without audio …
 *              $0.20 for 720p». The page bills audio +$0.05 but its schema has no audio switch, so nothing we send turns it
 *              on (UNVERIFIED that no effect carries sound on its own: compare the first bills).
 *   Kling 1.6  https://fal.ai/models/fal-ai/kling-video/v1.6/standard/effects/llms.txt  «$0.056 per seconds», `duration` "5":
 *              $0.28 a clip. «heart_gesture requires exactly two images; all other effects require exactly one image», so
 *              here `hug_pro` takes ONE photo (of two people), unlike the direct API.
 */
export const FAL_EFFECT_USD = { pixverse: 0.2, kling: 0.28 } as const;
export const PIXVERSE_EFFECTS_MODEL = "pixverse/effects";
export const KLING_FAL_EFFECTS_MODEL = "kling/effects-v16";
export const PIXVERSE_EFFECTS_ENDPOINT = "fal-ai/pixverse/v5.5/effects";
export const KLING_FAL_EFFECTS_ENDPOINT = "fal-ai/kling-video/v1.6/standard/effects";

/** The dozen PixVerse effects we sell (exact `effect` enum values, grid order): striking, and fit for every audience. */
export const PIXVERSE_EFFECTS: readonly { id: string; label: string }[] = [
  { id: "Anything, Robot", label: "Robotga aylanish" },
  { id: "Liquid Metal", label: "Suyuq metall" },
  { id: "Dust Me Away", label: "Changga aylanish" },
  { id: "Earth Zoom", label: "Yer kurrasigacha" },
  { id: "Dragon Evoker", label: "Ajdaho chaqirish" },
  { id: "Fin-tastic Mermaid", label: "Suv parisi" },
  { id: "I believe I can fly", label: "Osmonga uchish" },
  { id: "Long Hair Magic", label: "Uzun soch" },
  { id: "The Age Ripple", label: "Yillar to‘lqini" },
  { id: "3D Figurine Factory", label: "3D haykalcha" },
  { id: "Pixel World", label: "Piksel dunyosi" },
  { id: "Hitchcock Dolly Zoom", label: "Hichkok kadri" },
];

/** The nine scenes the Studio already sells, plus the hug in its one-photo form. */
export const KLING_FAL_EFFECTS: readonly { id: string; label: string }[] = [...KLING_EFFECTS, ...KLING_DUAL_EFFECTS];

/** Every effect a stored job may name, for labels (a scene sold by two providers keeps one label). */
export const ALL_EFFECT_SCENES: readonly { id: string; label: string }[] = [...KLING_EFFECT_SCENES, ...PIXVERSE_EFFECTS];

/** The upload row's hint when a scene wants more than a clear face. */
export function effectPhotoHint(effect: unknown, modelId: string): string {
  return modelId === KLING_FAL_EFFECTS_MODEL && effect === "hug_pro" ? "Bitta suratda ikki kishi birga ko‘rinsin" : "Yuz yoki odam aniq ko‘rinsin";
}

function falEffect(id: string, label: string, maker: string, endpoint: string, usd: number, scenes: readonly { id: string; label: string }[]): CatalogEntry {
  return {
    id,
    kind: "video",
    capabilities: ["effect"],
    label,
    maker,
    badges: ["arzon"],
    params: [
      { name: "effect", label: "Effekt", type: "enum", options: scenes.map((e) => ({ value: e.id, label: e.label })), default: scenes[0]!.id, affects: "request" },
      { ...START_IMAGE, label: "Surat" },
    ],
    cost: { per: "job", usd },
    routes: [{ provider: "fal", upstreamModel: endpoint, adapter: "fal-video" }],
    defaultOff: true,
    limits: VIDEO_LIMITS,
    output: VIDEO_OUT,
  };
}

/** The fal effect models, in the provider row's order. */
export const FAL_EFFECT_ENTRIES: readonly CatalogEntry[] = [
  falEffect(PIXVERSE_EFFECTS_MODEL, "PixVerse", "PixVerse", PIXVERSE_EFFECTS_ENDPOINT, FAL_EFFECT_USD.pixverse, PIXVERSE_EFFECTS),
  falEffect(KLING_FAL_EFFECTS_MODEL, "Kling 1.6", "Kuaishou", KLING_FAL_EFFECTS_ENDPOINT, FAL_EFFECT_USD.kling, KLING_FAL_EFFECTS),
];

/* ═════════════════ Studio P9: OpenAI Sora 2 through fal (docs/studio/P9-SPEC.md) ═════════════════
 * Endpoints (https://fal.ai/docs/model-api-reference/video-generation-api/sora-2-text-to-video and …/sora-2-image-to-video,
 * read 2026-11-03): `fal-ai/sora-2/{text,image}-to-video` and their `/pro` twins. duration enum "4" | "8" | "12" | "16" |
 * "20", aspect 16:9 | 9:16 (image → video: «auto», the frame decides), sound always on, no end frame.
 * USD per second: Pro 720p 0.30 · 1080p 0.50 (fal's Pro page). Standard 720p 0.10 is OpenAI's own API rate
 * (developers.openai.com sora-2), which fal passes through — UNVERIFIED on fal until the first live job is compared with
 * the fal usage page. `true_1080p` is not sold. Lengths 4 / 8 / 12 s: Sora has no 10 s, and 16 / 20 s at 1080p risk the
 * 25 MB result cap.
 */
export const SORA_USD_PER_SECOND = {
  "openai/sora-2": { "720p": 0.1 },
  "openai/sora-2-pro": { "720p": 0.3, "1080p": 0.5 },
} as const satisfies Record<string, Record<string, number>>;

/** Clip lengths Sora is sold at (its duration enum, capped as above). */
export const SORA_SECONDS = [4, 8, 12] as const;
export const SORA_ASPECTS = ["16:9", "9:16"] as const;

function soraEntry(id: keyof typeof SORA_USD_PER_SECOND, label: string, upstream: string, badges: CatalogEntry["badges"]): CatalogEntry {
  const table = SORA_USD_PER_SECOND[id] as Readonly<Record<string, number>>;
  const tiers = Object.keys(table);
  const top = tiers[tiers.length - 1]!;
  return {
    id,
    kind: "video",
    capabilities: ["t2v", "i2v"],
    label,
    maker: "OpenAI",
    badges,
    params: [
      { name: "prompt", label: "Video tavsifi", type: "text", min: VIDEO_PROMPT_MIN, max: VIDEO_PROMPT_MAX, affects: "request" },
      { name: "seconds", label: "Davomiylik", hint: "Soniya (4, 8 yoki 12)", type: "int", min: SORA_SECONDS[0], max: SORA_SECONDS[SORA_SECONDS.length - 1]!, step: 4, default: 4, affects: "both" },
      // One tier (Sora 2: 720p only) = no row: a choice of one would be a decorative field.
      ...(tiers.length > 1
        ? [{ name: "resolution", label: "Sifat", hint: "Yuqori sifat qimmatroq", type: "enum", options: tiers.map((t) => ({ value: t, label: RESOLUTION_LABEL[t] ?? t })), default: top, affects: "both" } as const]
        : []),
      {
        name: "aspect",
        label: "O'lcham",
        hint: "Surat bilan boshlanganda nisbat suratdan olinadi",
        type: "enum",
        options: SORA_ASPECTS.map((a) => ({ value: a, label: a })),
        default: SORA_ASPECTS[0],
        affects: "request",
      },
      START_IMAGE,
    ],
    cost: tiers.length > 1 ? { per: "second", usd: table[top]!, secondsParam: "seconds", by: { param: "resolution", table } } : { per: "second", usd: table[top]!, secondsParam: "seconds" },
    routes: [{ provider: "fal", upstreamModel: upstream, adapter: "fal-video" }],
    limits: VIDEO_LIMITS,
    output: VIDEO_OUT,
  };
}

/** Sora 2 entries, picker order (after the P4 fal models). */
export const SORA_ENTRIES: readonly CatalogEntry[] = [
  soraEntry("openai/sora-2", "Sora 2", "fal-ai/sora-2", ["ovozli", "yangi"]),
  soraEntry("openai/sora-2-pro", "Sora 2 Pro", "fal-ai/sora-2/pro", ["sifatli", "ovozli"]),
];

/* ═════════════════ Studio P9: HeyGen avatar videos (docs/studio/P9-HEYGEN.md) ═════════════════
 * HeyGen API v3, read 2026-11-03 (developers.heygen.com): `POST https://api.heygen.com/v3/videos` `{ type: "avatar",
 * avatar_id, script + voice_id | audio_asset_id, resolution, aspect_ratio, engine }` → `data.video_id`; then
 * `GET /v3/videos/{id}` until `completed` (`video_url`, presigned). A stock avatar speaks either a script (HeyGen's TTS:
 * «Uzbek (Latin, Uzbekistan)» is in HeyGen's voice-language list, help.heygen.com article 11391932) or the user's OWN
 * finished speech result (the «Ovoz» tab), uploaded to HeyGen's asset store at submit.
 *
 * PRICE: HeyGen bills API video per second of output (pay-as-you-go wallet, $5 minimum). Its own pricing table is not
 * readable without an account; the figures below are HeyGen's blog «Best AI Avatar and Talking-Head APIs» (2026-10-29),
 * the higher figure where its table and its FAQ disagree — ALL UNVERIFIED until a live job is compared with the wallet:
 *   Avatar IV (stock studio avatar)  $4.83 / min = $0.0805 / s (the table says $4.00 / min)
 *   Avatar III                       $1.00 / min = $0.0167 / s (the FAQ says $0.60)
 * The length is not a choice: it is computed from the inputs BEFORE the job (`withAvatarSeconds`) — the script at
 * `HEYGEN_CHARS_PER_SECOND` (a slow reading pace, so the estimate is rarely short), or the own speech's stored length —
 * and a clip more than a second shorter refunds the difference (the shared `delivered` rule of the video poll loop).
 * 60 s at most: 720p keeps a minute well inside the 25 MB result cap.
 */
export const HEYGEN_MODEL = "heygen/avatar";
export const HEYGEN_USD_PER_SECOND = { avatar_iv: 0.0805, avatar_iii: 0.0167 } as const satisfies Record<string, number>;
/** Characters of script per second of clip the price assumes (slow speech; a faster voice is refunded the rest). */
export const HEYGEN_CHARS_PER_SECOND = 12;
export const HEYGEN_MAX_SECONDS = 60;
/** The longest script: what fits `HEYGEN_MAX_SECONDS` at the priced pace (HeyGen's own cap is 5 000 characters). */
export const HEYGEN_SCRIPT_MAX = HEYGEN_MAX_SECONDS * HEYGEN_CHARS_PER_SECOND;
/** A script shorter than this cannot make a second of speech (HeyGen `script_too_short`). */
export const HEYGEN_SCRIPT_MIN = 5;
/** The own-speech param: a finished speech generation's id (ownership is checked in SQL before charging). */
export const OWN_AUDIO_PARAM = "audioId";
export const HEYGEN_ASPECTS = ["16:9", "9:16"] as const;

/**
 * Curated public studio avatars (ids as HeyGen's own API examples name them; UNVERIFIED in a live `GET
 * /v3/avatars/looks?ownership=public` until the owner's key exists — an unknown id is a 4xx before acceptance = refund).
 */
export const HEYGEN_AVATARS: readonly { id: string; label: string }[] = [
  { id: "Angela-inblackskirt-20220820", label: "Angela — ayol, rasmiy" },
  { id: "Daisy-inskirt-20220818", label: "Daisy — ayol, oddiy" },
  { id: "Tyler-incasualsuit-20220721", label: "Tyler — erkak, kostyum" },
  { id: "Josh_lite3_20230714", label: "Josh — erkak, oddiy" },
];

/** Script language → HeyGen's voice-list `language` filter; the voice is the first public one of that language + gender. */
export const HEYGEN_VOICE_LANGUAGES = { uz: "Uzbek", ru: "Russian", en: "English" } as const;

/**
 * Spoken weight of a script character (review MINOR 4): a digit is read out as a word («2026» → «ikki ming yigirma olti»,
 * ≈ 5.5 characters per digit), a symbol as a word («%» → «foiz», «$» → «dollar», «+» → «plyus», «=» → «teng»).
 */
export const HEYGEN_DIGIT_WEIGHT = 6;
export const HEYGEN_SYMBOL_WEIGHT = 8;
const SPOKEN_SYMBOL = /[%$€£₽+=@&#№°]/;
/** A link or an e-mail is read out letter by letter (or garbled): refused, the user writes it in words. */
const URL_OR_EMAIL = /(?:\bhttps?:\/\/|\bwww\.)\S+|[^\s@]+@[^\s@]+\.[^\s@]+/i;

/** The script's length as spoken, in characters: plain characters 1, digits / symbols weighted (above). */
export function avatarSpokenChars(script: unknown): number {
  let n = 0;
  for (const ch of normalizeText(script, HEYGEN_SCRIPT_MAX)) n += /\d/.test(ch) ? HEYGEN_DIGIT_WEIGHT : SPOKEN_SYMBOL.test(ch) ? HEYGEN_SYMBOL_WEIGHT : 1;
  return n;
}

/**
 * Why a script cannot be sold (Uzbek, a 400 before charging; the form shows the same text), `null` when it can: a link /
 * an e-mail, or a spoken length beyond `HEYGEN_MAX_SECONDS`. The SAME weights as the price (`avatarScriptSeconds`).
 */
export function avatarScriptProblem(script: unknown): string | null {
  const text = normalizeText(script, HEYGEN_SCRIPT_MAX);
  if (URL_OR_EMAIL.test(text)) return "Avatar matnida havola yoki e-pochta bo‘lmasin — so‘z bilan yozing.";
  if (avatarSpokenChars(text) > HEYGEN_SCRIPT_MAX) return "Matn 1 daqiqaga sig‘maydi (raqam va belgilar ham so‘z bilan o‘qiladi) — qisqartiring.";
  return null;
}

/** Clip seconds a script buys: its spoken length at the priced pace, 1 … `HEYGEN_MAX_SECONDS`. */
export function avatarScriptSeconds(script: unknown): number {
  return Math.min(HEYGEN_MAX_SECONDS, Math.max(1, Math.ceil(avatarSpokenChars(script) / HEYGEN_CHARS_PER_SECOND)));
}

/**
 * Clip seconds an own speech of `raw` seconds buys: rounded to 0.1 s (what the source list shows), then up to a whole
 * second, 1 … `max` (a speech a frame over the limit is accepted by the server's tolerance).
 */
export function avatarAudioSeconds(raw: number, max: number = HEYGEN_MAX_SECONDS): number {
  return Math.min(max, Math.max(1, Math.ceil(Math.round(raw * 10) / 10 - 1e-9)));
}

/**
 * The values with `seconds` set from the inputs — ONE function for the browser (the price on the button) and the server
 * (it overwrites whatever the request said, before pricing): an own speech → its length (`audioSeconds`, the stored
 * length; the values unchanged while it is unknown), else the script's. A photo avatar has no script: it waits for its speech.
 */
export function withAvatarSeconds(values: Readonly<Record<string, unknown>>, audioSeconds: number | null): Record<string, unknown> {
  const own = String(values[OWN_AUDIO_PARAM] ?? "").trim();
  const id = String(values.modelId ?? "");
  if (own) return audioSeconds === null ? { ...values } : { ...values, seconds: avatarAudioSeconds(audioSeconds, avatarMaxSeconds(id)) };
  return isPhotoAvatarModel(id) ? { ...values } : { ...values, seconds: avatarScriptSeconds(values.prompt) };
}

const HEYGEN_ENTRY: CatalogEntry = {
  id: HEYGEN_MODEL,
  kind: "video",
  capabilities: ["lipsync"],
  label: "HeyGen avatar",
  maker: "HeyGen",
  badges: ["yangi"],
  params: [
    // The script is the tab's prompt box; empty when the avatar speaks the user's own speech instead.
    { name: "prompt", label: "Avatar matni", type: "text", min: 0, max: HEYGEN_SCRIPT_MAX, affects: "request" },
    { name: OWN_AUDIO_PARAM, label: "O‘z ovozingiz", hint: "«Ovoz» bo‘limida yaratilgan ovoz — avatar shuni gapiradi", type: "text", min: 0, max: 36, affects: "request" },
    { name: "avatar", label: "Avatar", type: "enum", options: HEYGEN_AVATARS.map((a) => ({ value: a.id, label: a.label })), default: HEYGEN_AVATARS[0]!.id, affects: "request" },
    {
      name: "voice",
      label: "Ovoz",
      type: "enum",
      options: [
        { value: "female", label: "Ayol ovozi" },
        { value: "male", label: "Erkak ovozi" },
      ],
      default: "female",
      affects: "request",
    },
    {
      name: "language",
      label: "Matn tili",
      type: "enum",
      options: [
        { value: "uz", label: "O‘zbekcha" },
        { value: "ru", label: "Ruscha" },
        { value: "en", label: "Inglizcha" },
      ],
      default: "uz",
      affects: "request",
    },
    {
      name: "engine",
      label: "Sifat",
      hint: "Avatar IV — jonliroq mimika, qimmatroq",
      type: "enum",
      options: [
        { value: "avatar_iv", label: "Avatar IV" },
        { value: "avatar_iii", label: "Avatar III (arzon)" },
      ],
      default: "avatar_iv",
      affects: "both",
    },
    { name: "aspect", label: "O'lcham", type: "enum", options: HEYGEN_ASPECTS.map((a) => ({ value: a, label: a })), default: HEYGEN_ASPECTS[0], affects: "request" },
    // Set from the script / the own speech (`withAvatarSeconds`) on both sides; never a form row.
    { name: "seconds", label: "Davomiylik", hint: "Matn yoki ovoz uzunligidan hisoblanadi", type: "int", min: 1, max: HEYGEN_MAX_SECONDS, step: 1, default: 10, affects: "price" },
  ],
  cost: { per: "second", usd: HEYGEN_USD_PER_SECOND.avatar_iv, secondsParam: "seconds", by: { param: "engine", table: HEYGEN_USD_PER_SECOND } },
  routes: [{ provider: "heygen", upstreamModel: "v3-avatar", adapter: "heygen-video" }],
  limits: VIDEO_LIMITS,
  output: VIDEO_OUT,
};

/* ═════════════════ Studio P11 package F: photo avatars through fal ═════════════════
 * A photo speaks the user's OWN speech result (the `audioId` path of HeyGen): no script, so no prompt box. Pages read 2026-11-06:
 *   OmniHuman v2     https://fal.ai/models/bytedance/omnihuman/v2/llms.txt  «$0.105 per seconds»; billed on the `duration` of
 *                    the audio; audio «wav or mp3. Max size: 15 MB. Duration between 4 and 300 seconds»; image ≤ 30 MB, aspect
 *                    0.4–2.5, sides 300–6000 px. Its optional prompt lists six languages, Uzbek is not one, so none is sent.
 *   Kling Avatar v2  https://fal.ai/models/fal-ai/kling-video/ai-avatar/v2/standard/llms.txt  «$0.0562 per seconds». No audio
 *                    limit is stated (UNVERIFIED): the length rule below holds, the format as OmniHuman's.
 * Billing keeps the audio's fractional length, the quote takes whole seconds rounded up from the length to 0.1 s
 * (`avatarAudioSeconds`, as HeyGen). Output resolution and bitrate are not stated on either page (UNVERIFIED), so 30 s is the
 * cap until live clip sizes are known: 300 s would never fit the 25 MB result cap, and fal bills a clip we cannot store.
 */
export const OMNIHUMAN_MODEL = "bytedance/omnihuman-2";
export const KLING_AVATAR_MODEL = "kling/ai-avatar-2";
export const FAL_AVATAR_USD_PER_SECOND = { [OMNIHUMAN_MODEL]: 0.105, [KLING_AVATAR_MODEL]: 0.0562 } as const;
export const FAL_AVATAR_MAX_SECONDS = 30;
export const OMNIHUMAN_MIN_SECONDS = 4;
/** OmniHuman's stated audio limit (the format limit is `FAL_AVATAR_AUDIO_MIMES`). */
export const OMNIHUMAN_AUDIO_MAX_BYTES = 15 * 1024 * 1024;
export const FAL_AVATAR_AUDIO_MIMES: readonly string[] = ["audio/mpeg", "audio/wav"];

function falAvatar(id: keyof typeof FAL_AVATAR_USD_PER_SECOND, label: string, maker: string, badges: CatalogEntry["badges"], endpoint: string, minSeconds: number): CatalogEntry {
  return {
    id,
    kind: "video",
    capabilities: ["lipsync"],
    label,
    maker,
    badges,
    params: [
      { name: OWN_AUDIO_PARAM, label: "O‘z ovozingiz", hint: "«Ovoz» bo‘limida yaratilgan ovoz — surat shuni gapiradi", type: "text", min: 0, max: 36, affects: "request" },
      { ...START_IMAGE, label: "Avatar surati", min: 1 },
      // Set from the speech's length (`withAvatarSeconds`) on both sides; never a form row.
      { name: "seconds", label: "Davomiylik", hint: "Ovoz uzunligidan hisoblanadi", type: "int", min: minSeconds, max: FAL_AVATAR_MAX_SECONDS, step: 1, default: 10, affects: "price" },
    ],
    cost: { per: "second", usd: FAL_AVATAR_USD_PER_SECOND[id], secondsParam: "seconds" },
    routes: [{ provider: "fal", upstreamModel: endpoint, adapter: "fal-avatar" }],
    defaultOff: true,
    limits: VIDEO_LIMITS,
    output: VIDEO_OUT,
  };
}

export const FAL_AVATAR_ENTRIES: readonly CatalogEntry[] = [
  falAvatar(OMNIHUMAN_MODEL, "OmniHuman v2", "ByteDance", ["sifatli", "yangi"], "bytedance/omnihuman/v2", OMNIHUMAN_MIN_SECONDS),
  falAvatar(KLING_AVATAR_MODEL, "Kling Avatar v2", "Kuaishou", ["arzon", "yangi"], "fal-ai/kling-video/ai-avatar/v2/standard", 1),
];

/** The photo avatars: they speak only an own speech, a photo is required. */
export const isPhotoAvatarModel = (id: string): boolean => FAL_AVATAR_ENTRIES.some((e) => e.id === id);

/** An avatar model: its length follows the inputs, it may take an own speech. */
export const isAvatarModel = (id: string): boolean => id === HEYGEN_MODEL || isPhotoAvatarModel(id);

/** The shortest own speech a model takes (seconds). */
export const avatarMinSeconds = (id: string): number => (id === OMNIHUMAN_MODEL ? OMNIHUMAN_MIN_SECONDS : 1);
/** The longest own speech a model takes (seconds). */
export const avatarMaxSeconds = (id: string): number => (isPhotoAvatarModel(id) ? FAL_AVATAR_MAX_SECONDS : HEYGEN_MAX_SECONDS);

/**
 * Models whose image → video request has no aspect (the canvas follows the start frame): Kling 4.0, Kling 3.0 and the fal models.
 * The form hides their «O'lcham» row while a start image is set (P4 review N3). Gemini Omni keeps it (it sends it).
 */
export const ASPECT_FOLLOWS_IMAGE: ReadonlySet<string> = new Set([...KLING_V4_ENTRIES, ...KLING_V3_ENTRIES, ...FAL_VIDEO_ENTRIES, ...SORA_ENTRIES, ...FAL_VIDEO_P11_ENTRIES].map((e) => e.id));

/** Every Studio video entry, picker order: Kling 4.0, Kling 3.0 tiers, the fal models (P4), Sora 2 (P9), package F's models, the avatars (HeyGen, then fal's), the effect templates last (fal's first). */
export const STUDIO_VIDEO_ENTRIES: readonly CatalogEntry[] = [...KLING_V4_ENTRIES, ...KLING_V3_ENTRIES, ...FAL_VIDEO_ENTRIES, ...SORA_ENTRIES, ...FAL_VIDEO_P11_ENTRIES, HEYGEN_ENTRY, ...FAL_AVATAR_ENTRIES, ...FAL_EFFECT_ENTRIES, KLING_EFFECTS_ENTRY];

/** Length of an effect clip (the result page, the short-clip refund). */
export const STUDIO_EFFECT_SECONDS = KLING_EFFECT_SECONDS;

/** Order = the Studio picker's order; Gemini Omni (already sold by «Video») is the default. */
export const STUDIO_VIDEO_PURPOSE_SPEC: PurposeSpec = {
  id: STUDIO_VIDEO_PURPOSE,
  kind: "video",
  allowed: ["google/omni-video", ...STUDIO_VIDEO_ENTRIES.map((e) => e.id)],
  default: "google/omni-video",
  userCanChoose: true,
};
