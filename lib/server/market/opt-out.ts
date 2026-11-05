import "server-only";
import { queryOne, transaction } from "../db";

/**
 * «Mening ishlarim bozorga chiqmasin» (docs/market/PLAN.md M7, §1.3): the one service the profile page and the bot call.
 * Opting out removes this user's waiting `candidate` rows at once; `active` listings hold no PII and stay (admin retires
 * them by hand). The candidate scan reads `market_opt_out`, so nothing new enters.
 */

export async function getMarketOptOut(userId: string): Promise<boolean> {
  const row = await queryOne<{ market_opt_out: boolean }>("SELECT market_opt_out FROM users WHERE id = $1", [userId]);
  return row?.market_opt_out === true;
}

export async function setMarketOptOut(userId: string, optOut: boolean): Promise<{ optOut: boolean; candidatesRemoved: number }> {
  return transaction(async (client) => {
    await client.query("UPDATE users SET market_opt_out = $2, updated_at = now() WHERE id = $1", [userId, optOut]);
    if (!optOut) return { optOut, candidatesRemoved: 0 };
    const gone = await client.query("DELETE FROM market_items WHERE source_user_id = $1 AND status = 'candidate'", [userId]);
    return { optOut, candidatesRemoved: gone.rowCount ?? 0 };
  });
}
