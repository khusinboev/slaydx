import "server-only";
import type { PoolClient } from "pg";
import { topUpInTx } from "../credits";
import { getSettingInTx } from "../settings";

/**
 * The author's reward (docs/market/PLAN.md M6): bonus so'm, paid in the transaction that COMPLETES the buyer's copy. Not
 * at the charge: a cancelled or failed copy is no sale, so a buy + cancel loop cannot farm it, and the charge transaction
 * (buyer's row, then the item's) never takes a second user's row, which could deadlock two buyers of each other's items.
 *
 * Once per purchase through the ledger reference `market-author:<purchaseId>`: a restored copy completing later pays nothing.
 * An admin refund of a finished copy does not take the reward back: the buyer cannot trigger that, and the sale did happen.
 */
export async function payMarketAuthorRewardInTx(client: PoolClient, generationId: string): Promise<boolean> {
  const percent = await getSettingInTx(client, "market.author_reward_percent");
  if (!(percent > 0)) return false;
  const res = await client.query<{ id: string; price: string; buyer_user_id: string; source_user_id: string | null }>(
    `SELECT p.id, p.price, p.buyer_user_id, m.source_user_id
       FROM market_purchases p JOIN market_items m ON m.id = p.item_id
      WHERE p.generation_id = $1`,
    [generationId],
  );
  const row = res.rows[0];
  if (!row?.source_user_id || String(row.source_user_id) === String(row.buyer_user_id)) return false;
  const reward = Math.floor((Number(row.price) * percent) / 100);
  if (reward <= 0) return false;
  return topUpInTx(client, String(row.source_user_id), { points: reward }, `market-author:${row.id}`, "bonus", "Ishlar bozori: ishingiz sotildi");
}
