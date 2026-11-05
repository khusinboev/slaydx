import "server-only";
import { cleanText, safeSlice } from "../../generation/safe-text";
import { ApiError } from "../api";
import { transaction } from "../db";
import { getMarketItem } from "./items";
import { invalidateMarketCatalogCache } from "./search";

/**
 * «Shikoyat» (docs/market/PLAN.md §9): one report per user per item. Enough COUNTED reports hide the item
 * (`quality_json.hidden_until_review`, the status does not change) until an admin reviews it.
 *
 * Every report is stored and shown to the admin (queue filter «Shikoyatlar», the count on the row). Hiding is what a
 * handful of fresh accounts must not be able to buy: a report counts only from an account older than
 * `REPORT_MIN_ACCOUNT_DAYS`, and at most `REPORTS_PER_DAY` count per item per Tashkent day, so no burst hides a listing
 * in one day; the admin, who sees the reports at once, retires a really harmful item sooner.
 */

export const REPORTS_TO_HIDE = 3;
export const REPORT_MIN_ACCOUNT_DAYS = 3;
export const REPORTS_PER_DAY = 2;
const REASON_MAX = 300;

export async function reportMarketItem(input: { userId: string; itemId: string; reason: string }): Promise<{ reported: boolean; hidden: boolean }> {
  const { userId, itemId } = input;
  if (!(await getMarketItem(itemId, userId))) throw new ApiError("Topilmadi", 404);
  const reason = safeSlice(cleanText(input.reason).trim(), REASON_MAX);
  const out = await transaction(async (client) => {
    const added = await client.query(
      `INSERT INTO market_reports (item_id, user_id, reason) VALUES ($1, $2, $3) ON CONFLICT (item_id, user_id) DO NOTHING`,
      [itemId, userId, reason],
    );
    if (!added.rowCount) return { reported: false, hidden: false };
    const count = await client.query<{ n: string }>(
      `SELECT COALESCE(sum(LEAST(d.n, $2::int)), 0) AS n FROM (
         SELECT count(*) AS n FROM market_reports r JOIN users u ON u.id = r.user_id
          WHERE r.item_id = $1 AND u.created_at <= r.created_at - $3::int * interval '1 day'
          GROUP BY (r.created_at AT TIME ZONE 'Asia/Tashkent')::date
       ) d`,
      [itemId, REPORTS_PER_DAY, REPORT_MIN_ACCOUNT_DAYS],
    );
    if (Number(count.rows[0]?.n ?? 0) < REPORTS_TO_HIDE) return { reported: true, hidden: false };
    await client.query(
      `UPDATE market_items SET quality_json = quality_json || '{"hidden_until_review": true}'::jsonb, updated_at = now() WHERE id = $1`,
      [itemId],
    );
    return { reported: true, hidden: true };
  });
  if (out.hidden) invalidateMarketCatalogCache();
  return out;
}
