/**
 * Kling 3.0 / effect options shared by the request builders (`kling.ts`, server) and the media catalog
 * (`lib/media/catalog-video.ts`, client-safe). Client-safe on purpose: no node / server imports.
 */

/** Kling 3.0 model on the Kling API: the last segment of its create paths (docs/studio/P3-SPEC.md). */
export const KLING_V3_MODEL = "kling-3.0";
/** Quality tiers: `std` renders 720p, `pro` 1080p. */
export const KLING_V3_MODES = ["std", "pro"] as const;
export type KlingV3Mode = (typeof KLING_V3_MODES)[number];
/** Aspect ratios of text to video (image to video takes the picture's own). */
export const KLING_V3_ASPECTS = ["16:9", "9:16", "1:1"] as const;
export type KlingV3Aspect = (typeof KLING_V3_ASPECTS)[number];
/** Clip lengths Kling 3.0 accepts, whole seconds. */
export const KLING_V3_SECONDS = { min: 3, max: 15 } as const;
/** An effect scene renders one fixed 5-second clip. */
export const KLING_EFFECT_SECONDS = 5;
