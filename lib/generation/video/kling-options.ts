/**
 * Kling 3.0 / effect options shared by the request builders (`kling.ts`, server) and the media catalog
 * (`lib/media/catalog-video.ts`, client-safe). Client-safe on purpose: no node / server imports.
 */

/** Kling 3.0 model name on the Kling API (docs/studio/P3-SPEC.md). */
export const KLING_V3_MODEL = "kling-v3";
/** Quality modes: `std` renders 720p, `pro` 1080p (ComfyUI «Kling 3.0 Video» node: 720p → std, 1080p → pro). */
export const KLING_V3_MODES = ["std", "pro"] as const;
export type KlingV3Mode = (typeof KLING_V3_MODES)[number];
/** Aspect ratios of text to video (image to video takes the picture's own). */
export const KLING_V3_ASPECTS = ["16:9", "9:16", "1:1"] as const;
export type KlingV3Aspect = (typeof KLING_V3_ASPECTS)[number];
/** Clip lengths Kling 3.0 accepts, whole seconds. */
export const KLING_V3_SECONDS = { min: 3, max: 15 } as const;
/** An effect scene renders one fixed 5-second clip. */
export const KLING_EFFECT_SECONDS = 5;
/**
 * Two-photo («dual character») effect scenes on the direct API (Studio P4, docs/studio/P4-SPEC.md): Kling's OpenAPI as
 * vendored by ComfyUI (`comfy_api_nodes/apis/__init__.py` `KlingDualCharacterEffectInput`: `model_name` kling-v1 /
 * kling-v1-5 / kling-v1-6, `mode` std, `images` exactly two, `duration` "5" | "10"; read 2026-11-02). The newest listed
 * model and the 5-second clip of every other effect.
 */
export const KLING_DUAL_EFFECT_MODEL = "kling-v1-6";
export const KLING_DUAL_EFFECT_MODE = "std";
