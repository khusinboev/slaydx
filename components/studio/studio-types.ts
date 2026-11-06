import type { ClientEntry } from "@/lib/studio-core";
import type { MediaPricing } from "@/lib/media/studio-pricing";
import type { LibraryItem } from "@/lib/media/library";

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

/**
 * A clip in the gallery (P3): played from the result file itself (`/api/generations/{id}/file?inline=1`). `requestedSeconds`, `aspect`,
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

/** A speech result in the gallery (P5): played from the job's own MP3 (`/api/generations/{id}/file?inline=1`). */
export type GalleryAudio = { src: string; seconds: number | null; voices: string[]; clone: boolean };

/** A transcript in the gallery (P11 §D): the text's head and its language code. */
export type GalleryText = { excerpt: string; language: string | null };

/** What an item is: pictures, a clip (a «Montaj» / «Dublyaj» MP4 included), an audio, or a transcript (`text`). */
export type GalleryKind = "image" | "video" | "audio" | "text";
export const GALLERY_KINDS: readonly GalleryKind[] = ["image", "video", "audio", "text"];

/** One completed Studio generation in the gallery. */
export type GalleryItem = {
  id: string;
  /** The server's kind; an older server sends no kind = pictures. */
  kind: GalleryKind;
  /** The speech of an audio item (P5), `null` otherwise. */
  audio: GalleryAudio | null;
  /** The transcript of a text item (P11 §D), `null` otherwise. */
  text: GalleryText | null;
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
  /** P7b: the user starred it (the server's `studio_favorites`). */
  favorite: boolean;
};

export type GalleryPage = { items: GalleryItem[]; nextCursor: string | null };

/** `GET /api/media/library` (P2b): the categories that have prompts and the prompts. */
export type LibraryData = { categories: { id: string; label: string; count: number }[]; items: LibraryItem[] };
