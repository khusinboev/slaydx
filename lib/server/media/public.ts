import "server-only";
import { resolveModel, type ClientEntry } from "../../studio-core";
import { MEDIA_CATALOG, MEDIA_PURPOSES, STUDIO_PURPOSES } from "../../media/catalog";
import { KLING_EFFECT_SCENES, STUDIO_VIDEO_PURPOSE } from "../../media/catalog-video";
import type { MediaPricing } from "../../media/studio-pricing";
import { ApiError } from "../api";
import { query } from "../db";
import { decodeCursor, encodeCursor, type ListCursor } from "../jobs";
import { availableModels, studioVideoModels } from "./availability";
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
 * P2b: + the edit / upscale / background-removal purposes (same tool, same pricing block). P3 / P5 add theirs here.
 */
export const CATALOG_PURPOSES: ReadonlySet<string> = new Set([...STUDIO_PURPOSES, STUDIO_VIDEO_PURPOSE]);

export async function mediaCatalog(purposeId: string): Promise<CatalogResponse> {
  if (!CATALOG_PURPOSES.has(purposeId) || !MEDIA_PURPOSES.byId(purposeId)) throw new ApiError("Noma'lum maqsad", 400);
  // The Video tab also follows the paid-video switch `video.enabled` (off = no model listed, the route refuses too).
  const [available, pricing] = await Promise.all([purposeId === STUDIO_VIDEO_PURPOSE ? studioVideoModels() : availableModels(purposeId), mediaPricing()]);
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
/**
 * A clip in the gallery (P3): played from the result file itself (`?inline=1`, HTTP Range). `requestedSeconds`, `aspect`,
 * `sound` and `effect` are what was BOUGHT, so «Yana yaratish» re-opens the form at the same settings and price.
 */
export type GalleryVideo = {
  src: string;
  /** Length of the delivered MP4. */
  seconds: number | null;
  /** Length paid for (`null` for an effect: one fixed clip). */
  requestedSeconds: number | null;
  aspect: string | null;
  /** Sound was bought (Kling); `null` when the result does not say. */
  sound: boolean | null;
  /** Kling `effect_scene` id of an effect clip. */
  effect: string | null;
  effectLabel: string | null;
};
export type GalleryItem = {
  id: string;
  /** `image` (Rasm tab) or `video` (Video tab). */
  kind: "image" | "video";
  createdAt: string;
  modelId: string | null;
  modelLabel: string | null;
  prompt: string;
  /** Pictures as stored with the result (`/api/generations/<id>/assets/<asset>`), the viewer's own URLs; `[]` for a clip. */
  images: GalleryImage[];
  /** The clip of a video item, `null` for pictures. */
  video: GalleryVideo | null;
  /** The packed result (one image, a zip, or the MP4): `/api/generations/<id>/file`. */
  fileUrl: string;
};

type Row = {
  id: string;
  tool_id: string;
  created_at: Date;
  cursor_ts: string;
  topic: string;
  model: string | null;
  prompt: string | null;
  images: unknown;
  video: unknown;
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

function videoOf(id: string, raw: unknown): GalleryVideo {
  const v = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const effect = KLING_EFFECT_SCENES.find((e) => e.id === v.effect) ?? null;
  return {
    src: `/api/generations/${id}/file?inline=1`,
    seconds: num(v.seconds),
    requestedSeconds: effect ? null : num(v.requestedSeconds),
    aspect: typeof v.aspect === "string" && v.aspect ? v.aspect : null,
    sound: typeof v.sound === "boolean" ? v.sound : null,
    effect: effect?.id ?? null,
    effectLabel: effect?.label ?? null,
  };
}

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
    `SELECT id, tool_id, created_at, topic,
            to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS cursor_ts,
            COALESCE(doc_json->>'imageModel', doc_json->'video'->>'model') AS model,
            COALESCE(doc_json->>'imagePrompt', doc_json->'video'->>'prompt') AS prompt,
            doc_json->'images' AS images, doc_json->'video' AS video
       FROM generations
      WHERE user_id = $1 AND tool_id IN ('studio-image', 'studio-video') AND status = 'COMPLETED' AND files_purged_at IS NULL
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
    items: page.map((r) => {
      const isVideo = r.tool_id === "studio-video";
      return {
        id: r.id,
        kind: isVideo ? ("video" as const) : ("image" as const),
        createdAt: new Date(r.created_at).toISOString(),
        modelId: r.model,
        modelLabel: r.model ? (MEDIA_CATALOG.byId(r.model)?.label ?? null) : null,
        // An effect clip has no prompt: the topic names it («Effekt: …»).
        prompt: r.prompt || r.topic,
        images: isVideo ? [] : imagesOf(r.id, r.images),
        video: isVideo ? videoOf(r.id, r.video) : null,
        fileUrl: `/api/generations/${r.id}/file`,
      };
    }),
    nextCursor: rows.length > limit && last ? encodeCursor({ ts: last.cursor_ts, id: last.id }) : null,
  };
}
