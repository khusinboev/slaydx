import "server-only";
import { resolveModel, type ClientEntry } from "../../studio-core";
import { MEDIA_CATALOG, MEDIA_PURPOSES, STUDIO_IMAGE_PURPOSE } from "../../media/catalog";
import type { MediaPricing } from "../../media/studio-pricing";
import { ApiError } from "../api";
import { query } from "../db";
import { decodeCursor, encodeCursor, type ListCursor } from "../jobs";
import { availableModels } from "./availability";
import { mediaPricing } from "./pricing";

/**
 * The two public Studio reads (docs/studio/P1-SPEC.md «Session / API»).
 *
 * Catalog: what the picker may offer for a user-choosable purpose — the AVAILABLE models only (the same
 * `availableModels` the generations route refuses with), in catalog order, as their client view (no routes, no
 * upstream ids, no adapters), and the pricing block the browser prices with (the same object `effectivePrice` uses).
 *
 * Gallery: the user's own finished Studio pictures, newest first, keyset-paged; ownership is in the SQL
 * (`user_id = $1`), the cursor never widens it.
 */

export type CatalogResponse = {
  purpose: string;
  /** The model the picker starts on: the purpose default when available, else the first available; `null` = none. */
  defaultModelId: string | null;
  models: ClientEntry[];
  pricing: MediaPricing;
};

const CLIENT = new Map(MEDIA_CATALOG.clientView().map((e) => [e.id, e]));

/**
 * Purposes this endpoint serves: Studio pickers, priced cost × markup by `studio-pricing.ts` (the `pricing` block is
 * only true for them). «Rasm» / «Video» keep their own forms and ladders; internal purposes are never public.
 * P3 / P5 add their Studio purposes here.
 */
export const CATALOG_PURPOSES: ReadonlySet<string> = new Set([STUDIO_IMAGE_PURPOSE]);

export async function mediaCatalog(purposeId: string): Promise<CatalogResponse> {
  if (!CATALOG_PURPOSES.has(purposeId) || !MEDIA_PURPOSES.byId(purposeId)) throw new ApiError("Noma'lum maqsad", 400);
  const [available, pricing] = await Promise.all([availableModels(purposeId), mediaPricing()]);
  const resolved = resolveModel(MEDIA_PURPOSES, purposeId, { available: (id) => available.includes(id) });
  return {
    purpose: purposeId,
    defaultModelId: resolved.ok ? resolved.modelId : null,
    models: available.map((id) => CLIENT.get(id)!),
    pricing,
  };
}

export const GALLERY_PAGE = 24;

export type GalleryImage = { url: string; w: number | null; h: number | null };
export type GalleryItem = {
  id: string;
  createdAt: string;
  modelId: string | null;
  modelLabel: string | null;
  prompt: string;
  /** Pictures as stored with the result (`/api/generations/<id>/assets/<asset>`), the viewer's own URLs. */
  images: GalleryImage[];
  /** The packed result (one image or a zip): `/api/generations/<id>/file`. */
  fileUrl: string;
};

type Row = { id: string; created_at: Date; cursor_ts: string; topic: string; model: string | null; prompt: string | null; images: unknown };

const ASSET_URL = (id: string) => new RegExp(`^/api/generations/${id}/assets/[0-9a-f]+$`);

function imagesOf(id: string, raw: unknown): GalleryImage[] {
  if (!Array.isArray(raw)) return [];
  const re = ASSET_URL(id);
  const out: GalleryImage[] = [];
  for (const im of raw) {
    if (!im || typeof im !== "object") continue;
    const r = im as Record<string, unknown>;
    // Only the stored asset URLs: never a data: URL (bytes) or a provider URL.
    if (typeof r.url !== "string" || !re.test(r.url)) continue;
    out.push({ url: r.url, w: typeof r.w === "number" ? r.w : null, h: typeof r.h === "number" ? r.h : null });
  }
  return out;
}

export function parseGalleryCursor(raw: string | null): ListCursor | null {
  if (!raw) return null;
  const c = decodeCursor(raw);
  if (!c) throw new ApiError("Noto'g'ri kursor", 400);
  return c;
}

export async function studioGallery(userId: string, cursor: ListCursor | null, limit = GALLERY_PAGE): Promise<{ items: GalleryItem[]; nextCursor: string | null }> {
  const rows = await query<Row>(
    `SELECT id, created_at, topic,
            to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS cursor_ts,
            doc_json->>'imageModel' AS model, doc_json->>'imagePrompt' AS prompt, doc_json->'images' AS images
       FROM generations
      WHERE user_id = $1 AND tool_id = 'studio-image' AND status = 'COMPLETED' AND files_purged_at IS NULL
        AND ($2::timestamp IS NULL
             OR (created_at <= ($2::timestamp AT TIME ZONE 'UTC')
                 AND (created_at < ($2::timestamp AT TIME ZONE 'UTC') OR id < $3::uuid)))
      ORDER BY created_at DESC, id DESC
      LIMIT $4`,
    [userId, cursor?.ts ?? null, cursor?.id ?? null, limit + 1],
  );
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => ({
      id: r.id,
      createdAt: new Date(r.created_at).toISOString(),
      modelId: r.model,
      modelLabel: r.model ? (MEDIA_CATALOG.byId(r.model)?.label ?? null) : null,
      prompt: r.prompt ?? r.topic,
      images: imagesOf(r.id, r.images),
      fileUrl: `/api/generations/${r.id}/file`,
    })),
    nextCursor: rows.length > limit && last ? encodeCursor({ ts: last.cursor_ts, id: last.id }) : null,
  };
}
