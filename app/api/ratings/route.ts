import { handler, json, limit, readJson, requireUser } from "@/lib/server/api";
import { getRatingStatus, submitRating } from "@/lib/server/ratings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `GET /api/ratings` — the signed-in user's rating state (profile card, bot task): rated / hasFinished / rewardPoints. */
export const GET = handler("ratings/status", async (req) => {
  const { user } = await requireUser(req);
  return json(await getRatingStatus(user.id), { headers: { "Cache-Control": "private, no-store" } });
});

/**
 * `POST /api/ratings` `{stars: 1..5, feedback}` — rates the app and pays the one-time bonus
 * (`lib/server/ratings.ts submitRating`: validation, finished-generation check, one row per user and the
 * credit in one transaction). Errors carry `{error, code}`: 400 bad_stars / too_short / ..., 403 no_generation, 409 already_rated.
 */
export const POST = handler("ratings/submit", async (req) => {
  const { user } = await requireUser(req);
  await limit(`rating:${user.id}`, 10, 600);
  const body = await readJson<Record<string, unknown>>(req, 8 * 1024);
  return json(await submitRating(user.id, body.stars, body.feedback), { headers: { "Cache-Control": "private, no-store" } });
});
