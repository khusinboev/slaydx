import "server-only";
import type { PoolClient } from "pg";
import type { ImageBytes } from "../../generation/slide-images";
import type { AcademicDoc } from "../../generation/types";
import type { PurchaseFacts } from "../../market/purchase-state";
import { MARKET_ASSET_PREFIX, type MarketLevel, type MarketStatus, type MarketSubjectId, type PiiFlag } from "../../market/types";
import { query, queryOne } from "../db";

/**
 * The market's table access (docs/market/PLAN.md §8). `MARKET_ROW_COLUMNS` deliberately leaves `doc_json` out: a public
 * read path cannot hand the body to a route by accident; only `getItemDoc` (admin, worker) touches it.
 */

export type MarketItemRow = {
  id: string;
  source_generation_id: string | null;
  source_user_id: string | null;
  tool_id: string;
  status: MarketStatus;
  title: string;
  summary: string;
  subject: MarketSubjectId;
  level: MarketLevel;
  language: string;
  pages: number | null;
  slide_count: number | null;
  params_json: Record<string, unknown>;
  outline_json: string[];
  pii_flags: PiiFlag[];
  quality_json: { score?: number; parts?: unknown[]; hidden_until_review?: boolean };
  topic_norm: string;
  original_price: string;
  price_override: string | null;
  price_version: number;
  max_copies: number | null;
  sold_count: number;
  view_count: string;
  rating_sum: number;
  rating_count: number;
  preview_version: number;
  reject_reason: string | null;
  created_at: Date;
  approved_at: Date | null;
  retired_at: Date | null;
};

/** Every column a read path may see. `doc_json` and `search_text` are absent on purpose. */
export const MARKET_ROW_COLUMNS = `id, source_generation_id, source_user_id, tool_id, status, title, summary, subject, level, language, pages, slide_count,
  params_json, outline_json, pii_flags, quality_json, topic_norm, original_price, price_override, price_version, max_copies, sold_count,
  view_count, rating_sum, rating_count, preview_version, reject_reason, created_at, approved_at, retired_at`;

/** An item reachable from the public catalog: a `?v=` URL of a hidden or retired item answers 404 like an unknown id. */
export const PUBLIC_STATUSES: readonly MarketStatus[] = ["active", "sold_out"];

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

export const isHiddenForReview = (row: Pick<MarketItemRow, "quality_json">): boolean => row.quality_json?.hidden_until_review === true;

export async function getItemRow(id: string, client?: Pick<PoolClient, "query">): Promise<MarketItemRow | null> {
  if (!isUuid(id)) return null;
  const sql = `SELECT ${MARKET_ROW_COLUMNS} FROM market_items WHERE id = $1`;
  if (client) return ((await client.query<MarketItemRow>(sql, [id])).rows[0] as MarketItemRow | undefined) ?? null;
  return (await queryOne<MarketItemRow>(sql, [id])) ?? null;
}

/** The sanitised document: for the admin drawer, the neutral render and the worker's clone. Never for a public route. */
export async function getItemDoc(id: string): Promise<AcademicDoc | null> {
  if (!isUuid(id)) return null;
  const row = await queryOne<{ doc_json: AcademicDoc }>("SELECT doc_json FROM market_items WHERE id = $1", [id]);
  return row?.doc_json ?? null;
}

export type MarketAsset = { assetId: string; mime: string; bytes: Buffer };

export async function getItemAssets(itemId: string): Promise<MarketAsset[]> {
  const rows = await query<{ asset_id: string; mime: string; bytes: Buffer }>("SELECT asset_id, mime, bytes FROM market_assets WHERE item_id = $1", [itemId]);
  return rows.map((r) => ({ assetId: r.asset_id, mime: r.mime, bytes: r.bytes }));
}

/** `market-asset://<id>` → `data:` URL of the bytes copied at candidate creation; only this item's assets resolve. */
export function marketAssetResolver(itemId: string): (url: string) => Promise<ImageBytes | null> {
  return async (url) => {
    if (!url.startsWith(MARKET_ASSET_PREFIX)) return null;
    const assetId = url.slice(MARKET_ASSET_PREFIX.length);
    const row = await queryOne<{ mime: string; bytes: Buffer }>("SELECT mime, bytes FROM market_assets WHERE item_id = $1 AND asset_id = $2", [itemId, assetId]);
    if (!row) return null;
    const type: "jpg" | "png" = row.mime === "image/png" ? "png" : "jpg";
    const mime = type === "png" ? "image/png" : "image/jpeg";
    return { data: `${mime};base64,${row.bytes.toString("base64")}`, type };
  };
}

/** The columns behind `purchaseStateOf`; alias `p` is `market_purchases`. */
export const PURCHASE_FACTS_SELECT = `p.id, p.price, p.generation_id, p.abuse_flag, g.status AS generation_status, g.files_purged_at IS NOT NULL AS purged,
  EXISTS (SELECT 1 FROM transactions t WHERE t.kind = 'refund' AND t.reference = p.id::text) AS refunded`;
export const PURCHASE_FACTS_JOIN = "FROM market_purchases p LEFT JOIN generations g ON g.id = p.generation_id";

export type PurchaseFactsRow = {
  id: string;
  price: string;
  generation_id: string | null;
  abuse_flag: string | null;
  generation_status: string | null;
  purged: boolean | null;
  refunded: boolean;
};

export const purchaseFactsOf = (r: PurchaseFactsRow): PurchaseFacts => ({
  id: r.id,
  price: Number(r.price),
  generationId: r.generation_id,
  generationStatus: r.generation_status,
  purged: r.purged === true,
  refunded: r.refunded,
  abuseFlag: r.abuse_flag,
});

export type NeutralFile = { fileName: string; mime: string; bytes: Buffer };

/** The neutral render, kept for the admin and the preview rasters; `market.file_read` audits every admin read. */
export async function getNeutralFile(itemId: string): Promise<NeutralFile | null> {
  const row = await queryOne<{ file_name: string; mime: string; bytes: Buffer }>("SELECT file_name, mime, bytes FROM market_item_files WHERE item_id = $1", [itemId]);
  return row ? { fileName: row.file_name, mime: row.mime, bytes: row.bytes } : null;
}

export async function putNeutralFile(client: Pick<PoolClient, "query">, itemId: string, file: { fileName: string; mime: string; bytes: Uint8Array }): Promise<void> {
  const bytes = Buffer.from(file.bytes);
  await client.query(
    `INSERT INTO market_item_files (item_id, file_name, mime, size_bytes, bytes)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (item_id) DO UPDATE
       SET file_name = EXCLUDED.file_name, mime = EXCLUDED.mime, size_bytes = EXCLUDED.size_bytes, bytes = EXCLUDED.bytes, created_at = now()`,
    [itemId, file.fileName, file.mime, bytes.byteLength, bytes],
  );
}
