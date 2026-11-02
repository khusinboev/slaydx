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
 * (URL above). The canvas's «Quchoqlash» (hug_pro: TWO photos), «Xotira tiriladi», «Trampolin» and «Kiyim» have no
 * single-image scene with a documented id and are not sold.
 */
import type { CatalogEntry, ParamSchema, PurposeSpec } from "../studio-core";
import { VIDEO_PROMPT_MAX, VIDEO_PROMPT_MIN } from "../generation/video/registry";
import { VIDEO_MAX_BYTES } from "../generation/video/types";
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
  mimes: ["image/jpeg", "image/png", "image/webp"],
  maxBytes: 10 * 1024 * 1024,
  affects: "request",
};

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

export const STUDIO_VIDEO_ENTRIES: readonly CatalogEntry[] = [
  klingV3("kling/kling-3", "Kling 3.0", ["arzon"], "std"),
  klingV3("kling/kling-3-pro", "Kling 3.0 Pro", ["sifatli"], "pro"),
  {
    id: "kling/effects",
    kind: "video",
    capabilities: ["effect"],
    label: "Kling effektlar",
    maker: "Kuaishou",
    badges: [],
    params: [
      { name: "effect", label: "Effekt", type: "enum", options: KLING_EFFECTS.map((e) => ({ value: e.id, label: e.label })), default: KLING_EFFECTS[0]!.id, affects: "request" },
      { ...START_IMAGE, label: "Surat" },
    ],
    cost: { per: "job", usd: KLING_EFFECT_USD },
    routes: [{ provider: "kling", upstreamModel: "effects", adapter: "kling-effects" }],
    limits: VIDEO_LIMITS,
    output: VIDEO_OUT,
  },
];

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
