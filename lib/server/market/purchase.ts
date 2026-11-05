import "server-only";
import type { PoolClient } from "pg";
import { fingerprintCode } from "../../market/fingerprint";
import { normalizeText, normalizeUniversity } from "../../market/normalize";
import { holdsItem, purchaseStateOf } from "../../market/purchase-state";
import { PURCHASE_FIELD_KEYS, isMarketTool, requiredPurchaseFields } from "../../market/registry";
import type { MarketCard, MarketCloneValues, MarketStatus, PurchaseFields, PurchaseResponse } from "../../market/types";
import { cleanText, safeSlice } from "../../generation/safe-text";
import { TOOL_BY_ID } from "../../tools";
import type { FormValues, ToolConfig, ToolId } from "../../types";
import { ApiError } from "../api";
import { queryOne, transaction } from "../db";
import { env } from "../env";
import { enqueueGeneration } from "../jobs";
import { log } from "../log";
import { assertCanCreate } from "../mandatory-channels";
import { assertOfferAccepted } from "../oferta";
import { queueLimits } from "../queue-limits";
import { getSetting, getSettingInTx } from "../settings";
import { assertGenerationOpen, idempotencyKeyTaken, insufficientError } from "../submit-generation";
import { isToolOnSale } from "./items";
import { marketPriceInTx } from "./pricing";
import { suggestMarketItems } from "./search";
import { MARKET_ROW_COLUMNS, PURCHASE_FACTS_JOIN, PURCHASE_FACTS_SELECT, getItemRow, isHiddenForReview, isUuid, purchaseFactsOf, type MarketItemRow, type PurchaseFactsRow } from "./store";

/**
 * The market purchase (docs/market/PLAN.md §2.1). Money stays in `enqueueGeneration`: the charge, the buyer's generation
 * row and everything of the purchase (sold counter, caps, purchase row, author reward) commit or roll back as ONE
 * transaction through its `inTx` hook.
 *
 * Every guard in front of the transaction is there for a clear answer; the ones that hold are INSIDE it, after the item
 * row is locked: status, caps, price, and `UNIQUE (item_id, buyer_user_id)`.
 */

const FIELD_MAX = 200;
const COPY_BUDGET_MS = 60_000;

/** `market_purchases.UNIQUE (item_id, buyer_user_id)`. */
const PURCHASE_UNIQUE = "market_purchases_item_id_buyer_user_id_key";

/** Refused inside the transaction, answered after the rollback: building the answer needs other connections. */
class Refusal extends Error {
  constructor(readonly reason: "university_cap" | "already_owned") {
    super(reason);
  }
}

const goneError = (status: MarketStatus): ApiError =>
  status === "sold_out"
    ? new ApiError("Bu ish sotib bo'lindi.", 410, { code: "sold_out" })
    : new ApiError("Bu ish endi sotuvda yo'q.", 410, { code: "gone" });

const priceChanged = (price: number): ApiError =>
  new ApiError(`Narx o'zgardi. Yangi narx: ${price.toLocaleString("uz-UZ")} so'm.`, 409, { code: "price_changed", price });

/** The request's title-page fields: known keys only, cleaned and bounded. */
export function cleanPurchaseFields(raw: unknown): PurchaseFields {
  const out: PurchaseFields = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const src = raw as Record<string, unknown>;
  for (const key of PURCHASE_FIELD_KEYS) {
    const v = src[key];
    if (typeof v !== "string") continue;
    const text = safeSlice(cleanText(v).replace(/\s+/g, " ").trim(), FIELD_MAX);
    if (text) out[key] = text;
  }
  return out;
}

/** 400 `fields_required` when the tool's own required title-page fields are not all there. */
export function assertRequiredFields(toolId: ToolId, fields: PurchaseFields): void {
  const missing = requiredPurchaseFields(toolId).filter((k) => !fields[k as keyof PurchaseFields]);
  if (missing.length) throw new ApiError("Titul sahifasi maydonlarini to'ldiring", 400, { code: "fields_required", missing });
}

/** Key of the (item, university) copy cap; a name made of generic words only is compared whole. */
export const universityKey = (name: string | undefined): string => (name ? normalizeUniversity(name) || normalizeText(name).slice(0, 200) : "");

export const cloneValuesOf = (item: Pick<MarketItemRow, "id" | "language">, fields: PurchaseFields): MarketCloneValues => ({
  ...fields,
  marketItemId: item.id,
  language: item.language,
});

type PurchaseInput = { userId: string; itemId: string; expectedPrice: number; fields: PurchaseFields; idempotencyKey: string };
export type PurchaseOutcome = ({ kind: "queued" } & PurchaseResponse) | { kind: "admission"; error: string; code: string; retryAfterSec: number };

async function ownPurchase(userId: string, itemId: string): Promise<PurchaseFactsRow | null> {
  return queryOne<PurchaseFactsRow>(`SELECT ${PURCHASE_FACTS_SELECT} ${PURCHASE_FACTS_JOIN} WHERE p.item_id = $1 AND p.buyer_user_id = $2`, [itemId, userId]);
}

const alreadyOwned = (row: Pick<PurchaseFactsRow, "id" | "generation_id"> | null): ApiError =>
  new ApiError("Bu ish sizda bor.", 409, { code: "already_owned", generationId: row?.generation_id ?? null, purchaseId: row?.id ?? null });

async function universityCapError(item: Pick<MarketItemRow, "id" | "tool_id" | "title">): Promise<ApiError> {
  const others: MarketCard[] = await suggestMarketItems({ tool: item.tool_id, q: item.title, limit: 4 }).catch(() => []);
  return new ApiError("Bu ish sizning muassasangizda allaqachon olingan — boshqa variantni tanlang.", 409, {
    code: "university_cap",
    suggestions: others.filter((c) => c.id !== item.id).slice(0, 3),
  });
}

/**
 * Everything of the purchase inside the charge transaction. The `UPDATE` both takes the item's row lock and re-checks
 * status + copy cap against the committed row, so two buyers of the last copy run one after the other and the second
 * finds no row. `voidId`: the buyer's earlier purchase, refunded with nothing delivered. The refund already gave its copy
 * back (`release.ts`), so this purchase is an ordinary new sale that takes the row's place under the UNIQUE index.
 */
async function commitPurchase(
  client: PoolClient,
  input: PurchaseInput,
  seen: MarketItemRow,
  price: number,
  originalPrice: number,
  voidId: string | null,
  generationId: string,
): Promise<void> {
  const updated = await client.query<MarketItemRow>(
    `UPDATE market_items SET sold_count = sold_count + 1, updated_at = now()
      WHERE id = $1
        AND status = 'active'
        AND (max_copies IS NULL OR sold_count < max_copies)
        AND COALESCE((quality_json->>'hidden_until_review')::boolean, FALSE) = FALSE
      RETURNING ${MARKET_ROW_COLUMNS}`,
    [input.itemId],
  );
  const item = updated.rows[0];
  if (!item) {
    const now = await getItemRow(input.itemId, client);
    throw goneError(now && (now.status === "sold_out" || (now.max_copies !== null && now.sold_count >= now.max_copies)) ? "sold_out" : "retired");
  }
  if ((await getSettingInTx(client, "market.tools_disabled")).includes(item.tool_id as ToolId)) throw goneError("retired");
  const fresh = await marketPriceInTx(client, item);
  if (item.price_version !== seen.price_version || fresh.price !== price) throw priceChanged(fresh.price);
  if (voidId) {
    const dropped = await client.query("DELETE FROM market_purchases WHERE id = $1 AND buyer_user_id = $2", [voidId, input.userId]);
    if (!dropped.rowCount) throw new Refusal("already_owned");
  }
  const university = universityKey(input.fields.university);
  const cap = await getSettingInTx(client, "market.same_university_cap");
  if (cap > 0 && university) {
    // A refunded purchase gave its slot back with its copy (`release.ts`).
    const taken = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM market_purchases p
        WHERE p.item_id = $1 AND p.university_norm = $2
          AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.kind = 'refund' AND t.reference = p.id::text)`,
      [item.id, university],
    );
    if (Number(taken.rows[0]?.n ?? 0) >= cap) throw new Refusal("university_cap");
  }
  // The purchase id IS the charged generation's id: the ledger link that survives deleting the generation.
  await client.query(
    `INSERT INTO market_purchases (id, item_id, buyer_user_id, generation_id, price, original_price, university_norm, fingerprint)
     VALUES ($1, $2, $3, $1, $4, $5, $6, $7)`,
    [generationId, item.id, input.userId, price, originalPrice, university, fingerprintCode(env.sessionSecret, generationId)],
  );
  await client.query("UPDATE generations SET market_item_id = $2 WHERE id = $1", [generationId, item.id]);
  if (item.max_copies !== null && item.sold_count >= item.max_copies) {
    await client.query("UPDATE market_items SET status = 'sold_out', updated_at = now() WHERE id = $1 AND status = 'active'", [item.id]);
  }
}

function isOwnDuplicate(e: unknown): boolean {
  const err = e as { code?: string; constraint?: string } | null;
  return err?.code === "23505" && err.constraint === PURCHASE_UNIQUE;
}

function assertOnSale(item: MarketItemRow, onSale: boolean): void {
  if (!onSale || isHiddenForReview(item)) throw goneError("retired");
  if (item.status === "active") return;
  throw goneError(item.status);
}

export async function purchaseMarketItem(input: PurchaseInput): Promise<PurchaseOutcome> {
  const { userId, itemId, fields, idempotencyKey } = input;
  const item = isUuid(itemId) ? await getItemRow(itemId) : null;
  // No oracle for what never was public.
  if (!item || item.status === "candidate" || item.status === "rejected" || !isMarketTool(item.tool_id)) throw new ApiError("Topilmadi", 404);
  const tool: ToolConfig | undefined = TOOL_BY_ID[item.tool_id as ToolId];
  if (!tool) throw goneError("retired");
  const values = cloneValuesOf(item, fields) as unknown as FormValues;

  // A replay is a purchase already made: it is answered whatever happened to the item since (a last copy reads sold out now).
  const replay = await idempotencyKeyTaken(userId, idempotencyKey);
  let price = 0;
  let originalPrice = 0;
  let voidId: string | null = null;
  if (!replay) {
    const own = await ownPurchase(userId, itemId);
    if (own) {
      if (holdsItem(purchaseStateOf(purchaseFactsOf(own)))) throw alreadyOwned(own);
      voidId = own.id;
    }
    assertOnSale(item, await isToolOnSale(item.tool_id));
    await assertCanCreate(userId);
    await assertOfferAccepted(userId);
    await assertGenerationOpen(tool.id);
    // From committed rows, not the 15 s settings cache: the transaction below compares against the same source.
    ({ price, originalPrice } = await transaction((client) => marketPriceInTx(client, item)));
    if (input.expectedPrice !== price) throw priceChanged(price);
    assertRequiredFields(tool.id, fields);
  }

  const paidOnly = await getSetting("market.paid_only");
  let result;
  try {
    result = await enqueueGeneration({
      userId,
      toolId: tool.id,
      topic: item.title,
      price,
      format: tool.output,
      values,
      budgetMs: COPY_BUDGET_MS,
      idempotencyKey,
      admission: await queueLimits(),
      paidOnly,
      inTx: (client, generationId) => commitPurchase(client, input, item, price, originalPrice, voidId, generationId),
    });
  } catch (e) {
    if (e instanceof Refusal && e.reason === "university_cap") throw await universityCapError(item);
    if (e instanceof Refusal || isOwnDuplicate(e)) throw alreadyOwned(await ownPurchase(userId, itemId));
    throw e;
  }
  if (!result.ok) {
    if (result.reason === "idempotency_conflict") throw new ApiError("Bu Idempotency-Key boshqa so'rov uchun ishlatilgan — yangi kalit bilan yuboring", 422);
    if (result.reason === "admission") {
      const { code, retryAfterSec, error } = result.decision;
      return { kind: "admission", error, code, retryAfterSec };
    }
    if (result.paidOnly) {
      throw new ApiError(
        `Bu xarid faqat to'langan balans bilan amalga oshadi. Kerak: ${result.required.toLocaleString("uz-UZ")} so'm, to'langan balansingizda: ${result.available.toLocaleString("uz-UZ")} so'm.`,
        402,
        { required: result.required, available: result.available, bonus: result.bonus ?? 0, code: "paid_balance_required", topUp: "/uz/wallet" },
      );
    }
    throw insufficientError(result);
  }
  log("info", result.replayed ? "[market] takroriy xarid" : "[market] xarid", { itemId, genId: result.id, price: result.price, replayed: result.replayed });
  return { kind: "queued", generationId: result.id, price: result.price, replayed: result.replayed };
}
