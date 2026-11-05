import "server-only";
import { purchaseStateOf } from "../../market/purchase-state";
import type { MarketPurchaseView, PurchaseFields } from "../../market/types";
import { TOOL_BY_ID } from "../../tools";
import type { FormValues, ToolId } from "../../types";
import { ApiError } from "../api";
import { query, queryOne } from "../db";
import { enqueueGeneration } from "../jobs";
import { queueLimits } from "../queue-limits";
import { previewUrl } from "./items";
import { assertRequiredFields, cleanPurchaseFields, cloneValuesOf, universityKey } from "./purchase";
import { PURCHASE_FACTS_JOIN, PURCHASE_FACTS_SELECT, getItemRow, isUuid, purchaseFactsOf, type PurchaseFactsRow } from "./store";
import { RATING_EDIT_DAYS, ratingOpen } from "./ratings";

/**
 * «Xaridlarim» and the free restore (docs/market/PLAN.md §2.3): the buyer who paid and lost his copy (deleted, purged by
 * retention, a restored copy that failed) gets a new one from the item's stored document. `purchaseStateOf` decides who
 * that is: a refunded purchase, a job still waiting for its refund and an abuse flag get nothing for free.
 *
 * A restored generation has price 0 and no ledger row: the money stays on the purchase, whose id is the charged id.
 */

const LIST_MAX = 100;

export type RestoreOutcome =
  | { kind: "queued"; generationId: string; restored: boolean }
  | { kind: "admission"; error: string; code: string; retryAfterSec: number };

/** Lost its generation mid-restore: another request of the same buyer got there first. */
class RestoreRaced extends Error {
  constructor(readonly generationId: string | null) {
    super("market restore raced");
  }
}

async function purchaseOf(purchaseId: string, userId: string): Promise<(PurchaseFactsRow & { item_id: string; university_norm: string }) | null> {
  if (!isUuid(purchaseId)) return null;
  return queryOne(
    `SELECT ${PURCHASE_FACTS_SELECT}, p.item_id, p.university_norm ${PURCHASE_FACTS_JOIN} WHERE p.id = $1 AND p.buyer_user_id = $2`,
    [purchaseId, userId],
  );
}

/** The title page of the lost copy when its row still exists; `fields` of the request fill the rest. */
async function lastFields(generationId: string | null, userId: string): Promise<PurchaseFields> {
  if (!generationId) return {};
  const row = await queryOne<{ values_json: FormValues }>("SELECT values_json FROM generations WHERE id = $1 AND user_id = $2", [generationId, userId]);
  return cleanPurchaseFields(row?.values_json);
}

export async function restorePurchase(input: { userId: string; purchaseId: string; fields: PurchaseFields }): Promise<RestoreOutcome> {
  const { userId, purchaseId } = input;
  const row = await purchaseOf(purchaseId, userId);
  if (!row) throw new ApiError("Topilmadi", 404);
  const state = purchaseStateOf(purchaseFactsOf(row));
  if (state === "ready") return { kind: "queued", generationId: row.generation_id!, restored: false };
  if (state === "blocked") throw new ApiError("Bu xarid bo'yicha tiklash yopilgan.", 403, { code: "restore_blocked" });
  if (state === "refunded" || state === "void") throw new ApiError("Bu xarid puli qaytarilgan — qayta tiklab bo'lmaydi.", 409, { code: "refunded" });
  if (state === "refund_pending") throw new ApiError("Pul qaytarilmoqda. Keyin ishni qayta sotib olishingiz mumkin.", 409, { code: "refund_pending" });

  const item = await getItemRow(row.item_id);
  const tool = item ? TOOL_BY_ID[item.tool_id as ToolId] : undefined;
  if (!item || !tool) throw new ApiError("Topilmadi", 404);
  const fields = { ...(await lastFields(row.generation_id, userId)), ...input.fields };
  assertRequiredFields(tool.id, fields);
  // The copy cap counted this university: a restore is not a way to hand the same work to another one.
  if (row.university_norm && universityKey(fields.university) !== row.university_norm) {
    throw new ApiError("Muassasa nomi xariddagidan farq qiladi.", 400, { code: "university_changed" });
  }

  const seen = row.generation_id;
  try {
    const result = await enqueueGeneration({
      userId,
      toolId: tool.id,
      topic: item.title,
      price: 0,
      format: tool.output,
      values: cloneValuesOf(item, fields) as unknown as FormValues,
      budgetMs: 60_000,
      admission: await queueLimits(),
      inTx: async (client, generationId) => {
        const locked = await client.query<{ generation_id: string | null; abuse_flag: string | null }>("SELECT generation_id, abuse_flag FROM market_purchases WHERE id = $1 FOR UPDATE", [purchaseId]);
        const now = locked.rows[0];
        if (!now || now.generation_id !== seen) throw new RestoreRaced(now?.generation_id ?? null);
        // An admin refund or flag that landed after the read above: the row lock makes this check final for flags,
        // and the ledger row of a refund is visible here once committed.
        const refunded = await client.query("SELECT 1 FROM transactions WHERE kind = 'refund' AND reference = $1", [purchaseId]);
        if (now.abuse_flag || refunded.rows[0]) throw new RestoreRaced(seen);
        await client.query("UPDATE market_purchases SET generation_id = $2, restored_at = now() WHERE id = $1", [purchaseId, generationId]);
        await client.query("UPDATE generations SET market_item_id = $2 WHERE id = $1", [generationId, item.id]);
      },
    });
    if (result.ok) return { kind: "queued", generationId: result.id, restored: true };
    if (result.reason === "admission") {
      const { code, retryAfterSec, error } = result.decision;
      return { kind: "admission", error, code, retryAfterSec };
    }
    // A price of 0 charges nothing and no key is sent: the other refusals cannot happen.
    throw new Error(`market restore: unexpected ${result.reason}`);
  } catch (e) {
    if (!(e instanceof RestoreRaced)) throw e;
    const winner = await purchaseOf(purchaseId, userId);
    if (winner && purchaseStateOf(purchaseFactsOf(winner)) === "ready") return { kind: "queued", generationId: winner.generation_id!, restored: false };
    throw new ApiError("Tiklab bo'lmadi. Sahifani yangilang.", 409, { code: "restore_blocked" });
  }
}

type PurchaseListRow = PurchaseFactsRow & {
  item_id: string;
  tool_id: string;
  title: string;
  preview_version: number;
  original_price: string;
  created_at: Date;
  finished_at: Date | null;
  stars: number | null;
  rating_text: string | null;
  rated_at: Date | null;
};

/** «Xaridlarim», newest first. Facts of the buyer's own purchases only; the document is nowhere in this query. */
export async function listMyPurchases(userId: string): Promise<MarketPurchaseView[]> {
  const rows = await query<PurchaseListRow>(
    `SELECT ${PURCHASE_FACTS_SELECT}, p.item_id, p.original_price, p.created_at, m.tool_id, m.title, m.preview_version,
            g.finished_at, r.stars, r.text AS rating_text, r.created_at AS rated_at
       ${PURCHASE_FACTS_JOIN}
       JOIN market_items m ON m.id = p.item_id
       LEFT JOIN market_ratings r ON r.purchase_id = p.id
      WHERE p.buyer_user_id = $1
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT $2`,
    [userId, LIST_MAX],
  );
  return rows.map((r) => {
    const facts = purchaseFactsOf(r);
    const state = purchaseStateOf(facts);
    const editableUntil = r.rated_at ? new Date(new Date(r.rated_at).getTime() + RATING_EDIT_DAYS * 86_400_000) : null;
    return {
      id: r.id,
      itemId: r.item_id,
      toolId: r.tool_id as ToolId,
      title: r.title,
      cover: previewUrl(r.item_id, 1, r.preview_version),
      price: Number(r.price),
      originalPrice: Number(r.original_price),
      createdAt: new Date(r.created_at).toISOString(),
      generationId: r.generation_id,
      generationStatus: r.generation_status,
      state,
      canRestore: state === "restorable",
      canRate: ratingOpen({ ...facts, state, finishedAt: r.finished_at, ratedAt: r.rated_at }),
      rating: r.stars === null ? null : { stars: r.stars, text: r.rating_text ?? "", editableUntil: editableUntil!.toISOString() },
    };
  });
}
