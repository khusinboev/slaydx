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
import { STUDIO_SPEECH_PURPOSE } from "../../media/catalog-speech";
import { studioSpeechModels } from "./voices";
import { MUSIC_MODEL, STUDIO_AUDIO_LISTING } from "../../media/catalog-audio";
import { studioAudioModels } from "./audio-inputs";
import { studioGalleryToolIds } from "./favorites";
import { TOOL_BY_SLUG } from "../../tools";
import { isVoiceTemplate } from "../../media/voice-templates";

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
export const CATALOG_PURPOSES: ReadonlySet<string> = new Set([...STUDIO_PURPOSES, STUDIO_VIDEO_PURPOSE, STUDIO_SPEECH_PURPOSE]);

export async function mediaCatalog(purposeId: string): Promise<CatalogResponse> {
  // P6: the «Audio» tab lists its four modes at once (one model per purpose) — a listing id, not a job purpose.
  if (purposeId === STUDIO_AUDIO_LISTING) {
    const [available, pricing] = await Promise.all([studioAudioModels(), mediaPricing()]);
    return {
      purpose: purposeId,
      defaultModelId: available.includes(MUSIC_MODEL) ? MUSIC_MODEL : (available[0] ?? null),
      models: available.map((id) => CLIENT.get(id)!),
      pricing,
    };
  }
  if (!CATALOG_PURPOSES.has(purposeId) || !MEDIA_PURPOSES.byId(purposeId)) throw new ApiError("Noma'lum maqsad", 400);
  // The Video tab also follows the paid-video switch `video.enabled` (off = no model listed, the route refuses too).
  // P5: the «Ovoz» tab follows `studio.voice.enabled` and Gemini's `TTS_GEMINI_MODEL` (`studioSpeechModels`).
  const [available, pricing] = await Promise.all([
    purposeId === STUDIO_VIDEO_PURPOSE ? studioVideoModels() : purposeId === STUDIO_SPEECH_PURPOSE ? studioSpeechModels() : availableModels(purposeId),
    mediaPricing(),
  ]);
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
/** A speech result in the gallery (P5): played from the MP3 itself (`?inline=1`). */
export type GalleryAudio = { src: string; seconds: number | null; voices: string[]; clone: boolean };
export type GalleryItem = {
  id: string;
  /** `image` (Rasm tab), `video` (Video tab) or `audio` (Ovoz tab, P5; P8b: also a podcast / greeting while folded). */
  kind: "image" | "video" | "audio";
  /** The speech of an audio item, `null` otherwise. */
  audio: GalleryAudio | null;
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
  /** P7b: the user starred it (`studio_favorites`, read with the owner in the WHERE). */
  favorite: boolean;
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
  speech: unknown;
  favorite: boolean;
};

function audioOf(id: string, raw: unknown): GalleryAudio {
  const s = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const voices = Array.isArray(s.voices) ? s.voices.filter((v): v is string => typeof v === "string").slice(0, 4) : [];
  return { src: `/api/generations/${id}/file?inline=1`, seconds: num(s.seconds), voices, clone: s.clone === true };
}

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

/**
 * P7b «Sevimlilar» (`favorites: true`): only the starred items, with the same order and keyset cursor (a cursor of
 * the full list is a valid starting point of the filtered one — both are ordered by `created_at, id`).
 */
export async function studioGallery(
  userId: string,
  cursor: ListCursor | null,
  limit = GALLERY_PAGE,
  opts: { favorites?: boolean } = {},
): Promise<{ items: GalleryItem[]; nextCursor: string | null }> {
  // P8b: podcast / greeting results join the gallery (kind audio) only while `studio.legacy_fold` is on.
  const tools = await studioGalleryToolIds();
  const rows = await query<Row>(
    `SELECT id, tool_id, created_at, topic,
            EXISTS (SELECT 1 FROM studio_favorites f WHERE f.user_id = $1 AND f.generation_id = generations.id) AS favorite,
            to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS cursor_ts,
            COALESCE(doc_json->>'imageModel', doc_json->'video'->>'model', doc_json->'speech'->>'model', doc_json->'studioAudio'->>'model') AS model,
            COALESCE(doc_json->>'imagePrompt', doc_json->'video'->>'prompt', doc_json->'studioAudio'->>'prompt') AS prompt,
            doc_json->'images' AS images, doc_json->'video' AS video, COALESCE(doc_json->'speech', doc_json->'studioAudio', doc_json->'audio') AS speech
       FROM generations
      WHERE user_id = $1 AND tool_id = ANY($6::text[]) AND status = 'COMPLETED' AND files_purged_at IS NULL
        AND ($2::timestamp IS NULL
             OR (created_at <= ($2::timestamp AT TIME ZONE 'UTC')
                 AND (created_at < ($2::timestamp AT TIME ZONE 'UTC') OR id < $3::uuid)))
        AND (NOT $5::boolean OR EXISTS (SELECT 1 FROM studio_favorites f WHERE f.user_id = $1 AND f.generation_id = generations.id))
      ORDER BY created_at DESC, id DESC
      LIMIT $4`,
    [userId, cursor?.ts ?? null, cursor?.id ?? null, limit + 1, opts.favorites === true, tools],
  );
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => {
      const isVideo = r.tool_id === "studio-video";
      // P6: an «Audio» result is an audio item too (the result file is always one MP3).
      const isAudio = r.tool_id === "studio-speech" || r.tool_id === "studio-audio" || isVoiceTemplate(r.tool_id);
      return {
        id: r.id,
        kind: isAudio ? ("audio" as const) : isVideo ? ("video" as const) : ("image" as const),
        audio: isAudio ? audioOf(r.id, r.speech) : null,
        createdAt: new Date(r.created_at).toISOString(),
        modelId: r.model,
        // A podcast / greeting has no Studio model: the card names the tool («Podkast», «Tabriknoma»).
        modelLabel: r.model ? (MEDIA_CATALOG.byId(r.model)?.label ?? null) : isVoiceTemplate(r.tool_id) ? TOOL_BY_SLUG[r.tool_id]!.title : null,
        // An effect clip has no prompt: the topic names it («Effekt: …»).
        prompt: r.prompt || r.topic,
        images: isVideo || isAudio ? [] : imagesOf(r.id, r.images),
        video: isVideo ? videoOf(r.id, r.video) : null,
        fileUrl: `/api/generations/${r.id}/file`,
        favorite: r.favorite === true,
      };
    }),
    nextCursor: rows.length > limit && last ? encodeCursor({ ts: last.cursor_ts, id: last.id }) : null,
  };
}
