import "server-only";
import type { PoolClient } from "pg";
import { buildSearchText } from "../market/normalize";
import { SUMMARY_MAX, TITLE_MAX } from "../market/listing";
import { isMarketTool, marketFamilyOf, MARKET_TOOL_IDS, MAX_COPIES_KEY } from "../market/registry";
import { isMarketSubject, MARKET_SUBJECTS } from "../market/subjects";
import { MARKET_ASSET_PREFIX, type MarketLevel, type MarketStatus, type MarketSubjectId, type PiiFlag } from "../market/types";
import { SCRUB_MARK } from "../market/sanitize";
import { cleanText } from "../generation/safe-text";
import { TOOL_BY_ID } from "../tools";
import type { ToolId } from "../types";
import type { AcademicDoc } from "../generation/types";
import { ApiError } from "./api";
import { query, queryOne, transaction } from "./db";
import { log } from "./log";
import { adminTx } from "./admin-audit";
import { parseReason } from "./admin-accounts";
import type { AdminActor } from "./admin-handler";
import { bodyHashOf, findIdempotentReplay, idempotentMutation, type IdempotentResult } from "./admin-idempotency";
import {
  buildKeyset,
  countCapped,
  decodeCursor,
  keysetSelect,
  pageResult,
  parseDateRange,
  parseListParams,
  escapeLike,
  type CursorColumns,
  type DateRange,
  type KeysetCursor,
  type ListSpec,
  type ParsedList,
} from "./admin-list";
import { can } from "./admin-rbac";
import { getSetting, getSettingInTx } from "./settings";
import { candidateCount, resanitizeItemInTx, scanMarketCandidates, type ScanResult } from "./market/candidates";
import { previewPagesOf, renderNeutralFile } from "./market/items";
import { marketPriceForItem, marketPriceInTx, marketPricingConfig, invalidateMarketPricingCache, listToolPercents, setItemPriceOverrideInTx, setToolPercentInTx, type MarketPricingConfig } from "./market/pricing";
import { previewsAvailable, warmApprovedItems } from "./market/previews";
import { invalidateMarketCatalogCache, marketTrgmAvailable } from "./market/search";
import { getItemDoc, getItemRow, getNeutralFile, isHiddenForReview, isUuid, MARKET_ROW_COLUMNS, putNeutralFile, type MarketItemRow, type NeutralFile } from "./market/store";

/**
 * Admin side of «Ishlar bozori» (docs/market/PLAN.md §6, §9). Permission checks live in `adminHandler`, never here.
 *
 * Rules kept in this file:
 *   - every mutation runs through `idempotentMutation`: the change and its one `market.*` audit row commit or roll
 *     back together, and the same `Idempotency-Key` replays the answer;
 *   - a refused action (4xx) writes nothing, so a retry with a corrected body is free;
 *   - approval renders the neutral file BEFORE its transaction, so no lock is held over a render; the transaction
 *     re-checks that the row did not change meanwhile (409 `changed`). A failing render leaves the item a candidate,
 *     with no file and no audit row;
 *   - a request stays well inside the admin client's 30 s: bulk approve and the manual scan are small by design;
 *   - caches are dropped AFTER the commit, never inside the transaction (another process could refill them with the
 *     old row);
 *   - list projections never select `doc_json`; `source_*` columns leave only with `users.pii`.
 */

/* ────────────────────────── shared ────────────────────────── */

const STATUSES = ["candidate", "active", "sold_out", "retired", "rejected"] as const satisfies readonly MarketStatus[];
const LEVELS = ["maktab", "kollej", "otm"] as const satisfies readonly MarketLevel[];

/** Reject / retire reason codes an admin picks; the free text goes to the audit row. */
export const MARKET_REASON_CODES = ["illegal", "medical_legal", "copyright", "low_quality", "other"] as const;
export type MarketReasonCode = (typeof MARKET_REASON_CODES)[number];

/** Bulk approve cap per request (renders run in the request); the UI sends a longer selection in batches. */
export const BULK_APPROVE_MAX = 5;
/** The manual scan runs inside an admin request: small, and well under the client's 30 s. */
export const MANUAL_SCAN_BATCH = 20;
export const MANUAL_SCAN_BUDGET_MS = 20_000;
export const MAX_COPIES_LIMIT = 1000;
/** Override ceiling: a typo must not put a nine-digit price on the shelf. */
export const PRICE_OVERRIDE_MAX = 10_000_000;
const QUERY_MAX = 100;
const BUYERS_LIMIT = 200;
const REPORTS_LIMIT = 50;
const EXCERPT_RADIUS = 48;

const notFound = (): ApiError => new ApiError("Topilmadi", 404, { code: "not_found" });
const stateError = (message: string): ApiError => new ApiError(message, 409, { code: "state" });

export function parseItemId(raw: string): string {
  if (!isUuid(raw)) throw notFound();
  return raw.toLowerCase();
}

async function readOnly<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return transaction(async (client) => {
    await client.query("SET TRANSACTION READ ONLY");
    await client.query("SET LOCAL statement_timeout = '10s'");
    return fn(client);
  });
}

const iso = (d: Date | null | undefined): string | null => (d ? new Date(d).toISOString() : null);

type LockedItem = MarketItemRow;

async function lockItem(client: Pick<PoolClient, "query">, id: string): Promise<LockedItem> {
  const row = (await client.query<LockedItem>(`SELECT ${MARKET_ROW_COLUMNS} FROM market_items WHERE id = $1 FOR UPDATE`, [id])).rows[0];
  if (!row) throw notFound();
  return row;
}

/* ────────────────────────── list ────────────────────────── */

export const MARKET_VIEWS = ["errors", "reports"] as const;

export const MARKET_ITEMS_SPEC = {
  sorts: {
    created_desc: { column: "m.created_at", dir: "DESC", type: "timestamptz" },
    approved_desc: { column: "m.approved_at", dir: "DESC", type: "timestamptz", nullable: true },
    sold_desc: { column: "m.sold_count", dir: "DESC", type: "bigint" },
  },
  id: { column: "m.id", type: "uuid" },
  filters: {
    status: { kind: "enumList", values: STATUSES },
    tool: { kind: "enum", values: MARKET_TOOL_IDS },
    subject: { kind: "enum", values: MARKET_SUBJECTS.map((s) => s.id) },
    view: { kind: "enum", values: MARKET_VIEWS },
  },
} as const satisfies ListSpec;

export type MarketItemsParams = ParsedList<typeof MARKET_ITEMS_SPEC> & { q: string | null };

export function parseMarketItemsQuery(url: URL): MarketItemsParams {
  const all = url.searchParams.getAll("q");
  if (all.length > 1) throw new ApiError("Noto'g'ri parametr: q", 400);
  const q = (all[0] ?? "").replace(/\0/g, "").trim();
  if (Array.from(q).length > QUERY_MAX) throw new ApiError(`Qidiruv ${QUERY_MAX} belgidan oshmasligi kerak`, 400);
  return { ...parseListParams(url, MARKET_ITEMS_SPEC), q: q ? q.toLowerCase() : null };
}

export type MarketAdminItem = {
  id: string;
  toolId: string;
  toolTitle: string;
  status: MarketStatus;
  title: string;
  subject: MarketSubjectId;
  level: MarketLevel;
  language: string;
  pages: number | null;
  slideCount: number | null;
  /** 0–100; `null` for a row the scan rejected before scoring. */
  quality: number | null;
  flags: number;
  /** Other live items of the same tool and normalised topic. */
  duplicates: number;
  createdAt: string;
  approvedAt: string | null;
  retiredAt: string | null;
  /** When the source work finished; `null` once the author deleted it. */
  sourceFinishedAt: string | null;
  soldCount: number;
  maxCopies: number | null;
  /** Gross sales of this item minus the ledger refunds of its copies. */
  revenue: number;
  price: number;
  originalPrice: number;
  priceOverride: number | null;
  rating: { avg: number; count: number } | null;
  reports: number;
  hidden: boolean;
  /** The author opted out later: the item stays (no PII), the admin may retire it. */
  authorOptOut: boolean;
  rejectReason: string | null;
};

type ItemRow = MarketItemRow & {
  duplicates: string;
  revenue: string;
  reports: string;
  source_finished_at: Date | null;
  author_opt_out: boolean | null;
};

const m = (cols: string): string => cols.split(",").map((c) => `m.${c.trim()}`).join(", ");

/** Correlated columns: market tables are thousands of rows and these run only for the page. */
const ITEM_EXTRAS = `
  (SELECT count(*) FROM market_items d
    WHERE d.tool_id = m.tool_id AND d.topic_norm = m.topic_norm AND d.id <> m.id AND d.status IN ('candidate','active','sold_out')) AS duplicates,
  (SELECT COALESCE(sum(p.price), 0) FROM market_purchases p WHERE p.item_id = m.id)
    - (SELECT COALESCE(sum(t.points_delta + t.quota_delta + t.balance_delta), 0)
         FROM generations g JOIN transactions t ON t.kind = 'refund' AND t.reference = g.id::text
        WHERE g.market_item_id = m.id) AS revenue,
  (SELECT count(*) FROM market_reports r WHERE r.item_id = m.id) AS reports,
  (SELECT g.finished_at FROM generations g WHERE g.id = m.source_generation_id) AS source_finished_at,
  (SELECT u.market_opt_out FROM users u WHERE u.id = m.source_user_id) AS author_opt_out`;

const ITEM_SELECT = `${m(MARKET_ROW_COLUMNS)}, ${ITEM_EXTRAS}`;

async function toAdminItem(r: ItemRow, cfg: MarketPricingConfig): Promise<MarketAdminItem> {
  const { price, originalPrice } = await marketPriceForItem(r, cfg);
  const score = r.quality_json?.score;
  return {
    id: r.id,
    toolId: r.tool_id,
    toolTitle: TOOL_BY_ID[r.tool_id as ToolId]?.title ?? r.tool_id,
    status: r.status,
    title: r.title,
    subject: r.subject,
    level: r.level,
    language: r.language,
    pages: r.pages,
    slideCount: r.slide_count,
    quality: typeof score === "number" ? score : null,
    flags: Array.isArray(r.pii_flags) ? r.pii_flags.length : 0,
    duplicates: Number(r.duplicates),
    createdAt: new Date(r.created_at).toISOString(),
    approvedAt: iso(r.approved_at),
    retiredAt: iso(r.retired_at),
    sourceFinishedAt: iso(r.source_finished_at),
    soldCount: r.sold_count,
    maxCopies: r.max_copies,
    revenue: Number(r.revenue),
    price,
    originalPrice,
    priceOverride: r.price_override === null ? null : Number(r.price_override),
    rating: r.rating_count > 0 ? { avg: Math.round((r.rating_sum / r.rating_count) * 10) / 10, count: r.rating_count } : null,
    reports: Number(r.reports),
    hidden: isHiddenForReview(r),
    authorOptOut: r.author_opt_out === true,
    rejectReason: r.reject_reason,
  };
}

function itemConds(p: MarketItemsParams, params: unknown[]): string[] {
  const add = (v: unknown): number => params.push(v);
  const f = p.filters;
  const conds: string[] = [];
  if (f.status?.length) conds.push(`m.status = ANY($${add(f.status)}::text[])`);
  if (f.tool) conds.push(`m.tool_id = $${add(f.tool)}`);
  if (f.subject) conds.push(`m.subject = $${add(f.subject)}`);
  if (f.view === "errors") conds.push("m.reject_reason LIKE 'sanitize\\_error%'");
  if (f.view === "reports") conds.push("EXISTS (SELECT 1 FROM market_reports r WHERE r.item_id = m.id)");
  if (p.q) conds.push(`lower(m.title) LIKE $${add(`%${escapeLike(p.q)}%`)}`);
  return conds;
}

export type MarketItemsResult = { items: MarketAdminItem[]; nextCursor: string | null; total: number | null; totalCapped: boolean };

export async function listMarketAdminItems(p: MarketItemsParams): Promise<MarketItemsResult> {
  const cfg = await marketPricingConfig();
  const { rows, nextCursor, count } = await readOnly(async (client) => {
    const params: unknown[] = [];
    const conds = itemConds(p, params);
    const ks = buildKeyset({ sort: p.sort, cursor: p.cursor, id: MARKET_ITEMS_SPEC.id, paramOffset: params.length });
    const all = [...params, ...ks.params, p.limit + 1];
    const res = await client.query<ItemRow & CursorColumns>(
      `SELECT ${ITEM_SELECT}, ${keysetSelect(p.sort, MARKET_ITEMS_SPEC.id)}
         FROM market_items m
        WHERE ${[...conds, ks.where].join(" AND ")}
        ORDER BY ${ks.orderBy}
        LIMIT $${all.length}`,
      all,
    );
    const page = pageResult(res.rows, p.limit, p.sort);
    const cparams: unknown[] = [];
    const cconds = itemConds(p, cparams);
    const c = await countCapped(client, `FROM market_items m WHERE ${cconds.length ? cconds.join(" AND ") : "TRUE"}`, cparams);
    return { rows: page.items, nextCursor: page.nextCursor, count: c };
  });
  const items = await Promise.all(rows.map((r) => toAdminItem(r as ItemRow, cfg)));
  return { items, nextCursor, ...count };
}

/* ────────────────────────── overview ────────────────────────── */

export type MarketOverview = {
  enabled: boolean;
  candidates: number;
  active: number;
  soldOut: number;
  retired: number;
  errors: number;
  reported: number;
  /** `pg_trgm` absent: full-text only, the fuzzy fallback is off (§9). */
  trgm: boolean;
  /** LibreOffice + pdftoppm present, so rasters can be built here. */
  previews: boolean;
  /** The last manual scan's answer; `null` before the first one. */
  lastScan: (ScanResult & { at: string }) | null;
};

async function lastManualScan(): Promise<MarketOverview["lastScan"]> {
  const row = await queryOne<{ at: Date; response: ScanResult | null }>(
    `SELECT at, meta->'response' AS response FROM admin_audit_log WHERE action = 'market.scan' AND outcome = 'ok' ORDER BY at DESC, id DESC LIMIT 1`,
  );
  return row?.response ? { ...row.response, at: new Date(row.at).toISOString() } : null;
}

export async function marketOverview(): Promise<MarketOverview> {
  const [enabled, candidates, trgm, lastScan, counts] = await Promise.all([
    getSetting("market.enabled"),
    candidateCount(),
    marketTrgmAvailable(),
    lastManualScan(),
    queryOne<{ active: string; sold_out: string; retired: string; errors: string; reported: string }>(
      `SELECT count(*) FILTER (WHERE status = 'active') AS active,
              count(*) FILTER (WHERE status = 'sold_out') AS sold_out,
              count(*) FILTER (WHERE status = 'retired') AS retired,
              count(*) FILTER (WHERE status = 'rejected' AND reject_reason LIKE 'sanitize\\_error%') AS errors,
              (SELECT count(DISTINCT item_id) FROM market_reports) AS reported
         FROM market_items`,
    ),
  ]);
  return {
    enabled,
    candidates,
    active: Number(counts?.active ?? 0),
    soldOut: Number(counts?.sold_out ?? 0),
    retired: Number(counts?.retired ?? 0),
    errors: Number(counts?.errors ?? 0),
    reported: Number(counts?.reported ?? 0),
    trgm,
    previews: previewsAvailable(),
    lastScan,
  };
}

/* ────────────────────────── detail ────────────────────────── */

export type MarketFlagView = PiiFlag & { excerpt: string | null };

export type MarketItemDetail = MarketAdminItem & {
  summary: string;
  outline: string[];
  flagsList: MarketFlagView[];
  previewPages: number;
  previewVersion: number;
  /** A row the scan rejected, or one past the 90-day GC, has an empty document. */
  hasDoc: boolean;
  neutralFile: { fileName: string; sizeBytes: number } | null;
  reportsList: { reason: string; createdAt: string }[];
  /** Only with `users.pii`. */
  source: { userId: string | null; generationId: string | null } | null;
};

/** The string a `PiiFlag.path` points at (`sections.2.blocks.0.text`); `null` for a path that no longer resolves. */
export function textAtPath(doc: unknown, path: string): string | null {
  let cur: unknown = doc;
  for (const key of path.split(".")) {
    if (cur === null || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[key];
  }
  return typeof cur === "string" ? cur : null;
}

/** The scrubbed sentence around the mark, so the admin judges the hit without opening the whole work. */
export function flagExcerpt(text: string | null): string | null {
  if (!text) return null;
  const at = text.indexOf(SCRUB_MARK);
  if (at < 0) return text.length <= EXCERPT_RADIUS * 2 ? text : `${text.slice(0, EXCERPT_RADIUS * 2).trimEnd()}…`;
  const from = Math.max(0, at - EXCERPT_RADIUS);
  const to = Math.min(text.length, at + SCRUB_MARK.length + EXCERPT_RADIUS);
  return `${from > 0 ? "…" : ""}${text.slice(from, to).trim()}${to < text.length ? "…" : ""}`;
}

export async function marketItemDetail(id: string, admin: Pick<AdminActor, "role">): Promise<MarketItemDetail> {
  const r = await queryOne<ItemRow & { file_name: string | null; file_size: string | null; has_doc: boolean }>(
    `SELECT ${ITEM_SELECT}, f.file_name, f.size_bytes AS file_size, m.doc_json ? 'meta' AS has_doc
       FROM market_items m LEFT JOIN market_item_files f ON f.item_id = m.id
      WHERE m.id = $1`,
    [id],
  );
  if (!r) throw notFound();
  const [item, doc, reports, previewPages] = await Promise.all([
    marketPricingConfig().then((cfg) => toAdminItem(r, cfg)),
    r.pii_flags?.length ? getItemDoc(id) : Promise.resolve(null),
    query<{ reason: string; created_at: Date }>("SELECT reason, created_at FROM market_reports WHERE item_id = $1 ORDER BY created_at DESC LIMIT $2", [id, REPORTS_LIMIT]),
    previewPagesOf(r.tool_id),
  ]);
  return {
    ...item,
    summary: r.summary,
    outline: r.outline_json ?? [],
    flagsList: (r.pii_flags ?? []).map((f) => ({ ...f, excerpt: flagExcerpt(textAtPath(doc, f.path)) })),
    previewPages,
    previewVersion: r.preview_version,
    hasDoc: r.has_doc,
    neutralFile: r.file_name ? { fileName: r.file_name, sizeBytes: Number(r.file_size) } : null,
    reportsList: reports.map((x) => ({ reason: x.reason, createdAt: new Date(x.created_at).toISOString() })),
    source: can(admin.role, "users.pii") ? { userId: r.source_user_id, generationId: r.source_generation_id } : null,
  };
}

/** The sanitised document for the drawer's real viewer; images go through the admin asset route. */
export async function marketItemDoc(id: string): Promise<{ doc: AcademicDoc }> {
  const doc = await getItemDoc(id);
  if (!doc?.meta) throw notFound();
  const base = `/api/admin/market/items/${id}/assets/`;
  return { doc: JSON.parse(JSON.stringify(doc).split(MARKET_ASSET_PREFIX).join(base)) as AcademicDoc };
}

export async function marketItemAsset(id: string, assetId: string): Promise<{ mime: string; bytes: Buffer }> {
  const row = await queryOne<{ mime: string; bytes: Buffer }>("SELECT mime, bytes FROM market_assets WHERE item_id = $1 AND asset_id = $2", [id, assetId]);
  if (!row) throw notFound();
  return row;
}

/** `market.file_read`: every read of a neutral file leaves one audit row. */
export async function readNeutralFileAudited(actor: AdminActor, id: string): Promise<NeutralFile> {
  const file = await getNeutralFile(id);
  if (!file) throw notFound();
  await adminTx(actor, (_client, audit) =>
    audit({ action: "market.file_read", targetType: "market_item", targetId: id, meta: { fileName: file.fileName, size: file.bytes.byteLength } }),
  );
  return file;
}

/* ────────────────────────── buyers ────────────────────────── */

export type MarketBuyer = {
  purchaseId: string;
  buyer: string;
  createdAt: string;
  price: number;
  generationId: string | null;
  downloads: number;
  refunded: boolean;
  abuseFlag: string | null;
  fingerprint: string;
};

/** «Ali Valiyev» → «A*** V***»: enough to tell buyers apart, not enough to name one. */
export function maskBuyerName(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "—";
  return words.map((w) => `${Array.from(w)[0]}***`).join(" ");
}

export async function marketItemBuyers(id: string): Promise<{ items: MarketBuyer[] }> {
  const rows = await query<{
    id: string;
    name: string | null;
    created_at: Date;
    price: string;
    generation_id: string | null;
    downloads: number | null;
    refunded: boolean;
    abuse_flag: string | null;
    fingerprint: string;
  }>(
    `SELECT p.id, u.name, p.created_at, p.price, p.generation_id, f.downloads, p.abuse_flag, p.fingerprint,
            EXISTS (SELECT 1 FROM transactions t WHERE t.kind = 'refund' AND t.reference = p.generation_id::text) AS refunded
       FROM market_purchases p
       JOIN users u ON u.id = p.buyer_user_id
       LEFT JOIN generation_files f ON f.generation_id = p.generation_id
      WHERE p.item_id = $1
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT $2`,
    [id, BUYERS_LIMIT],
  );
  return {
    items: rows.map((r) => ({
      purchaseId: r.id,
      buyer: maskBuyerName(r.name),
      createdAt: new Date(r.created_at).toISOString(),
      price: Number(r.price),
      generationId: r.generation_id,
      downloads: Number(r.downloads ?? 0),
      refunded: r.refunded,
      abuseFlag: r.abuse_flag,
      fingerprint: r.fingerprint,
    })),
  };
}

/* ────────────────────────── edits ────────────────────────── */

export type ItemEdits = { title?: string; summary?: string; subject?: MarketSubjectId; level?: MarketLevel; maxCopies?: number };

/** The optional listing fields of an approve / edit body; bad input is a 400, unknown keys are ignored. */
export function parseItemEdits(body: Record<string, unknown>): ItemEdits {
  const out: ItemEdits = {};
  if (body.title !== undefined) {
    const title = typeof body.title === "string" ? cleanText(body.title).replace(/\s+/g, " ").trim() : "";
    if (!title || Array.from(title).length > TITLE_MAX) throw new ApiError(`Sarlavha 1–${TITLE_MAX} belgi bo'lsin`, 400);
    out.title = title;
  }
  if (body.summary !== undefined) {
    const summary = typeof body.summary === "string" ? cleanText(body.summary).trim() : null;
    if (summary === null || Array.from(summary).length > SUMMARY_MAX) throw new ApiError(`Tavsif ${SUMMARY_MAX} belgidan oshmasin`, 400);
    out.summary = summary;
  }
  if (body.subject !== undefined) {
    if (!isMarketSubject(body.subject)) throw new ApiError("Noto'g'ri fan", 400);
    out.subject = body.subject;
  }
  if (body.level !== undefined) {
    if (!(LEVELS as readonly unknown[]).includes(body.level)) throw new ApiError("Noto'g'ri daraja", 400);
    out.level = body.level as MarketLevel;
  }
  if (body.maxCopies !== undefined) {
    const n = body.maxCopies;
    if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 1 || n > MAX_COPIES_LIMIT) throw new ApiError(`Nusxa soni 1 dan ${MAX_COPIES_LIMIT} gacha bo'lsin`, 400);
    out.maxCopies = n;
  }
  return out;
}

/** Listing columns after the edits. `search_text` follows the title and the summary (same builder as the scan). */
function editedColumns(row: LockedItem, e: ItemEdits): { title: string; summary: string; subject: string; level: string; searchText: string } {
  const title = e.title ?? row.title;
  const summary = e.summary ?? row.summary;
  return { title, summary, subject: e.subject ?? row.subject, level: e.level ?? row.level, searchText: buildSearchText({ title, summary, outline: row.outline_json ?? [] }) };
}

const diffOf = (row: LockedItem, e: ItemEdits): { before: Record<string, unknown>; after: Record<string, unknown> } => {
  const current: Record<string, unknown> = { title: row.title, summary: row.summary, subject: row.subject, level: row.level, maxCopies: row.max_copies };
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(e)) {
    if (v === undefined || v === current[k]) continue;
    before[k] = current[k];
    after[k] = v;
  }
  return { before, after };
};

export type MarketActionResult = { id: string; status: MarketStatus };

/** Status after a `max_copies` change: raising a sold-out cap reopens the item (§9), lowering it to the sold count closes it. */
export function statusForCap(status: MarketStatus, maxCopies: number | null, soldCount: number): MarketStatus {
  if (maxCopies === null) return status;
  if (status === "sold_out" && maxCopies > soldCount) return "active";
  if (status === "active" && maxCopies <= soldCount) return "sold_out";
  return status;
}

export async function editMarketItem(actor: AdminActor, id: string, body: Record<string, unknown>, key: string): Promise<IdempotentResult<MarketActionResult>> {
  const reason = parseReason(body.reason)!;
  const edits = parseItemEdits(body);
  const bodyHash = bodyHashOf({ id, reason, ...edits });
  const out = await idempotentMutation<MarketActionResult>(actor, { action: "market.edit", key, bodyHash }, async (client) => {
    const row = await lockItem(client, id);
    if (row.status === "rejected") throw stateError("Rad etilgan ish tahrir qilinmaydi");
    const { before, after } = diffOf(row, edits);
    if (!Object.keys(after).length) throw new ApiError("Hech narsa o'zgarmadi", 400, { code: "unchanged" });
    const c = editedColumns(row, edits);
    const maxCopies = edits.maxCopies ?? row.max_copies;
    const status = statusForCap(row.status, maxCopies, row.sold_count);
    await client.query(
      `UPDATE market_items
          SET title = $2, summary = $3, subject = $4, level = $5, search_text = $6, max_copies = $7, status = $8, updated_at = now()
        WHERE id = $1`,
      [id, c.title, c.summary, c.subject, c.level, c.searchText, maxCopies, status],
    );
    if (status !== row.status) {
      before.status = row.status;
      after.status = status;
    }
    return { response: { id, status }, audit: { targetType: "market_item", targetId: id, reason, before, after } };
  });
  invalidateMarketCatalogCache();
  return out;
}

/* ────────────────────────── approve ────────────────────────── */

type RenderFile = typeof renderNeutralFile;

/**
 * One approval (§1.2 step 6): candidate → active with its neutral file, `approved_*`, the `original_price` snapshot and
 * the family's default cap, all in one transaction with the audit row.
 *
 * The render runs first, with no transaction open: it takes seconds, and a row lock plus the key's advisory lock held
 * that long stall every reader of the row and the pool. The transaction then compares `updated_at` with what the render
 * saw, so a re-sanitise or an edit that slipped in between is a 409, never a file of the old text. A replay (the item is
 * no longer a candidate) skips the render and gets its stored answer inside `idempotentMutation`.
 */
async function approveOne(
  actor: AdminActor,
  id: string,
  input: { reason: string; edits: ItemEdits; key: string; bulk: boolean },
  render: RenderFile,
): Promise<IdempotentResult<MarketActionResult>> {
  const bodyHash = bodyHashOf({ id, reason: input.reason, ...input.edits });
  const seen = await getItemRow(id);
  const flagged = input.bulk && Boolean(seen?.pii_flags?.length);
  let prepared: { file: Awaited<ReturnType<RenderFile>>; updatedAt: number } | null = null;
  if (seen?.status === "candidate" && !flagged) {
    try {
      const file = await render({ id, tool_id: seen.tool_id, title: editedColumns(seen, input.edits).title });
      prepared = { file, updatedAt: new Date(seen.updated_at).getTime() };
    } catch (err) {
      log("warn", "[market] neytral fayl chizilmadi", { itemId: id, err });
      throw new ApiError("Fayl chizilmadi. Ish navbatda qoldi.", 422, { code: "render_failed" });
    }
  }
  return idempotentMutation<MarketActionResult>(actor, { action: "market.approve", key: input.key, bodyHash }, async (client) => {
    const row = await lockItem(client, id);
    if (row.status !== "candidate") throw stateError("Bu ish navbatda emas");
    // Bulk approval never carries a work with PII hits: those are looked at one by one.
    if (input.bulk && row.pii_flags?.length) throw new ApiError("PII topilgan ish alohida tekshiriladi", 409, { code: "has_flags" });
    if (!prepared || new Date(row.updated_at).getTime() !== prepared.updatedAt) {
      throw new ApiError("Ish tasdiqlash paytida o'zgardi. Qayta urinib ko'ring.", 409, { code: "changed" });
    }
    const c = editedColumns(row, input.edits);
    const family = marketFamilyOf(row.tool_id);
    if (!family) throw stateError("Bu vosita bozorda yo'q");
    const maxCopies = input.edits.maxCopies ?? (await getSettingInTx(client, MAX_COPIES_KEY[family]));
    await putNeutralFile(client, id, prepared.file);
    const { originalPrice } = await marketPriceInTx(client, row);
    await client.query(
      `UPDATE market_items
          SET status = 'active', approved_at = now(), approved_by = $2, original_price = $3, max_copies = $4,
              title = $5, summary = $6, subject = $7, level = $8, search_text = $9, updated_at = now()
        WHERE id = $1`,
      [id, actor.id, originalPrice, maxCopies, c.title, c.summary, c.subject, c.level, c.searchText],
    );
    const { before, after } = diffOf(row, input.edits);
    return {
      response: { id, status: "active" },
      audit: {
        targetType: "market_item",
        targetId: id,
        reason: input.reason,
        before: { status: row.status, ...before },
        after: { status: "active", originalPrice, maxCopies, ...after },
        meta: { flags: row.pii_flags?.length ?? 0, ...(input.bulk ? { bulk: true } : {}) },
      },
    };
  });
}

export async function approveMarketItem(
  actor: AdminActor,
  id: string,
  body: Record<string, unknown>,
  key: string,
  render: RenderFile = renderNeutralFile,
): Promise<IdempotentResult<MarketActionResult>> {
  const reason = parseReason(body.reason)!;
  const out = await approveOne(actor, id, { reason, edits: parseItemEdits(body), key, bulk: false }, render);
  invalidateMarketCatalogCache();
  if (!out.replayed) warmApprovedItems([id]);
  return out;
}

export type BulkApproveResult = { results: { id: string; ok: boolean; code?: string; message?: string }[]; approved: number };

/**
 * Bulk approve: at most `BULK_APPROVE_MAX`, one reason. Each item is its own transaction and audit row with a derived
 * key, so one bad item costs only that item, whatever went wrong (`code: "error"` on the unexpected), and retrying the
 * same request replays the done ones and retries the rest. A longer selection is the client's batches.
 */
export async function bulkApproveMarketItems(actor: AdminActor, body: Record<string, unknown>, key: string, render: RenderFile = renderNeutralFile): Promise<BulkApproveResult> {
  const reason = parseReason(body.reason)!;
  const raw = body.ids;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > BULK_APPROVE_MAX) throw new ApiError(`1 dan ${BULK_APPROVE_MAX} tagacha ish tanlang`, 400);
  if (!raw.every(isUuid)) throw new ApiError("Noto'g'ri identifikator", 400);
  const ids = [...new Set((raw as string[]).map((v) => v.toLowerCase()))];
  const results: BulkApproveResult["results"] = [];
  for (const id of ids) {
    try {
      await approveOne(actor, id, { reason, edits: {}, key: `${key}:${id}`, bulk: true }, render);
      results.push({ id, ok: true });
    } catch (err) {
      if (!(err instanceof ApiError)) {
        log("error", "[market] ommaviy tasdiqlash", { itemId: id, err });
        results.push({ id, ok: false, code: "error", message: "Kutilmagan xato. Qayta urinib ko'ring." });
        continue;
      }
      const code = typeof err.extra?.code === "string" ? err.extra.code : undefined;
      results.push({ id, ok: false, code, message: err.message });
    }
  }
  invalidateMarketCatalogCache();
  warmApprovedItems(results.filter((r) => r.ok).map((r) => r.id));
  return { results, approved: results.filter((r) => r.ok).length };
}

/* ────────────────────────── reject, retire, review ────────────────────────── */

function parseReasonCode(raw: unknown): MarketReasonCode {
  if (!(MARKET_REASON_CODES as readonly unknown[]).includes(raw)) throw new ApiError("Sabab turini tanlang", 400);
  return raw as MarketReasonCode;
}

export async function rejectMarketItem(actor: AdminActor, id: string, body: Record<string, unknown>, key: string): Promise<IdempotentResult<MarketActionResult>> {
  const reason = parseReason(body.reason)!;
  const code = parseReasonCode(body.code);
  const out = await idempotentMutation<MarketActionResult>(actor, { action: "market.reject", key, bodyHash: bodyHashOf({ id, reason, code }) }, async (client) => {
    const row = await lockItem(client, id);
    if (row.status !== "candidate") throw stateError("Bu ish navbatda emas");
    await client.query("UPDATE market_items SET status = 'rejected', reject_reason = $2, updated_at = now() WHERE id = $1", [id, code]);
    return {
      response: { id, status: "rejected" },
      audit: { targetType: "market_item", targetId: id, reason, before: { status: row.status }, after: { status: "rejected", rejectReason: code } },
    };
  });
  invalidateMarketCatalogCache();
  return out;
}

/** «Olib tashlash»: off the shelf; buyers keep their copies and `restore` still works (§9). */
export async function retireMarketItem(actor: AdminActor, id: string, body: Record<string, unknown>, key: string): Promise<IdempotentResult<MarketActionResult>> {
  const reason = parseReason(body.reason)!;
  const code = parseReasonCode(body.code);
  const out = await idempotentMutation<MarketActionResult>(actor, { action: "market.retire", key, bodyHash: bodyHashOf({ id, reason, code }) }, async (client) => {
    const row = await lockItem(client, id);
    if (row.status !== "active" && row.status !== "sold_out") throw stateError("Faqat sotuvdagi ish olib tashlanadi");
    await client.query("UPDATE market_items SET status = 'retired', retired_at = now(), reject_reason = $2, updated_at = now() WHERE id = $1", [id, code]);
    return {
      response: { id, status: "retired" },
      audit: { targetType: "market_item", targetId: id, reason, before: { status: row.status }, after: { status: "retired", rejectReason: code } },
    };
  });
  invalidateMarketCatalogCache();
  return out;
}

/** Reports reviewed and the item is fine: it returns to the shelf (three reports hid it, §9). */
export async function unhideMarketItem(actor: AdminActor, id: string, body: Record<string, unknown>, key: string): Promise<IdempotentResult<MarketActionResult>> {
  const reason = parseReason(body.reason)!;
  const out = await idempotentMutation<MarketActionResult>(actor, { action: "market.edit", key, bodyHash: bodyHashOf({ id, reason, unhide: true }) }, async (client) => {
    const row = await lockItem(client, id);
    if (!isHiddenForReview(row)) throw stateError("Bu ish yashirilmagan");
    await client.query("UPDATE market_items SET quality_json = quality_json - 'hidden_until_review', updated_at = now() WHERE id = $1", [id]);
    return {
      response: { id, status: row.status },
      audit: { targetType: "market_item", targetId: id, reason, before: { hidden: true }, after: { hidden: false } },
    };
  });
  invalidateMarketCatalogCache();
  return out;
}

/* ────────────────────────── re-sanitise, previews ────────────────────────── */

export type ResanitizeResult = MarketActionResult & { flags: number };

/**
 * «Qayta tozalash» over the stored document. The neutral file is dropped in the transaction whatever the status: a
 * candidate's file (the admin's rasters made one) holds the old text too, and rasters of the new version would be drawn
 * from it. A listed item gets its file again right after the commit; a candidate at approval. A failed re-render leaves
 * the preview builder to do it on the next view, which is why it only logs.
 */
export async function resanitizeMarketItem(actor: AdminActor, id: string, body: Record<string, unknown>, key: string): Promise<IdempotentResult<ResanitizeResult>> {
  const reason = parseReason(body.reason)!;
  let rerender: Pick<MarketItemRow, "id" | "tool_id" | "title"> | null = null;
  const out = await idempotentMutation<ResanitizeResult>(actor, { action: "market.resanitize", key, bodyHash: bodyHashOf({ id, reason }) }, async (client) => {
    const row = await lockItem(client, id);
    if (row.status === "rejected" || row.status === "retired") throw stateError("Bu ish qayta tozalanmaydi");
    const clean = await resanitizeItemInTx(client, id);
    if (!clean) throw stateError("Ishda hujjat yo'q");
    await client.query("DELETE FROM market_item_files WHERE item_id = $1", [id]);
    if (row.status !== "candidate") rerender = { id, tool_id: row.tool_id, title: row.title };
    return {
      response: { id, status: row.status, flags: clean.flags },
      audit: { targetType: "market_item", targetId: id, reason, before: { flags: row.pii_flags?.length ?? 0 }, after: { flags: clean.flags } },
    };
  });
  invalidateMarketCatalogCache();
  const target = rerender as Pick<MarketItemRow, "id" | "tool_id" | "title"> | null;
  if (target) {
    try {
      const file = await renderNeutralFile(target);
      await transaction((client) => putNeutralFile(client, id, file));
    } catch (err) {
      log("warn", "[market] qayta tozalangan fayl chizilmadi", { itemId: id, err });
    }
  }
  return out;
}

/** «Qayta chizish»: a new `preview_version`, so the next view builds fresh rasters. Audited as an edit (§6 lists no action of its own). */
export async function redrawMarketPreviews(actor: AdminActor, id: string, body: Record<string, unknown>, key: string): Promise<IdempotentResult<{ id: string; previewVersion: number }>> {
  const reason = parseReason(body.reason)!;
  const out = await idempotentMutation<{ id: string; previewVersion: number }>(actor, { action: "market.edit", key, bodyHash: bodyHashOf({ id, reason, redraw: true }) }, async (client) => {
    const row = await lockItem(client, id);
    const next = row.preview_version + 1;
    await client.query("UPDATE market_items SET preview_version = $2, updated_at = now() WHERE id = $1", [id, next]);
    return {
      response: { id, previewVersion: next },
      audit: { targetType: "market_item", targetId: id, reason, before: { previewVersion: row.preview_version }, after: { previewVersion: next } },
    };
  });
  invalidateMarketCatalogCache();
  return out;
}

/* ────────────────────────── money: price, tool percent ────────────────────────── */

function parseOverride(raw: unknown): number | null {
  if (raw === null) return null;
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 0 || raw > PRICE_OVERRIDE_MAX) {
    throw new ApiError(`Narx 0 dan ${PRICE_OVERRIDE_MAX} gacha butun son bo'lsin`, 400);
  }
  return raw;
}

export type MarketPriceResult = { id: string; priceOverride: number | null; price: number; originalPrice: number };

/** Per-item absolute price (`pricing.edit`, step-up, reason). `null` returns the item to the formula. */
export async function setMarketItemPrice(actor: AdminActor, id: string, body: Record<string, unknown>, key: string): Promise<IdempotentResult<MarketPriceResult>> {
  const reason = parseReason(body.reason)!;
  if (body.price === undefined) throw new ApiError("Narxni kiriting", 400);
  const override = parseOverride(body.price);
  const out = await idempotentMutation<MarketPriceResult>(actor, { action: "market.price", key, bodyHash: bodyHashOf({ id, reason, price: override }) }, async (client) => {
    const row = await lockItem(client, id);
    const was = row.price_override === null ? null : Number(row.price_override);
    if (was === override) throw new ApiError("Narx o'zgarmadi", 400, { code: "unchanged" });
    await setItemPriceOverrideInTx(client, id, override);
    const { price, originalPrice } = await marketPriceInTx(client, { ...row, price_override: override === null ? null : String(override) });
    return {
      response: { id, priceOverride: override, price, originalPrice },
      audit: { targetType: "market_item", targetId: id, reason, before: { priceOverride: was }, after: { priceOverride: override, price } },
    };
  });
  invalidateMarketCatalogCache();
  return out;
}

export type MarketToolPricing = { toolId: string; title: string; percent: number | null; effective: number; disabled: boolean; active: number };

export async function marketToolPricing(): Promise<{ items: MarketToolPricing[]; percent: number }> {
  const [overrides, percent, disabled, counts] = await Promise.all([
    listToolPercents(),
    getSetting("market.percent"),
    getSetting("market.tools_disabled"),
    query<{ tool_id: string; n: string }>("SELECT tool_id, count(*) AS n FROM market_items WHERE status = 'active' GROUP BY tool_id"),
  ]);
  const byTool = new Map(overrides.map((o) => [o.toolId, o.percent]));
  const active = new Map(counts.map((c) => [c.tool_id, Number(c.n)]));
  return {
    percent,
    items: MARKET_TOOL_IDS.map((toolId) => ({
      toolId,
      title: TOOL_BY_ID[toolId]?.title ?? toolId,
      percent: byTool.get(toolId) ?? null,
      effective: byTool.get(toolId) ?? percent,
      disabled: (disabled as readonly string[]).includes(toolId),
      active: active.get(toolId) ?? 0,
    })),
  };
}

/** Per-tool share (`pricing.edit`, step-up, reason); `percent: null` returns the tool to `market.percent`. */
export async function setMarketToolPercent(
  actor: AdminActor,
  toolId: string,
  body: Record<string, unknown>,
  key: string,
): Promise<IdempotentResult<{ toolId: string; percent: number | null }>> {
  if (!isMarketTool(toolId)) throw notFound();
  const reason = parseReason(body.reason)!;
  if (body.percent !== null && typeof body.percent !== "number") throw new ApiError("Foiz 10 dan 100 gacha bo'lishi kerak", 400);
  const percent = body.percent as number | null;
  const out = await idempotentMutation<{ toolId: string; percent: number | null }>(actor, { action: "market.tool_pricing", key, bodyHash: bodyHashOf({ toolId, reason, percent }) }, async (client) => {
    const prior = (await client.query<{ percent: number }>("SELECT percent FROM market_tool_pricing WHERE tool_id = $1 FOR UPDATE", [toolId])).rows[0];
    const was = prior ? Number(prior.percent) : null;
    if (was === percent) throw new ApiError("Foiz o'zgarmadi", 400, { code: "unchanged" });
    await setToolPercentInTx(client, toolId, percent, actor.id);
    return {
      response: { toolId, percent },
      audit: { targetType: "market_tool", targetId: toolId, reason, before: { percent: was }, after: { percent } },
    };
  });
  invalidateMarketPricingCache();
  invalidateMarketCatalogCache();
  return out;
}

/* ────────────────────────── abuse flag ────────────────────────── */

/** «Suiiste'mol»: blocks restore and rating of a purchase; `clear: true` takes the flag off. */
export async function setPurchaseAbuseFlag(actor: AdminActor, id: string, body: Record<string, unknown>, key: string): Promise<IdempotentResult<{ id: string; abuseFlag: string | null }>> {
  const reason = parseReason(body.reason)!;
  const clear = body.clear === true;
  const out = await idempotentMutation<{ id: string; abuseFlag: string | null }>(actor, { action: "market.abuse_flag", key, bodyHash: bodyHashOf({ id, reason, clear }) }, async (client) => {
    const row = (await client.query<{ abuse_flag: string | null; item_id: string }>("SELECT abuse_flag, item_id FROM market_purchases WHERE id = $1 FOR UPDATE", [id])).rows[0];
    if (!row) throw notFound();
    if (clear ? row.abuse_flag === null : row.abuse_flag !== null) throw stateError(clear ? "Belgi qo'yilmagan" : "Belgi allaqachon qo'yilgan");
    const next = clear ? null : reason;
    await client.query("UPDATE market_purchases SET abuse_flag = $2 WHERE id = $1", [id, next]);
    return {
      response: { id, abuseFlag: next },
      audit: { targetType: "market_purchase", targetId: id, reason, before: { abuseFlag: row.abuse_flag }, after: { abuseFlag: next }, meta: { itemId: row.item_id } },
    };
  });
  return out;
}

/* ────────────────────────── manual scan ────────────────────────── */

/**
 * The manual scan works while the market is dark: that is how the first queue is filled (§10.5). It runs outside any
 * transaction, a short batch under a time cap, and the audit row comes after, so no connection or lock waits on it. A
 * retry with the same key finds the stored answer first and scans nothing; the scan's own advisory lock covers two
 * requests racing past that check. The answer stays in the overview (`lastScan`) if the client gave up waiting.
 */
export async function runMarketScan(actor: AdminActor, body: Record<string, unknown>, key: string): Promise<IdempotentResult<ScanResult>> {
  const reason = parseReason(body.reason)!;
  const opts = { action: "market.scan", key, bodyHash: bodyHashOf({ reason }) };
  const prior = await findIdempotentReplay<ScanResult>(actor, opts);
  if (prior) return prior;
  const batch = Math.min(MANUAL_SCAN_BATCH, await getSetting("market.backfill_batch"));
  const result = await scanMarketCandidates({ batch, budgetMs: MANUAL_SCAN_BUDGET_MS });
  return idempotentMutation<ScanResult>(actor, opts, async () => ({ response: result, audit: { targetType: "market", reason, after: result } }));
}

/* ────────────────────────── stats ────────────────────────── */

export const STATS_PERIODS = [7, 30, 90] as const;

export function parseStatsRange(url: URL): DateRange {
  const raw = url.searchParams.get("days") ?? "30";
  const days = Number(raw);
  if (!(STATS_PERIODS as readonly number[]).includes(days)) throw new ApiError("Noto'g'ri davr", 400);
  return parseDateRange(null, null, { defaultDays: days });
}

export type MarketStatRow = { id: string; label: string; purchases: number; revenue: number };

export type MarketStats = {
  from: string;
  to: string;
  days: number;
  purchases: number;
  gross: number;
  refunds: { count: number; amount: number };
  /** Gross minus ledger refunds in the range. */
  revenue: number;
  avgPrice: number;
  views: number;
  /** Purchases per 100 item views; `null` without views. */
  conversion: number | null;
  daily: { day: string; purchases: number; revenue: number }[];
  topItems: MarketStatRow[];
  byTool: MarketStatRow[];
  bySubject: MarketStatRow[];
  /** Account age at purchase: a spike of fresh accounts is the farming signal of §3.1. */
  bySignupAge: MarketStatRow[];
};

/** Account age at the moment of purchase, youngest first. */
const AGE_BUCKETS: readonly { id: string; label: string }[] = [
  { id: "1", label: "1 kungacha" },
  { id: "7", label: "1–7 kun" },
  { id: "30", label: "8–30 kun" },
  { id: "old", label: "30 kundan ko'p" },
];

const TK_DAY = "(p.created_at AT TIME ZONE 'Asia/Tashkent')::date";
const IN_RANGE = "p.created_at >= $1::timestamptz AND p.created_at < $2::timestamptz";

/** Refunds of market copies only: a copy is recognised by `generations.market_item_id` (a restore re-points the purchase row). */
const REFUND_FROM = `FROM generations g JOIN transactions t ON t.kind = 'refund' AND t.reference = g.id::text
  WHERE g.market_item_id IS NOT NULL AND t.created_at >= $1::timestamptz AND t.created_at < $2::timestamptz`;

export async function marketStats(range: DateRange): Promise<MarketStats> {
  return readOnly(async (client) => {
    const bounds = [range.fromTs, range.toTsExclusive];
    const totals = (await client.query<{ n: string; gross: string }>(`SELECT count(*) AS n, COALESCE(sum(p.price), 0) AS gross FROM market_purchases p WHERE ${IN_RANGE}`, bounds)).rows[0];
    const refunds = (await client.query<{ n: string; amount: string }>(`SELECT count(*) AS n, COALESCE(sum(t.points_delta + t.quota_delta + t.balance_delta), 0) AS amount ${REFUND_FROM}`, bounds)).rows[0];
    const views = (await client.query<{ n: string }>("SELECT COALESCE(sum(views), 0) AS n FROM market_views WHERE day >= $1::date AND day <= $2::date", [range.fromDay, range.toDay])).rows[0];
    const days = await client.query<{ day: string; n: string; revenue: string }>(
      `SELECT to_char(d, 'YYYY-MM-DD') AS day, count(p.id) AS n, COALESCE(sum(p.price), 0) AS revenue
         FROM generate_series($3::date, $4::date, interval '1 day') d
         LEFT JOIN market_purchases p ON ${TK_DAY} = d::date AND ${IN_RANGE}
        GROUP BY d ORDER BY d`,
      [...bounds, range.fromDay, range.toDay],
    );
    const rank = (select: string, group: string, limit: number) =>
      client.query<{ id: string; label: string; n: string; revenue: string }>(
        `SELECT ${select}, count(*) AS n, COALESCE(sum(p.price), 0) AS revenue
           FROM market_purchases p JOIN market_items i ON i.id = p.item_id
          WHERE ${IN_RANGE}
          GROUP BY ${group}
          ORDER BY n DESC, revenue DESC, ${group.split(",")[0]}
          LIMIT ${limit}`,
        bounds,
      );
    const [top, tools, subjects] = [
      await rank("i.id::text AS id, i.title AS label", "i.id, i.title", 10),
      await rank("i.tool_id AS id, i.tool_id AS label", "i.tool_id", MARKET_TOOL_IDS.length + 5),
      await rank("i.subject AS id, i.subject AS label", "i.subject", MARKET_SUBJECTS.length + 5),
    ];
    const ages = await client.query<{ id: string; n: string; revenue: string }>(
      `SELECT CASE WHEN p.created_at - u.created_at < interval '1 day' THEN '1'
                   WHEN p.created_at - u.created_at < interval '7 days' THEN '7'
                   WHEN p.created_at - u.created_at < interval '30 days' THEN '30'
                   ELSE 'old' END AS id,
              count(*) AS n, COALESCE(sum(p.price), 0) AS revenue
         FROM market_purchases p JOIN users u ON u.id = p.buyer_user_id
        WHERE ${IN_RANGE}
        GROUP BY 1`,
      bounds,
    );
    const toRow = (r: { id: string; label: string; n: string; revenue: string }): MarketStatRow => ({ id: r.id, label: r.label, purchases: Number(r.n), revenue: Number(r.revenue) });
    const purchases = Number(totals?.n ?? 0);
    const gross = Number(totals?.gross ?? 0);
    const refundAmount = Number(refunds?.amount ?? 0);
    const viewCount = Number(views?.n ?? 0);
    return {
      from: range.fromDay,
      to: range.toDay,
      days: range.days,
      purchases,
      gross,
      refunds: { count: Number(refunds?.n ?? 0), amount: refundAmount },
      revenue: gross - refundAmount,
      avgPrice: purchases ? Math.round(gross / purchases) : 0,
      views: viewCount,
      conversion: viewCount ? Math.round((purchases / viewCount) * 1000) / 10 : null,
      daily: days.rows.map((d) => ({ day: d.day, purchases: Number(d.n), revenue: Number(d.revenue) })),
      topItems: top.rows.map(toRow),
      byTool: tools.rows.map((r) => ({ ...toRow(r), label: TOOL_BY_ID[r.id as ToolId]?.title ?? r.id })),
      bySubject: subjects.rows.map((r) => ({ ...toRow(r), label: MARKET_SUBJECTS.find((s) => s.id === r.id)?.label ?? r.id })),
      bySignupAge: AGE_BUCKETS.flatMap((b) => {
        const r = ages.rows.find((x) => x.id === b.id);
        return r ? [{ id: b.id, label: b.label, purchases: Number(r.n), revenue: Number(r.revenue) }] : [];
      }),
    };
  });
}

/* ────────────────────────── CSV ────────────────────────── */

export const SALES_SPEC = {
  sorts: { created_desc: { column: "p.created_at", dir: "DESC", type: "timestamptz" } },
  id: { column: "p.id", type: "uuid" },
  range: { defaultDays: 30, maxDays: 366 },
} as const satisfies ListSpec;

export type SalesParams = ParsedList<typeof SALES_SPEC>;
export const parseSalesQuery = (url: URL): SalesParams => parseListParams(url, SALES_SPEC);

export const SALES_CSV_HEADER = ["Xarid", "Sana", "Ish", "Sarlavha", "Vosita", "Fan", "Narx", "Asl narx", "Qaytarilgan", "Xaridor ID"] as const;

export type SalesRow = {
  id: string;
  created_at: Date;
  item_id: string;
  title: string;
  tool_id: string;
  subject: string;
  price: string;
  original_price: string;
  refunded: string;
  buyer_user_id: string;
};

export function salesCsvRow(r: SalesRow): readonly unknown[] {
  return [r.id, new Date(r.created_at), r.item_id, r.title, TOOL_BY_ID[r.tool_id as ToolId]?.title ?? r.tool_id, r.subject, Number(r.price), Number(r.original_price), Number(r.refunded), r.buyer_user_id];
}

export function salesPageFetcher(p: SalesParams) {
  return async (raw: string | null, limit: number): Promise<{ items: SalesRow[]; nextCursor: string | null }> => {
    let cursor: KeysetCursor | null = null;
    if (raw !== null) {
      cursor = decodeCursor(raw, p.sort, SALES_SPEC.id);
      if (!cursor) throw new Error("admin-market: export cursor did not decode");
    }
    return readOnly(async (client) => {
      const params: unknown[] = [p.range!.fromTs, p.range!.toTsExclusive];
      const ks = buildKeyset({ sort: p.sort, cursor, id: SALES_SPEC.id, paramOffset: params.length });
      const all = [...params, ...ks.params, limit + 1];
      const res = await client.query<SalesRow & CursorColumns>(
        `SELECT p.id, p.created_at, p.item_id, i.title, i.tool_id, i.subject, p.price, p.original_price, p.buyer_user_id,
                COALESCE((SELECT sum(t.points_delta + t.quota_delta + t.balance_delta) FROM transactions t WHERE t.kind = 'refund' AND t.reference = p.generation_id::text), 0) AS refunded,
                ${keysetSelect(p.sort, SALES_SPEC.id)}
           FROM market_purchases p JOIN market_items i ON i.id = p.item_id
          WHERE p.created_at >= $1::timestamptz AND p.created_at < $2::timestamptz AND ${ks.where}
          ORDER BY ${ks.orderBy}
          LIMIT $${all.length}`,
        all,
      );
      const page = pageResult(res.rows, limit, p.sort);
      return { items: page.items as SalesRow[], nextCursor: page.nextCursor };
    });
  };
}

