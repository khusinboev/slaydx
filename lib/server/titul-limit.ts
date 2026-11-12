import "server-only";
import { ApiError } from "./api";
import { queryOne } from "./db";
import { getSetting } from "./settings";

/**
 * Abuse guard of the FREE «Titul» tool: at most `title.daily_limit` title pages
 * per user per Tashkent day (0 = unlimited). No table of its own — the count is
 * the user's `title-page` generations created since Tashkent midnight, read at
 * submit (`prepareGeneration`), before anything is queued. Two requests racing
 * past the count can exceed the cap by the burst limit at most (5 per minute in
 * the route), which is harmless for a free template render.
 */

export const TITUL_TOOL_ID = "title-page";

export async function titulUsedToday(userId: string): Promise<number> {
  const row = await queryOne<{ n: number }>(
    `SELECT count(*)::int AS n FROM generations
      WHERE user_id = $1 AND tool_id = $2
        AND created_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Tashkent') AT TIME ZONE 'Asia/Tashkent')`,
    [userId, TITUL_TOOL_ID],
  );
  return row?.n ?? 0;
}

export function titulLimitMessage(limit: number): string {
  return `Bugun ${limit} ta bepul titul yaratdingiz — bu kunlik chegara. Ertaga (Toshkent vaqti bilan 00:00 dan keyin) yana yaratishingiz mumkin.`;
}

/** 429 `daily_limit` when the user reached today's cap; nothing is charged or queued. */
export async function assertTitulDailyLimit(userId: string): Promise<void> {
  const limit = await getSetting("title.daily_limit");
  if (!limit || limit <= 0) return;
  if ((await titulUsedToday(userId)) >= limit) {
    throw new ApiError(titulLimitMessage(limit), 429, { code: "daily_limit", limit });
  }
}
