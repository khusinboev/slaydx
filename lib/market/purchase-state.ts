import type { PurchaseState } from "./types";

/**
 * The state of one purchase, from the facts in the database. Pure: the item page, «Xaridlarim», the purchase and the
 * restore all read this one function, so a screen can never offer what the server refuses.
 *
 * MONEY RULE. `market_purchases.id` IS the id of the generation that carried the charge, so `transactions.reference =
 * purchase id` finds the refund for ever, even after the buyer deleted the generation (`generation_id` → NULL). Without
 * that link «refund, delete, restore» would be a free copy.
 *
 * A paid job that failed is refunded by the worker, so restoring it for free would give the file AND the money. It
 * reads `refund_pending` until the refund lands, then `void`: the buyer has his money and may buy again. A restored copy
 * carries no charge, so a failed one is simply restored again.
 */

export type PurchaseFacts = {
  /** Equals the id of the generation that was charged. */
  id: string;
  price: number;
  generationId: string | null;
  /** `null`: the generation no longer exists. */
  generationStatus: string | null;
  /** The bonus-retention sweep removed the files. */
  purged: boolean;
  /** A `refund` ledger row with `reference = id` exists. */
  refunded: boolean;
  abuseFlag: string | null;
};

const LIVE: ReadonlySet<string> = new Set(["QUEUED", "IN_PROGRESS", "COMPLETED"]);

export function purchaseStateOf(f: PurchaseFacts): PurchaseState {
  const exists = Boolean(f.generationId) && f.generationStatus !== null;
  const live = exists && LIVE.has(f.generationStatus!) && !f.purged;
  if (f.refunded) {
    if (live) return "refunded";
    return f.abuseFlag ? "blocked" : "void";
  }
  if (live) return "ready";
  if (f.abuseFlag) return "blocked";
  if (exists && !f.purged && f.generationId === f.id && f.price > 0) return "refund_pending";
  return "restorable";
}

/** Everything but `void` answers `already_owned`: a void purchase holds neither the money nor a file. */
export const holdsItem = (state: PurchaseState): boolean => state !== "void";
