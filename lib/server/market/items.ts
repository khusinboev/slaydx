import "server-only";
import { readablePages } from "../../market/preview-policy";
import { isDeckTool, isMarketTool, requiredPurchaseFields } from "../../market/registry";
import type { MarketCard, MarketItemView } from "../../market/types";
import { TOOL_BY_ID } from "../../tools";
import type { ToolId } from "../../types";
import { query, queryOne } from "../db";
import { adapterFor, type RenderedFile } from "../edit-adapters";
import { rateLimit } from "../ratelimit";
import { getSetting } from "../settings";
import { marketPriceForItem, type MarketPricingConfig } from "./pricing";
import { holdsItem, purchaseStateOf } from "../../market/purchase-state";
import { PURCHASE_FACTS_JOIN, PURCHASE_FACTS_SELECT, purchaseFactsOf, type PurchaseFactsRow } from "./store";
import { getItemDoc, getItemRow, isHiddenForReview, isUuid, marketAssetResolver, PUBLIC_STATUSES, type MarketItemRow } from "./store";

/**
 * Item-level read services of the market (docs/market/PLAN.md §5, §3): the public projections. A card and an item view
 * are built ONLY from `MarketItemRow`, which has no `doc_json`, so no code path here can return the body.
 */

/** Ratings are shown only from this many votes (§2.3). */
export const RATING_MIN_VOTES = 3;
/** Debounce of the view counter per (viewer, item): one hour. */
const VIEW_WINDOW_SEC = 3600;

export const marketEnabled = (): Promise<boolean> => getSetting("market.enabled");

/** Tools sold right now: the registry minus `market.tools_disabled`. */
export async function isToolOnSale(toolId: string): Promise<boolean> {
  if (!isMarketTool(toolId)) return false;
  return !(await getSetting("market.tools_disabled")).includes(toolId);
}

export const previewUrl = (id: string, page: number, version: number): string => `/api/market/items/${id}/preview/${page}?v=${version}`;

/** Pages rendered as readable previews of an item. */
export async function previewPagesOf(toolId: string): Promise<number> {
  const n = await getSetting("market.preview_pages");
  return isDeckTool(toolId) ? n + 1 : n;
}

export function ratingOf(row: Pick<MarketItemRow, "rating_sum" | "rating_count">): MarketCard["rating"] {
  if (row.rating_count < RATING_MIN_VOTES) return null;
  return { avg: Math.round((row.rating_sum / row.rating_count) * 10) / 10, count: row.rating_count };
}

export async function toCard(row: MarketItemRow, cfg?: MarketPricingConfig): Promise<MarketCard> {
  const { price, originalPrice } = await marketPriceForItem(row, cfg);
  return {
    id: row.id,
    toolId: row.tool_id as ToolId,
    title: row.title,
    summary: row.summary,
    subject: row.subject,
    level: row.level,
    language: row.language,
    pages: row.pages,
    slideCount: row.slide_count,
    price,
    originalPrice,
    soldCount: row.sold_count,
    rating: ratingOf(row),
    cover: previewUrl(row.id, 1, row.preview_version),
    // Anything not on sale reads «Sotuvda yo'q» to the owner who still reaches it (§9): the public shape has two states.
    status: row.status === "active" ? "active" : "sold_out",
  };
}

async function ownedBy(itemId: string, userId: string | null): Promise<MarketItemView["owned"]> {
  if (!userId) return null;
  const row = await queryOne<PurchaseFactsRow>(
    `SELECT ${PURCHASE_FACTS_SELECT} ${PURCHASE_FACTS_JOIN} WHERE p.item_id = $1 AND p.buyer_user_id = $2`,
    [itemId, userId],
  );
  // A refunded purchase without a file holds nothing: the page offers the item for sale again.
  if (!row || !holdsItem(purchaseStateOf(purchaseFactsOf(row)))) return null;
  return { generationId: row.generation_id, purchaseId: row.id };
}

/**
 * The item page. `null` (404, no status oracle) for an unknown id and for an item not publicly visible; a buyer keeps
 * reaching his item whatever happened to it (retired, tool withdrawn), with `owned` set.
 */
export async function getMarketItem(id: string, viewerUserId: string | null): Promise<MarketItemView | null> {
  if (!isUuid(id)) return null;
  const row = await getItemRow(id);
  if (!row) return null;
  const owned = await ownedBy(id, viewerUserId);
  const visible = PUBLIC_STATUSES.includes(row.status) && !isHiddenForReview(row) && (await isToolOnSale(row.tool_id));
  if (!visible && !owned) return null;
  const card = await toCard(row);
  const tool = TOOL_BY_ID[row.tool_id as ToolId];
  return {
    ...card,
    status: visible ? card.status : "sold_out",
    outline: row.outline_json,
    previewPages: await readableOf(row),
    totalPages: row.pages ?? row.slide_count,
    owned,
    requiredFields: tool ? requiredPurchaseFields(tool.id) : [],
    createTool: { slug: tool?.slug ?? row.tool_id, topic: row.title },
  };
}

/** Readable pages the viewer gets: what the built set really holds, else the same rule over the listing's own count. */
async function readableOf(row: MarketItemRow): Promise<number> {
  const built = await queryOne<{ n: string }>("SELECT count(*) AS n FROM market_previews WHERE item_id = $1 AND version = $2 AND kind = 'page'", [row.id, row.preview_version]);
  const n = Number(built?.n ?? 0);
  return n > 0 ? n : readablePages(await previewPagesOf(row.tool_id), row.pages ?? row.slide_count);
}

/**
 * Counts one view per (viewer, item) per window; a failure never touches the page. Returns whether it was counted.
 * The default window is an hour; a viewer without a cookie is keyed by IP for a day, or every request would be a new viewer.
 */
export async function recordMarketView(itemId: string, viewerKey: string, windowSec = VIEW_WINDOW_SEC): Promise<boolean> {
  if (!isUuid(itemId)) return false;
  try {
    const gate = await rateLimit(`market-view:${itemId}:${viewerKey}`, 1, windowSec);
    if (!gate.ok) return false;
    const updated = await query<{ id: string }>("UPDATE market_items SET view_count = view_count + 1 WHERE id = $1 AND status = ANY($2) RETURNING id", [itemId, PUBLIC_STATUSES]);
    if (!updated.length) return false;
    await query(
      `INSERT INTO market_views (item_id, day, views) VALUES ($1, (now() AT TIME ZONE 'Asia/Tashkent')::date, 1)
       ON CONFLICT (item_id, day) DO UPDATE SET views = market_views.views + 1`,
      [itemId],
    );
    return true;
  } catch {
    return false;
  }
}

export const safeFileName = (title: string, ext: string): string => `${title.replace(/[^\p{L}\p{N}\- ]/gu, "").replace(/\s+/g, " ").trim().slice(0, 60) || "ish"}.${ext}`;

/**
 * The neutral file of an item: the sanitised document through the tool's own renderer, images from the item's own
 * copies. Used by approval (WP-D stores it with `putNeutralFile` in the same transaction) and by the preview builder.
 */
export async function renderNeutralFile(row: Pick<MarketItemRow, "id" | "tool_id" | "title">): Promise<RenderedFile> {
  const adapter = adapterFor(row.tool_id);
  if (!adapter) throw new Error(`market: no adapter for ${row.tool_id}`);
  const doc = await getItemDoc(row.id);
  if (!doc?.meta) throw new Error(`market: item ${row.id} has no document`);
  const ext = TOOL_BY_ID[row.tool_id as ToolId]?.output === "pptx" ? "pptx" : "docx";
  return adapter.render(
    { id: row.id, userId: "0", doc, fileName: safeFileName(row.title, ext), resolveImage: marketAssetResolver(row.id) },
    {},
  );
}
