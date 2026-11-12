/**
 * Work rating (docs/ratings/GENERATION-RATING.md): the pure rules shared by the service
 * (`lib/server/generation-ratings.ts`, authoritative), the bot keyboard and a future web control.
 * Client-safe: no server imports.
 *
 * Not the app rating of `lib/rating.ts` (one per user, written feedback, a bonus): this one is per
 * generation, has no bonus and needs no text.
 */

export const RATING_STARS = [1, 2, 3, 4, 5] as const;
export type RatingStars = (typeof RATING_STARS)[number];

/** What was wrong with a low (1-3 star) work. The order is the bot's button order. */
export const RATING_REASONS = ["design", "images", "text", "errors", "other"] as const;
export type RatingReason = (typeof RATING_REASONS)[number];

/** A reason may only accompany a rating of at most this many stars. */
export const RATING_LOW_MAX = 3;
export const RATING_COMMENT_MAX = 500;
export const RATING_SOURCES = ["bot", "web"] as const;
export type RatingSource = (typeof RATING_SOURCES)[number];

/** Uzbek labels (admin panel and the web). The bot has its own three-language labels. */
export const RATING_REASON_LABELS: Record<RatingReason, string> = {
  design: "Dizayn",
  images: "Rasmlar",
  text: "Matn",
  errors: "Xatolar",
  other: "Boshqa",
};

export function isRatingStars(v: unknown): v is RatingStars {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5;
}

export function isRatingReason(v: unknown): v is RatingReason {
  return typeof v === "string" && (RATING_REASONS as readonly string[]).includes(v);
}

export function isRatingSource(v: unknown): v is RatingSource {
  return typeof v === "string" && (RATING_SOURCES as readonly string[]).includes(v);
}
