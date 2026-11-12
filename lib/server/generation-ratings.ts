import "server-only";
import { cleanText } from "../generation/safe-text";
import {
  RATING_COMMENT_MAX,
  RATING_LOW_MAX,
  RATING_REASONS,
  isRatingReason,
  isRatingSource,
  isRatingStars,
  type RatingReason,
  type RatingSource,
} from "../generation-rating";
import { ApiError } from "./api";
import { query, queryOne } from "./db";
import { log } from "./log";
import { rateLimit } from "./ratelimit";

/**
 * Work rating (owner request 2026-11-12, docs/ratings/GENERATION-RATING.md) — the ONE service of
 * the bot's «⭐ Baholash» flow, the web API (`/api/generations/[id]/rating`) and the admin block
 * (CLAUDE.md «Bot va web — bitta servis qatlami»).
 *
 * The owner of a COMPLETED generation rates it 1-5 stars; 1-3 may carry one reason from a fixed
 * set, the web may add a short comment. One row per (generation, user): a re-rate updates it, the
 * last value wins. No bonus is paid. Ownership and «only COMPLETED» are part of the write's own
 * SQL (`INSERT ... SELECT ... WHERE g.id = $1 AND g.user_id = $2 AND g.status = 'COMPLETED'`):
 * the preceding lookup only picks the error message.
 *
 * Not the app rating of `ratings.ts` (one per user, a bonus); its rules are untouched.
 */

export type GenerationRatingErrorCode =
  | "bad_stars"
  | "bad_reason"
  | "reason_needs_low"
  | "bad_comment"
  | "bad_source"
  | "not_found"
  | "not_owner"
  | "not_ready"
  | "not_rated"
  | "rate_limited";

/** A refusal with its own `code` (in the JSON body as `code`, like every `ApiError.extra`). */
export class GenerationRatingError extends ApiError {
  constructor(
    readonly code: GenerationRatingErrorCode,
    message: string,
    status: number,
    extra: Record<string, unknown> = {},
  ) {
    super(message, status, { code, ...extra });
    this.name = "GenerationRatingError";
  }
}

export type GenerationRating = {
  generationId: string;
  stars: number;
  reason: RatingReason | null;
  comment: string | null;
  source: RatingSource;
  createdAt: string;
  updatedAt: string;
};

/** Writes per user per hour (bot taps and web PUTs together). */
export const RATING_WRITES_PER_HOUR = 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RatingRow = {
  generation_id: string;
  stars: number;
  reason: string | null;
  comment: string | null;
  source: string;
  created_at: Date;
  updated_at: Date;
};

const RETURNING = "RETURNING generation_id::text AS generation_id, stars, reason, comment, source, created_at, updated_at";

function toRating(r: RatingRow): GenerationRating {
  return {
    generationId: r.generation_id,
    stars: Number(r.stars),
    reason: isRatingReason(r.reason) ? r.reason : null,
    comment: r.comment,
    source: isRatingSource(r.source) ? r.source : "web",
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

/* ───────────────────────── Validation ───────────────────────── */

function checkStars(stars: unknown): number {
  if (!isRatingStars(stars)) throw new GenerationRatingError("bad_stars", "Baho 1 dan 5 gacha bo'lishi kerak.", 400);
  return stars;
}

function checkReason(reason: unknown, stars: number): RatingReason | null {
  if (reason === undefined || reason === null) return null;
  if (!isRatingReason(reason)) throw new GenerationRatingError("bad_reason", "Sabab noto'g'ri.", 400, { allowed: RATING_REASONS });
  if (stars > RATING_LOW_MAX) {
    throw new GenerationRatingError("reason_needs_low", `Sabab faqat ${RATING_LOW_MAX} va undan past bahoga yoziladi.`, 400);
  }
  return reason;
}

function checkComment(comment: unknown): string | null {
  if (comment === undefined || comment === null) return null;
  if (typeof comment !== "string") throw new GenerationRatingError("bad_comment", "Izoh noto'g'ri.", 400);
  const text = cleanText(comment).trim();
  if (Array.from(text).length > RATING_COMMENT_MAX) {
    throw new GenerationRatingError("bad_comment", `Izoh ${RATING_COMMENT_MAX} belgidan oshmasin.`, 400);
  }
  return text || null;
}

function checkSource(source: unknown): RatingSource {
  if (!isRatingSource(source)) throw new GenerationRatingError("bad_source", "Manba noto'g'ri.", 400);
  return source;
}

async function checkRate(userId: string): Promise<void> {
  const r = await rateLimit(`gen-rating:${userId}`, RATING_WRITES_PER_HOUR, 3600);
  if (!r.ok) {
    throw new GenerationRatingError("rate_limited", `Juda ko'p baho. ${r.retryAfterSec} soniyadan keyin urinib ko'ring.`, 429, { retryAfter: r.retryAfterSec });
  }
}

/* ───────────────────────── Target ───────────────────────── */

export type RatingTarget = {
  toolId: string;
  topic: string;
  status: string;
  /** The stored files were removed by retention (`files_purged_at`): still rateable, no longer editable. */
  purged: boolean;
  rating: GenerationRating | null;
};

/**
 * The generation as its OWNER sees it, with the current rating. Throws `not_found` (no such
 * generation, or a malformed id) and `not_owner` (it belongs to someone else) — the web route
 * answers both as the same 404; the bot tells «Bu ish sizniki emas».
 */
export async function ratingTarget(userId: string, generationId: string): Promise<RatingTarget> {
  if (!UUID_RE.test(generationId)) throw new GenerationRatingError("not_found", "Topilmadi", 404);
  const row = await queryOne<{
    mine: boolean;
    tool_id: string;
    topic: string;
    status: string;
    purged: boolean;
    r_stars: number | null;
    r_reason: string | null;
    r_comment: string | null;
    r_source: string | null;
    r_created: Date | null;
    r_updated: Date | null;
  }>(
    `SELECT g.user_id = $2::bigint AS mine, g.tool_id, COALESCE(g.topic, '') AS topic, g.status,
            g.files_purged_at IS NOT NULL AS purged,
            r.stars AS r_stars, r.reason AS r_reason, r.comment AS r_comment, r.source AS r_source,
            r.created_at AS r_created, r.updated_at AS r_updated
       FROM generations g
       LEFT JOIN generation_ratings r ON r.generation_id = g.id AND r.user_id = $2::bigint
      WHERE g.id = $1`,
    [generationId, userId],
  );
  if (!row) throw new GenerationRatingError("not_found", "Topilmadi", 404);
  if (!row.mine) throw new GenerationRatingError("not_owner", "Bu ish sizniki emas", 404);
  return {
    toolId: row.tool_id,
    topic: row.topic,
    status: row.status,
    purged: row.purged,
    rating:
      row.r_stars === null
        ? null
        : toRating({
            generation_id: generationId.toLowerCase(),
            stars: row.r_stars,
            reason: row.r_reason,
            comment: row.r_comment,
            source: row.r_source ?? "web",
            created_at: row.r_created!,
            updated_at: row.r_updated!,
          }),
  };
}

/** The user's rating of their own generation (`null` = not rated yet). Throws like `ratingTarget`. */
export async function getGenerationRating(userId: string, generationId: string): Promise<GenerationRating | null> {
  return (await ratingTarget(userId, generationId)).rating;
}

/** Why a write matched no row: the lookup picks the message (the write itself already refused). */
async function refusal(userId: string, generationId: string): Promise<never> {
  const t = await ratingTarget(userId, generationId);
  if (t.status !== "COMPLETED") throw new GenerationRatingError("not_ready", "Ish hali tayyor emas — tayyor bo'lgach baholay olasiz.", 409);
  throw new GenerationRatingError("not_rated", "Avval ishni baholang.", 409);
}

/* ───────────────────────── Writes ───────────────────────── */

export type RateInput = {
  userId: string;
  generationId: string;
  stars: unknown;
  reason?: unknown;
  comment?: unknown;
  source: unknown;
};

/**
 * Rates (or re-rates) the user's own COMPLETED generation. The whole value is replaced: a reason
 * or comment left out becomes `null` (the last rating wins). Rate limited per user.
 */
export async function rateGeneration(input: RateInput): Promise<GenerationRating> {
  const stars = checkStars(input.stars);
  const reason = checkReason(input.reason, stars);
  const comment = checkComment(input.comment);
  const source = checkSource(input.source);
  if (!UUID_RE.test(input.generationId)) throw new GenerationRatingError("not_found", "Topilmadi", 404);
  await checkRate(input.userId);
  const row = await queryOne<RatingRow>(
    `INSERT INTO generation_ratings (generation_id, user_id, stars, reason, comment, source)
     SELECT g.id, g.user_id, $3, $4, $5, $6
       FROM generations g
      WHERE g.id = $1 AND g.user_id = $2::bigint AND g.status = 'COMPLETED'
     ON CONFLICT (generation_id, user_id) DO UPDATE
        SET stars = EXCLUDED.stars, reason = EXCLUDED.reason, comment = EXCLUDED.comment,
            source = EXCLUDED.source, updated_at = now()
     ${RETURNING}`,
    [input.generationId, input.userId, stars, reason, comment, source],
  );
  if (!row) return refusal(input.userId, input.generationId);
  log("info", "[gen-rating] rated", { generationId: input.generationId, stars, reason, source });
  return toRating(row);
}

/**
 * The bot's second step after 1-3 stars: only the reason of the existing rating changes (stars and
 * comment stay). `reason: null` = «O'tkazib yuborish». A rating above 3 stars refuses a reason.
 */
export async function setRatingReason(input: { userId: string; generationId: string; reason: unknown; source: unknown }): Promise<GenerationRating> {
  const source = checkSource(input.source);
  const reason = input.reason === null ? null : checkReason(input.reason, 1);
  if (!UUID_RE.test(input.generationId)) throw new GenerationRatingError("not_found", "Topilmadi", 404);
  await checkRate(input.userId);
  const row = await queryOne<RatingRow>(
    `UPDATE generation_ratings r
        SET reason = $3, source = $4, updated_at = now()
       FROM generations g
      WHERE r.generation_id = $1 AND r.user_id = $2::bigint
        AND g.id = r.generation_id AND g.user_id = $2::bigint AND g.status = 'COMPLETED'
        AND ($3::text IS NULL OR r.stars <= ${RATING_LOW_MAX})
     RETURNING r.generation_id::text AS generation_id, r.stars, r.reason, r.comment, r.source, r.created_at, r.updated_at`,
    [input.generationId, input.userId, reason, source],
  );
  if (row) return toRating(row);
  const t = await ratingTarget(input.userId, input.generationId);
  if (t.rating && t.rating.stars > RATING_LOW_MAX) {
    throw new GenerationRatingError("reason_needs_low", `Sabab faqat ${RATING_LOW_MAX} va undan past bahoga yoziladi.`, 400);
  }
  return refusal(input.userId, input.generationId);
}

/* ───────────────────────── Admin (read-only) ───────────────────────── */

export type LowRating = {
  generationId: string;
  toolId: string;
  topic: string;
  stars: number;
  reason: RatingReason | null;
  comment: string | null;
  source: RatingSource;
  userId: string;
  at: string;
};

export type ToolRatingSummary = {
  toolId: string;
  count: number;
  /** Rounded to 2 decimals; the UI shows one. */
  average: number;
  /** Index 0 = 1 star ... index 4 = 5 stars. */
  distribution: number[];
  /** Ratings of at most `RATING_LOW_MAX` stars, and their share of `count` (0..1). */
  low: number;
  lowShare: number;
  reasons: Record<RatingReason, number>;
  /** Newest low ratings of this tool (at most 3), for follow-up. */
  latestLow: LowRating[];
};

export type RatingSummary = {
  from: string;
  to: string;
  count: number;
  average: number | null;
  low: number;
  /** Busiest tool first. */
  tools: ToolRatingSummary[];
  /** Newest low ratings over every tool (at most `lowLimit`). */
  recentLow: LowRating[];
};

export const SUMMARY_LATEST_PER_TOOL = 3;
export const SUMMARY_RECENT_LOW_MAX = 50;

const round2 = (n: number): number => Math.round(n * 100) / 100;

type LowRow = {
  generation_id: string;
  tool_id: string;
  topic: string;
  stars: number;
  reason: string | null;
  comment: string | null;
  source: string;
  user_id: string;
  updated_at: Date;
};

function toLow(r: LowRow): LowRating {
  return {
    generationId: r.generation_id,
    toolId: r.tool_id,
    topic: r.topic,
    stars: Number(r.stars),
    reason: isRatingReason(r.reason) ? r.reason : null,
    comment: r.comment,
    source: isRatingSource(r.source) ? r.source : "web",
    userId: r.user_id,
    at: new Date(r.updated_at).toISOString(),
  };
}

const LOW_COLUMNS = `r.generation_id::text AS generation_id, g.tool_id, left(COALESCE(g.topic, ''), 160) AS topic, r.stars, r.reason,
       r.comment, r.source, r.user_id::text AS user_id, r.updated_at`;

/**
 * Per tool, over the ratings whose CURRENT value was given in `[from, to)` (`updated_at`): count,
 * average, the 1-5 distribution, the low share, the reason histogram and the newest low ratings.
 */
export async function ratingSummary(range: { from: Date | string; to: Date | string; lowLimit?: number }): Promise<RatingSummary> {
  const from = new Date(range.from);
  const to = new Date(range.to);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to < from) throw new ApiError("Noto'g'ri oraliq", 400);
  const lowLimit = Math.min(Math.max(Math.trunc(range.lowLimit ?? 20) || 20, 1), SUMMARY_RECENT_LOW_MAX);
  const reasonCols = RATING_REASONS.map((r) => `count(*) FILTER (WHERE r.reason = '${r}') AS "r_${r}"`).join(", ");
  const tools = await query<Record<string, string> & { tool_id: string }>(
    `SELECT g.tool_id, count(*)::text AS n, avg(r.stars)::text AS avg,
            count(*) FILTER (WHERE r.stars = 1)::text AS s1, count(*) FILTER (WHERE r.stars = 2)::text AS s2,
            count(*) FILTER (WHERE r.stars = 3)::text AS s3, count(*) FILTER (WHERE r.stars = 4)::text AS s4,
            count(*) FILTER (WHERE r.stars = 5)::text AS s5, ${reasonCols}
       FROM generation_ratings r JOIN generations g ON g.id = r.generation_id
      WHERE r.updated_at >= $1 AND r.updated_at < $2
      GROUP BY g.tool_id
      ORDER BY count(*) DESC, g.tool_id`,
    [from, to],
  );
  const latest = await query<LowRow>(
    `SELECT * FROM (
       SELECT ${LOW_COLUMNS},
              row_number() OVER (PARTITION BY g.tool_id ORDER BY r.updated_at DESC, r.generation_id) AS rn
         FROM generation_ratings r JOIN generations g ON g.id = r.generation_id
        WHERE r.updated_at >= $1 AND r.updated_at < $2 AND r.stars <= ${RATING_LOW_MAX}
     ) x WHERE rn <= ${SUMMARY_LATEST_PER_TOOL}
     ORDER BY updated_at DESC, generation_id`,
    [from, to],
  );
  const recent = await query<LowRow>(
    `SELECT ${LOW_COLUMNS}
       FROM generation_ratings r JOIN generations g ON g.id = r.generation_id
      WHERE r.updated_at >= $1 AND r.updated_at < $2 AND r.stars <= ${RATING_LOW_MAX}
      ORDER BY r.updated_at DESC, r.generation_id
      LIMIT $3`,
    [from, to, lowLimit],
  );

  let count = 0;
  let sum = 0;
  let low = 0;
  const items: ToolRatingSummary[] = tools.map((t) => {
    const distribution = [t.s1, t.s2, t.s3, t.s4, t.s5].map((v) => Number(v ?? 0));
    const n = Number(t.n);
    const lowN = distribution[0]! + distribution[1]! + distribution[2]!;
    count += n;
    sum += distribution.reduce((acc, v, i) => acc + v * (i + 1), 0);
    low += lowN;
    const reasons = Object.fromEntries(RATING_REASONS.map((r) => [r, Number(t[`r_${r}`] ?? 0)])) as Record<RatingReason, number>;
    return {
      toolId: t.tool_id,
      count: n,
      average: round2(Number(t.avg)),
      distribution,
      low: lowN,
      lowShare: n ? round2(lowN / n) : 0,
      reasons,
      latestLow: latest.filter((l) => l.tool_id === t.tool_id).map(toLow),
    };
  });
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    count,
    average: count ? round2(sum / count) : null,
    low,
    tools: items,
    recentLow: recent.map(toLow),
  };
}
