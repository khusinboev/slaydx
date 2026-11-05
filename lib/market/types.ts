import type { ToolId } from "../types";

/**
 * «Ishlar bozori» shared contracts (docs/market/PLAN.md §10.1). Isomorphic: web, worker, bot and admin
 * all read these shapes. The shapes are fixed by the plan; changing one needs the lead's OK.
 */

export type MarketStatus = "candidate" | "active" | "sold_out" | "retired" | "rejected";
export type MarketLevel = "maktab" | "kollej" | "otm";
export type MarketSubjectId =
  | "matematika"
  | "fizika"
  | "kimyo"
  | "biologiya"
  | "informatika"
  | "tarix"
  | "ona-tili-adabiyot"
  | "ingliz-tili"
  | "iqtisodiyot"
  | "huquq"
  | "pedagogika-psixologiya"
  | "tibbiyot"
  | "texnika"
  | "boshqa";
export type MarketSort = "new" | "popular" | "cheap" | "rating";

export type MarketCard = {
  id: string;
  toolId: ToolId;
  title: string;
  summary: string;
  subject: MarketSubjectId;
  level: MarketLevel;
  language: string;
  pages: number | null;
  slideCount: number | null;
  price: number;
  originalPrice: number;
  soldCount: number;
  rating: { avg: number; count: number } | null;
  /** `/api/market/items/{id}/preview/1?v=<preview_version>` */
  cover: string;
  status: "active" | "sold_out";
};

export type MarketItemView = MarketCard & {
  outline: string[];
  previewPages: number;
  totalPages: number | null;
  owned: { generationId: string | null; purchaseId: string } | null;
  requiredFields: string[];
  createTool: { slug: string; topic: string };
};

export type MarketListResponse = {
  items: MarketCard[];
  nextCursor: string | null;
  facets: { tools: { id: ToolId; count: number }[]; subjects: { id: MarketSubjectId; count: number }[] };
};

export type PurchaseFields = {
  author?: string;
  university?: string;
  faculty?: string;
  department?: string;
  group?: string;
  course?: string;
  teacher?: string;
  city?: string;
};
export type PurchaseRequest = { expectedPrice: number; fields: PurchaseFields };
export type PurchaseResponse = { generationId: string; price: number; replayed: boolean };
export type MarketCloneValues = PurchaseFields & { marketItemId: string; language?: string };

export const isMarketCopyValues = (v: Record<string, unknown>): v is MarketCloneValues => typeof v.marketItemId === "string";

/** The API error codes of the market (`ApiError` body `code`). */
export const MARKET_ERROR_CODES = [
  "market_disabled",
  "gone",
  "sold_out",
  "already_owned",
  "price_changed",
  "university_cap",
  "offer_required",
  "channel_required",
  "paused",
] as const;
export type MarketErrorCode = (typeof MARKET_ERROR_CODES)[number];

export type PiiKind = "name" | "institution" | "phone" | "email" | "username" | "telegram";
/** One PII hit found by the sanitiser. `path` points into the source document; the matched value itself is never stored. */
export type PiiFlag = { kind: PiiKind; path: string };

/** Placeholder of an image inside `market_items.doc_json`; the buyer's clone rewrites it to the new generation's asset URL. */
export const MARKET_ASSET_PREFIX = "market-asset://";
