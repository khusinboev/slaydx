import "server-only";
import { purchaseStateOf, type PurchaseFacts } from "../../market/purchase-state";
import type { PurchaseState } from "../../market/types";
import { cleanText, safeSlice } from "../../generation/safe-text";
import { ApiError } from "../api";
import { transaction } from "../db";
import { invalidateMarketCatalogCache } from "./search";
import { isUuid, purchaseFactsOf, type PurchaseFactsRow } from "./store";

/**
 * Buyer ratings (docs/market/PLAN.md §2.3): 1–5 stars and an optional short text, once per purchase, editable for 7
 * days, open once the copy is COMPLETED and at least 10 minutes old. A refund or an abuse flag closes it. The item's
 * `rating_sum` / `rating_count` move in the same transaction as the rating row.
 */

export const RATING_MIN_AGE_MIN = 10;
export const RATING_EDIT_DAYS = 7;
export const RATING_TEXT_MAX = 300;

/** The buyer may rate now: a copy he holds, old enough, inside the edit window when already rated. */
export function ratingOpen(f: PurchaseFacts & { state: PurchaseState; finishedAt: Date | null; ratedAt: Date | null }, now = Date.now()): boolean {
  if (f.state !== "ready" || f.abuseFlag || f.generationStatus !== "COMPLETED" || !f.finishedAt) return false;
  if (now - new Date(f.finishedAt).getTime() < RATING_MIN_AGE_MIN * 60_000) return false;
  return !f.ratedAt || now - new Date(f.ratedAt).getTime() <= RATING_EDIT_DAYS * 86_400_000;
}

export function parseRating(body: { stars?: unknown; text?: unknown }): { stars: number; text: string } {
  const stars = body.stars;
  if (typeof stars !== "number" || !Number.isInteger(stars) || stars < 1 || stars > 5) throw new ApiError("Baho 1 dan 5 gacha bo'lishi kerak", 400);
  if (body.text !== undefined && typeof body.text !== "string") throw new ApiError("Izoh noto'g'ri", 400);
  const text = cleanText(body.text ?? "").trim();
  if (text.length > RATING_TEXT_MAX) throw new ApiError(`Izoh ${RATING_TEXT_MAX} belgidan oshmasin`, 400);
  return { stars, text: safeSlice(text, RATING_TEXT_MAX) };
}

type LockedRow = PurchaseFactsRow & { item_id: string; finished_at: Date | null; old_stars: number | null; rated_at: Date | null };

export async function ratePurchase(input: { userId: string; purchaseId: string; stars: number; text: string }): Promise<{ stars: number; text: string }> {
  const { userId, purchaseId, stars, text } = input;
  if (!isUuid(purchaseId)) throw new ApiError("Topilmadi", 404);
  await transaction(async (client) => {
    // The purchase row lock serialises two tabs of one buyer: the counters move once per vote.
    const lock = await client.query<{ id: string }>("SELECT id FROM market_purchases WHERE id = $1 AND buyer_user_id = $2 FOR UPDATE", [purchaseId, userId]);
    if (!lock.rows[0]) throw new ApiError("Topilmadi", 404);
    const res = await client.query<LockedRow>(
      `SELECT p.id, p.item_id, p.price, p.generation_id, p.abuse_flag, g.status AS generation_status, g.files_purged_at IS NOT NULL AS purged, g.finished_at,
              EXISTS (SELECT 1 FROM transactions t WHERE t.kind = 'refund' AND t.reference = p.id::text) AS refunded,
              r.stars AS old_stars, r.created_at AS rated_at
         FROM market_purchases p
         LEFT JOIN generations g ON g.id = p.generation_id
         LEFT JOIN market_ratings r ON r.purchase_id = p.id
        WHERE p.id = $1`,
      [purchaseId],
    );
    const row = res.rows[0]!;
    const facts = purchaseFactsOf(row);
    const state = purchaseStateOf(facts);
    if (!ratingOpen({ ...facts, state, finishedAt: row.finished_at, ratedAt: row.rated_at })) {
      if (row.rated_at && state === "ready") throw new ApiError("Bahoni o'zgartirish muddati tugagan.", 409, { code: "rating_closed" });
      throw new ApiError("Baho berish hozircha ochiq emas.", 409, { code: "rating_not_open" });
    }
    await client.query(
      `INSERT INTO market_ratings (purchase_id, stars, text) VALUES ($1, $2, $3)
       ON CONFLICT (purchase_id) DO UPDATE SET stars = EXCLUDED.stars, text = EXCLUDED.text, updated_at = now()`,
      [purchaseId, stars, text],
    );
    const first = row.old_stars === null;
    await client.query("UPDATE market_items SET rating_sum = rating_sum + $2, rating_count = rating_count + $3, updated_at = now() WHERE id = $1", [
      row.item_id,
      stars - (row.old_stars ?? 0),
      first ? 1 : 0,
    ]);
  });
  invalidateMarketCatalogCache();
  return { stars, text };
}
