import { queryOne } from "./db";
import { firstTopupRef } from "../topup-bonus";

/**
 * Whether the user already got the first top-up bonus (and how much). Contract for the bot's
 * «Sizning bonuslaringiz» screen; package P2 pays it inside the payment transaction.
 */
export async function firstTopupStatus(userId: string): Promise<{ paid: boolean; points: number }> {
  const row = await queryOne<{ p: string }>(
    "SELECT points_delta::text AS p FROM transactions WHERE user_id = $1 AND kind = 'bonus' AND reference = $2",
    [userId, firstTopupRef(userId)],
  );
  return row ? { paid: true, points: Number(row.p) } : { paid: false, points: 0 };
}
