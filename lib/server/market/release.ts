import "server-only";
import type { PoolClient } from "pg";
import { isUuid } from "./store";

/**
 * A full refund of a purchase gives its copy back to the market (docs/market/PLAN.md §2.3). The ONE place: both refund
 * functions (`credits.ts refundRatio`, `refund-tx.ts refundInTx`) call it in the transaction that writes the refund row,
 * so every path (cancel, worker FAILED, queue TTL, reconcile, admin refund) releases, and exactly once: the ledger holds
 * one `refund` row per reference (`transactions_ref_idx`).
 *
 * Without this a buy + cancel kept the copy and the university slot for free: one account could sell an item out.
 *
 * `reference` is the purchase id for the charged generation (`market_purchases.id` = that generation's id). Any other
 * reference, a restored copy included (it has no charge, so no refund row), finds no purchase and changes nothing.
 * Locks: the buyer's row is already held, then the item's: the purchase takes them in the same order.
 *
 * The refunded buyer's rating leaves with the sale, or a later rebuy (which deletes the row, cascading the rating) would
 * leave stale counters on the item.
 */
export async function releaseMarketCopyInTx(client: Pick<PoolClient, "query">, reference: string): Promise<boolean> {
  if (!isUuid(reference)) return false;
  const purchase = await client.query<{ item_id: string }>("SELECT item_id FROM market_purchases WHERE id = $1", [reference]);
  const itemId = purchase.rows[0]?.item_id;
  if (!itemId) return false;
  const rating = await client.query<{ stars: number }>("DELETE FROM market_ratings WHERE purchase_id = $1 RETURNING stars", [reference]);
  const stars = rating.rows[0]?.stars ?? 0;
  await client.query(
    `UPDATE market_items
        SET sold_count = GREATEST(sold_count - 1, 0),
            status = CASE WHEN status = 'sold_out' AND (max_copies IS NULL OR sold_count - 1 < max_copies) THEN 'active' ELSE status END,
            rating_sum = rating_sum - $2,
            rating_count = GREATEST(rating_count - $3, 0),
            updated_at = now()
      WHERE id = $1`,
    [itemId, stars, rating.rows.length],
  );
  return true;
}
