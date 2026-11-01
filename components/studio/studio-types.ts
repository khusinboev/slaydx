import type { ClientEntry } from "@/lib/studio-core";

/**
 * Wire shapes of the Studio API (docs/studio/P1-SPEC.md «Contract»). The parsers in `studio-api.ts` build these from
 * untrusted JSON, so the rest of the UI reads plain typed objects.
 */

/** `GET /api/media/catalog` → `pricing`: the context the price preview needs (`mediaQuote`'s `QuoteCtx`). */
export type StudioPricing = {
  /** so'm per USD (`finance.soum_per_usd`). */
  soumPerUsd: number;
  /** Global markup (`media.markup`, default 2). */
  markup: number;
  /** Prices are rounded UP to a multiple of this (100 so'm). */
  step: number;
  /** Per-model markup the admin set. */
  overrides: Readonly<Record<string, { markup: number }>>;
};

/** `GET /api/media/catalog?purpose=…`: only models the user can use right now, in catalog order. */
export type MediaCatalog = {
  purpose: string;
  defaultModelId: string;
  models: ClientEntry[];
  pricing: StudioPricing;
};

/** One completed Studio generation in the gallery. */
export type GalleryItem = {
  id: string;
  createdAt: string;
  modelId: string | null;
  modelLabel: string;
  prompt: string;
  /** Pictures in the job (a job of 4 shows «×4»). */
  count: number;
  /** Thumbnail URLs (the existing `/api/generations/{id}/thumb` unless the API lists its own). */
  thumbs: string[];
};

export type GalleryPage = { items: GalleryItem[]; nextCursor: string | null };
