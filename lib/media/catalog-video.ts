/**
 * Studio «Video» tab models (docs/studio/P3-SPEC.md) — Kling 3.0 (two tiers) and Kling effect templates, plus the
 * `studio.video` purpose. `catalog.ts` spreads these into `MEDIA_ENTRIES` / `MEDIA_PURPOSES`; Gemini Omni is the
 * existing `google/omni-video` entry (one model, two sellers: the «Video» tool's ladder, the Studio's cost × markup).
 *
 * Client-safe (no server imports, and NOT importing `catalog.ts`: that file imports this one).
 *
 * PROVIDER COSTS (USD), read 2026-11-02 — Kling's own price page (kling.ai/document-api, a JavaScript app) could not
 * be read, so every Kling number below is UNVERIFIED against the account's unit price list:
 *   Kling 3.0  per second, by mode × sound — ComfyUI's «Kling 3.0 Video» partner-node price badge
 *              (github.com/comfyanonymous/ComfyUI comfy_api_nodes/nodes_kling.py `KlingVideoNode`, commit de37ca2,
 *              2026-10-26): 720p (std) $0.084 / s silent, $0.126 / s with sound; 1080p (pro) $0.112 / $0.168.
 *              4K ($0.42 / s) is not sold: a 4K clip does not fit the 25 MB result cap.
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
 * STUDIO P4 (docs/studio/P4-SPEC.md): «Quchoqlash» is the direct API's documented TWO-photo scene `hug`
 * (`KLING_DUAL_EFFECTS`; fal's `hug_pro` is a ONE-image scene, not the two-photo one); Kling 3.0 takes an end frame
 * (`endImageAssetId` → `image_tail`); five more models through fal (`FAL_VIDEO_ENTRIES`, block below).
 */
import type { CatalogEntry, ParamSchema, PurposeSpec } from "../studio-core";
import { VIDEO_PROMPT_MAX, VIDEO_PROMPT_MIN } from "../generation/video/registry";
import { VIDEO_MAX_BYTES } from "../generation/video/types";
import { PHOTO_MAX_BYTES } from "../photo-accept";
import { KLING_EFFECT_SECONDS, KLING_V3_ASPECTS, KLING_V3_MODEL, KLING_V3_SECONDS } from "../generation/video/kling-options";

/** Purpose of the Studio «Video» tab (tool `studio-video`). */
export const STUDIO_VIDEO_PURPOSE = "studio.video";

/** Kling 3.0 USD per second: [silent, with sound], by tier. */
export const KLING_V3_USD_PER_SECOND = {
  std: { silent: 0.084, sound: 0.126 },
  pro: { silent: 0.112, sound: 0.168 },
} as const;

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

const START_IMAGE: ParamSchema = {
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
 * Two-photo effect scenes (Studio P4): `hug` is a documented dual-character scene of the direct API (Kling OpenAPI as
 * vendored by ComfyUI, `KlingDualCharacterEffectsScene`: hug / kiss / heart_gesture, `images` exactly two; read
 * 2026-11-02). Only «Quchoqlash» is sold (the owner's canvas); priced as every effect (UNVERIFIED, see P4-SPEC).
 */
export const KLING_DUAL_EFFECTS: readonly { id: string; label: string }[] = [{ id: "hug", label: "Quchoqlash" }];

/** Every effect scene the Studio sells, grid order: the single-photo ones, then the two-photo ones. */
export const KLING_EFFECT_SCENES: readonly { id: string; label: string }[] = [...KLING_EFFECTS, ...KLING_DUAL_EFFECTS];

/** Photos an effect scene needs (2 for a dual-character scene). */
export function effectPhotos(effect: unknown): 1 | 2 {
  return KLING_DUAL_EFFECTS.some((e) => e.id === effect) ? 2 : 1;
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
    limits: VIDEO_LIMITS,
    output: VIDEO_OUT,
  };
}

const KLING_V3_ENTRIES: readonly CatalogEntry[] = [
  klingV3("kling/kling-3", "Kling 3.0", ["arzon"], "std"),
  klingV3("kling/kling-3-pro", "Kling 3.0 Pro", ["sifatli"], "pro"),
];

const KLING_EFFECTS_ENTRY: CatalogEntry = {
  id: "kling/effects",
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

/**
 * Models whose image → video request has no aspect (the canvas follows the start frame): Kling 3.0 and the fal models.
 * The form hides their «O'lcham» row while a start image is set (P4 review N3). Gemini Omni keeps it (it sends it).
 */
export const ASPECT_FOLLOWS_IMAGE: ReadonlySet<string> = new Set([...KLING_V3_ENTRIES, ...FAL_VIDEO_ENTRIES].map((e) => e.id));

/** Every Studio video entry, picker order: Kling 3.0 tiers, the fal models (P4), the effect templates last. */
export const STUDIO_VIDEO_ENTRIES: readonly CatalogEntry[] = [...KLING_V3_ENTRIES, ...FAL_VIDEO_ENTRIES, KLING_EFFECTS_ENTRY];

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
