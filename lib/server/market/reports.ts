import "server-only";
import { cleanText, safeSlice } from "../../generation/safe-text";
import { ApiError } from "../api";
import { transaction } from "../db";
import { getMarketItem } from "./items";
import { invalidateMarketCatalogCache } from "./search";

/**
 * «Shikoyat» (docs/market/PLAN.md §9): one report per user per item; the third distinct report hides the item
 * (`quality_json.hidden_until_review`, the status does not change) until an admin reviews it.
 */

export const REPORTS_TO_HIDE = 3;
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
    const count = await client.query<{ n: string }>("SELECT count(*) AS n FROM market_reports WHERE item_id = $1", [itemId]);
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
