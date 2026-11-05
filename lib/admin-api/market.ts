"use client";

import type { AcademicDoc } from "../generation/types";
import { adminDownload, adminGet, adminSend, type AdminCallOptions, type AdminParams, type ListResult } from "./core";

/**
 * «Ishlar bozori» API for the admin panel (docs/market/PLAN.md §6). Types mirror `lib/server/admin-market.ts` (admin
 * client code never imports `lib/server/**`, tests/admin-boundary.test.mts). Every mutation takes the dialog's
 * `Idempotency-Key`; `core.ts` reuses it on the step-up retry.
 */

export type MarketStatus = "candidate" | "active" | "sold_out" | "retired" | "rejected";
export type MarketLevel = "maktab" | "kollej" | "otm";

export const MARKET_SUBJECT_OPTIONS = [
  { value: "matematika", label: "Matematika" },
  { value: "fizika", label: "Fizika" },
  { value: "kimyo", label: "Kimyo" },
  { value: "biologiya", label: "Biologiya" },
  { value: "informatika", label: "Informatika" },
  { value: "tarix", label: "Tarix" },
  { value: "ona-tili-adabiyot", label: "Ona tili va adabiyot" },
  { value: "ingliz-tili", label: "Ingliz tili" },
  { value: "iqtisodiyot", label: "Iqtisodiyot" },
  { value: "huquq", label: "Huquq" },
  { value: "pedagogika-psixologiya", label: "Pedagogika va psixologiya" },
  { value: "tibbiyot", label: "Tibbiyot" },
  { value: "texnika", label: "Texnika" },
  { value: "boshqa", label: "Boshqa" },
] as const;

export const MARKET_LEVEL_OPTIONS = [
  { value: "maktab", label: "Maktab" },
  { value: "kollej", label: "Kollej" },
  { value: "otm", label: "OTM" },
] as const;

export const MARKET_TOOL_OPTIONS = [
  { value: "slide", label: "Slayd" },
  { value: "pro-slide", label: "Pro slayd" },
  { value: "referat", label: "Referat" },
  { value: "mustaqil-ish", label: "Mustaqil ish" },
  { value: "coursework", label: "Kurs ishi" },
  { value: "essay", label: "Insho" },
  { value: "thesis", label: "Tezis" },
  { value: "konspekt", label: "Konspekt" },
  { value: "lesson-plan", label: "Dars rejasi" },
] as const;

/** Reject / retire reason codes (§9). */
export const MARKET_REASON_OPTIONS = [
  { value: "illegal", label: "Noqonuniy yoki zararli" },
  { value: "medical_legal", label: "Tibbiy yoki huquqiy maslahat" },
  { value: "copyright", label: "Mualliflik huquqi" },
  { value: "low_quality", label: "Sifat past" },
  { value: "other", label: "Boshqa" },
] as const;
export type MarketReasonCode = (typeof MARKET_REASON_OPTIONS)[number]["value"];

export const BULK_APPROVE_MAX = 20;
export const MAX_COPIES_LIMIT = 1000;
export const STATS_PERIODS = [7, 30, 90] as const;

export type MarketAdminItem = {
  id: string;
  toolId: string;
  toolTitle: string;
  status: MarketStatus;
  title: string;
  subject: string;
  level: MarketLevel;
  language: string;
  pages: number | null;
  slideCount: number | null;
  quality: number | null;
  flags: number;
  duplicates: number;
  createdAt: string;
  approvedAt: string | null;
  retiredAt: string | null;
  sourceFinishedAt: string | null;
  soldCount: number;
  maxCopies: number | null;
  revenue: number;
  price: number;
  originalPrice: number;
  priceOverride: number | null;
  rating: { avg: number; count: number } | null;
  reports: number;
  hidden: boolean;
  authorOptOut: boolean;
  rejectReason: string | null;
};

export type MarketFlag = { kind: string; path: string; excerpt: string | null };

export type MarketItemDetail = MarketAdminItem & {
  summary: string;
  outline: string[];
  flagsList: MarketFlag[];
  previewPages: number;
  previewVersion: number;
  hasDoc: boolean;
  neutralFile: { fileName: string; sizeBytes: number } | null;
  reportsList: { reason: string; createdAt: string }[];
  source: { userId: string | null; generationId: string | null } | null;
};

export type MarketOverview = {
  enabled: boolean;
  candidates: number;
  active: number;
  soldOut: number;
  retired: number;
  errors: number;
  reported: number;
  trgm: boolean;
  previews: boolean;
};

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

export type MarketStatRow = { id: string; label: string; purchases: number; revenue: number };

export type MarketStats = {
  from: string;
  to: string;
  days: number;
  purchases: number;
  gross: number;
  refunds: { count: number; amount: number };
  revenue: number;
  avgPrice: number;
  views: number;
  conversion: number | null;
  daily: { day: string; purchases: number; revenue: number }[];
  topItems: MarketStatRow[];
  byTool: MarketStatRow[];
  bySubject: MarketStatRow[];
  bySignupAge: MarketStatRow[];
};

export type MarketToolPricing = { toolId: string; title: string; percent: number | null; effective: number; disabled: boolean; active: number };
export type ScanResult = { locked: boolean; scanned: number; created: number; rejected: number };
export type ActionResult = { id: string; status: MarketStatus };
export type ItemEdits = { title?: string; summary?: string; subject?: string; level?: MarketLevel; maxCopies?: number };
export type BulkApproveResult = { results: { id: string; ok: boolean; code?: string; message?: string }[]; approved: number };

export type MarketItemsQuery = {
  status?: readonly MarketStatus[];
  tool?: string;
  subject?: string;
  view?: "errors" | "reports";
  q?: string;
  sort?: string;
  cursor?: string | null;
  limit?: number;
};

const BASE = "/api/admin/market";
const item = (id: string): string => `${BASE}/items/${encodeURIComponent(id)}`;

export function listMarketItems(q: MarketItemsQuery, opts?: AdminCallOptions): Promise<ListResult<MarketAdminItem>> {
  const params: AdminParams = { status: q.status, tool: q.tool, subject: q.subject, view: q.view, q: q.q, sort: q.sort, cursor: q.cursor, limit: q.limit };
  return adminGet<ListResult<MarketAdminItem>>(`${BASE}/items`, params, opts);
}

export const getMarketOverview = (opts?: AdminCallOptions): Promise<MarketOverview> => adminGet<MarketOverview>(`${BASE}/overview`, undefined, opts);
export const getMarketItem = (id: string, opts?: AdminCallOptions): Promise<MarketItemDetail> => adminGet<MarketItemDetail>(item(id), undefined, opts);
export const getMarketItemDoc = (id: string, opts?: AdminCallOptions): Promise<{ doc: AcademicDoc }> => adminGet<{ doc: AcademicDoc }>(`${item(id)}/doc`, undefined, opts);
export const getMarketBuyers = (id: string, opts?: AdminCallOptions): Promise<{ items: MarketBuyer[] }> => adminGet<{ items: MarketBuyer[] }>(`${item(id)}/buyers`, undefined, opts);
export const getMarketStats = (days: number, opts?: AdminCallOptions): Promise<MarketStats> => adminGet<MarketStats>(`${BASE}/stats`, { days }, opts);
export const getMarketToolPricing = (opts?: AdminCallOptions): Promise<{ items: MarketToolPricing[]; percent: number }> =>
  adminGet<{ items: MarketToolPricing[]; percent: number }>(`${BASE}/tool-pricing`, undefined, opts);

/** Raster URL for an `<img>`; `v` makes a redraw visible at once. */
export const marketPreviewUrl = (id: string, page: number, version: number): string => `${item(id)}/preview/${page}?v=${version}`;
export const marketFileUrl = (id: string): string => `${item(id)}/file`;

const post = <T>(path: string, body: unknown, idempotencyKey: string, opts?: AdminCallOptions): Promise<T> => adminSend<T>("POST", path, body, { ...opts, idempotencyKey });

export const approveMarketItem = (id: string, reason: string, edits: ItemEdits, key: string): Promise<ActionResult> => post(`${item(id)}/approve`, { reason, ...edits }, key);
export const rejectMarketItem = (id: string, reason: string, code: MarketReasonCode, key: string): Promise<ActionResult> => post(`${item(id)}/reject`, { reason, code }, key);
export const retireMarketItem = (id: string, reason: string, code: MarketReasonCode, key: string): Promise<ActionResult> => post(`${item(id)}/retire`, { reason, code }, key);
export const unhideMarketItem = (id: string, reason: string, key: string): Promise<ActionResult> => post(`${item(id)}/unhide`, { reason }, key);
export const resanitizeMarketItem = (id: string, reason: string, key: string): Promise<ActionResult & { flags: number }> => post(`${item(id)}/resanitize`, { reason }, key);
export const redrawMarketPreviews = (id: string, reason: string, key: string): Promise<{ id: string; previewVersion: number }> => post(`${item(id)}/previews`, { reason }, key);
export const setMarketItemPrice = (id: string, price: number | null, reason: string, key: string): Promise<{ id: string; priceOverride: number | null; price: number; originalPrice: number }> =>
  post(`${item(id)}/price`, { price, reason }, key);
export const editMarketItem = (id: string, edits: ItemEdits, reason: string, key: string): Promise<ActionResult> =>
  adminSend<ActionResult>("PATCH", item(id), { reason, ...edits }, { idempotencyKey: key });
export const bulkApproveMarket = (ids: readonly string[], reason: string, key: string): Promise<BulkApproveResult> => post(`${BASE}/bulk-approve`, { ids, reason }, key);
export const scanMarket = (reason: string, key: string): Promise<ScanResult> => post(`${BASE}/scan`, { reason }, key);
export const setMarketToolPercent = (toolId: string, percent: number | null, reason: string, key: string): Promise<{ toolId: string; percent: number | null }> =>
  adminSend("PUT", `${BASE}/tool-pricing/${encodeURIComponent(toolId)}`, { percent, reason }, { idempotencyKey: key });
export const setPurchaseAbuse = (purchaseId: string, reason: string, clear: boolean, key: string): Promise<{ id: string; abuseFlag: string | null }> =>
  post(`${BASE}/purchases/${encodeURIComponent(purchaseId)}/abuse`, { reason, clear }, key);

/** GET sales CSV (`finance.export`, step-up) through the shared `adminDownload`. */
export async function exportMarketSales(from: string, to: string, signal?: AbortSignal): Promise<void> {
  await adminDownload(`${BASE}/sales/export`, { from, to }, { signal, fallbackName: "bozor-sotuvlar.csv" });
}
