import "server-only";
import { ApiError } from "./api";
import { query, queryOne, transaction } from "./db";
import { topUpInTx } from "./credits";
import { getSetting, getSettingInTx } from "./settings";
import { log } from "./log";
import { RATING_BONUS_KEY, RATING_NOTE, checkFeedback, isStars, ratingRef } from "../rating";

/**
 * «Ilovani baholang» (owner request 2026-10-22, docs/program-17/PLAN.md item 9) — the ONE service of
 * the web card, the bot's bonus task and the admin list (CLAUDE.md «Bot va web — bitta servis qatlami»).
 *
 * A user with at least one FINISHED generation (`COMPLETED`) rates the app (1-5 stars) and must write
 * feedback that passes `lib/rating.ts checkFeedback`. The row and the one-time bonus are written in
 * ONE transaction: `app_ratings.user_id` is the primary key (a second submit — even a parallel one —
 * is `already_rated`, never a second bonus) and the credit goes through `credits.topUpInTx` with the
 * unique ledger reference `rating:<userId>`. The reward is the runtime setting `bonus.rating_points`
 * (default 500, 0 = the rating is still stored, nothing is paid).
 */

export type RatingStatus = {
  /** Already rated: the card shows «Rahmat». */
  rated: boolean;
  stars: number | null;
  /** At least one finished generation (the rating needs it). */
  hasFinished: boolean;
  /** Bonus so'm the rating pays (the current setting; the paid amount once rated). */
  rewardPoints: number;
};

export type RatingResult = { stars: number; rewardPoints: number; credited: boolean };

export async function getRatingReward(): Promise<number> {
  return getSetting(RATING_BONUS_KEY);
}

/** The signed-in user's rating state — what the profile card and the bot task read. */
export async function getRatingStatus(userId: string): Promise<RatingStatus> {
  const row = await queryOne<{ stars: number | null; has_finished: boolean; paid: string | null }>(
    `SELECT r.stars,
            EXISTS (SELECT 1 FROM generations g WHERE g.user_id = $1 AND g.status = 'COMPLETED') AS has_finished,
            (SELECT t.points_delta::text FROM transactions t WHERE t.kind = 'bonus' AND t.reference = $2) AS paid
       FROM (SELECT 1) one
       LEFT JOIN app_ratings r ON r.user_id = $1`,
    [userId, ratingRef(userId)],
  );
  const rated = row?.stars != null;
  return {
    rated,
    stars: rated ? Number(row!.stars) : null,
    hasFinished: row?.has_finished === true,
    rewardPoints: rated && row?.paid != null ? Math.max(0, Number(row.paid)) : await getRatingReward(),
  };
}

/**
 * Stores the rating and pays the bonus, atomically. Errors (`ApiError`, Uzbek message, `code` in
 * the JSON): 400 `bad_stars` / feedback codes, 403 `no_generation`, 409 `already_rated`.
 */
export async function submitRating(userId: string, stars: unknown, feedback: unknown): Promise<RatingResult> {
  if (!isStars(stars)) throw new ApiError("Yulduzlar soni 1 dan 5 gacha bo'lishi kerak.", 400, { code: "bad_stars" });
  const check = checkFeedback(feedback);
  if (!check.ok) throw new ApiError(check.message, 400, { code: check.code });

  const result = await transaction(async (client) => {
    // Serialise the user's own submits (and a parallel top-up) before any check.
    const u = await client.query("SELECT 1 FROM users WHERE id = $1 FOR UPDATE", [userId]);
    if (!u.rows[0]) throw new ApiError("Foydalanuvchi topilmadi.", 404, { code: "no_user" });
    const done = await client.query(
      "SELECT 1 FROM generations WHERE user_id = $1 AND status = 'COMPLETED' LIMIT 1",
      [userId],
    );
    if (!done.rows[0]) {
      throw new ApiError("Baholash uchun avval kamida bitta hujjat yarating — tayyor bo'lgach baholay olasiz.", 403, { code: "no_generation" });
    }
    const ins = await client.query(
      `INSERT INTO app_ratings (user_id, stars, feedback) VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO NOTHING RETURNING user_id`,
      [userId, stars, check.text],
    );
    if (!ins.rows[0]) throw new ApiError("Siz ilovani allaqachon baholagansiz. Rahmat!", 409, { code: "already_rated" });
    const points = await getSettingInTx(client, RATING_BONUS_KEY);
    const credited = points > 0 ? await topUpInTx(client, userId, { points }, ratingRef(userId), "bonus", RATING_NOTE) : false;
    return { stars, rewardPoints: credited ? points : 0, credited };
  });
  log("info", "[ratings] baho yozildi", { userId, stars, credited: result.credited, points: result.rewardPoints });
  return result;
}

/* ───────────────────────── Admin (read-only) ───────────────────────── */

export const ADMIN_RATINGS_MAX = 200;

export type AdminRatingItem = { userId: string; name: string; username: string | null; stars: number; feedback: string; createdAt: string };
export type AdminRatings = {
  count: number;
  average: number | null;
  /** Index 0 = 1 star ... index 4 = 5 stars. */
  distribution: number[];
  items: AdminRatingItem[];
};

/** Newest first, at most `limit` rows; the summary covers ALL ratings. No phone numbers. */
export async function listRatings(limit = 100): Promise<AdminRatings> {
  const n = Math.min(Math.max(Math.trunc(limit) || 100, 1), ADMIN_RATINGS_MAX);
  const sum = await queryOne<{ n: string; avg: string | null; d: number[] }>(
    `SELECT count(*)::text AS n, avg(stars)::text AS avg,
            ARRAY[count(*) FILTER (WHERE stars = 1), count(*) FILTER (WHERE stars = 2), count(*) FILTER (WHERE stars = 3),
                  count(*) FILTER (WHERE stars = 4), count(*) FILTER (WHERE stars = 5)]::int[] AS d
       FROM app_ratings`,
  );
  const rows = await query<{ user_id: string; name: string; username: string | null; stars: number; feedback: string; created_at: Date }>(
    `SELECT r.user_id::text AS user_id, u.name, u.username, r.stars, r.feedback, r.created_at
       FROM app_ratings r JOIN users u ON u.id = r.user_id
      ORDER BY r.created_at DESC, r.user_id DESC LIMIT $1`,
    [n],
  );
  return {
    count: Number(sum?.n ?? 0),
    average: sum?.avg == null ? null : Math.round(Number(sum.avg) * 100) / 100,
    distribution: sum?.d ?? [0, 0, 0, 0, 0],
    items: rows.map((r) => ({
      userId: r.user_id,
      name: r.name,
      username: r.username,
      stars: Number(r.stars),
      feedback: r.feedback,
      createdAt: new Date(r.created_at).toISOString(),
    })),
  };
}
