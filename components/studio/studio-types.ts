import type { ClientEntry } from "@/lib/studio-core";
import type { MediaPricing } from "@/lib/media/studio-pricing";

/**
 * Wire shapes of the Studio API (docs/studio/P1-SPEC.md «Contract»). The parsers in `studio-api.ts` build these from
 * untrusted JSON, so the rest of the UI reads plain typed objects.
 */

/** `GET /api/media/catalog` → `pricing`: the server's block (`lib/media/studio-pricing.ts MediaPricing`), as sent. */
export type StudioPricing = MediaPricing;

/** `GET /api/media/catalog?purpose=…`: only models the user can use right now, in catalog order. */
export type MediaCatalog = {
  purpose: string;
  /** `null` when no model is available right now (the picker shows its «no model» state). */
  defaultModelId: string | null;
  models: ClientEntry[];
  pricing: StudioPricing;
};

/** A clip in the gallery (P3): played from the result file (`/api/generations/{id}/file?inline=1`). */
export type GalleryVideo = { src: string; seconds: number | null; aspect: string | null; effectLabel: string | null };

/** One completed Studio generation in the gallery. */
export type GalleryItem = {
  id: string;
  /** `image` (Rasm tab) or `video` (Video tab); an older server sends no kind = pictures. */
  kind: "image" | "video";
  /** The clip of a video item, `null` for pictures. */
  video: GalleryVideo | null;
  createdAt: string;
  modelId: string | null;
  modelLabel: string;
  prompt: string;
  /** Pictures in the job (a job of 4 shows «×4»). */
  count: number;
  /** The job's stored pictures (`/api/generations/{id}/assets/…`); empty when none is left — the card shows a placeholder. */
  thumbs: string[];
  /** The packed result (one image or a zip): `/api/generations/{id}/file`. */
  fileUrl: string;
};

export type GalleryPage = { items: GalleryItem[]; nextCursor: string | null };
