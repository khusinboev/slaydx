import "server-only";
import { resolveModel, type ClientEntry } from "../../studio-core";
import { MEDIA_CATALOG, MEDIA_PURPOSES, STUDIO_PURPOSES } from "../../media/catalog";
import { ALL_EFFECT_SCENES, STUDIO_VIDEO_PURPOSE } from "../../media/catalog-video";
import type { MediaPricing } from "../../media/studio-pricing";
import { ApiError } from "../api";
import { query } from "../db";
import { decodeCursor, encodeCursor, type ListCursor } from "../jobs";
import { inAdminPreview } from "../log";
import { availableModels, modelSwitchedOn, studioVideoModels } from "./availability";
import { mediaOverrides, type OverrideMap } from "./overrides";
import { mediaPricing } from "./pricing";
import { STUDIO_SPEECH_PURPOSE } from "../../media/catalog-speech";
import { studioSpeechModels } from "./voices";
import { MUSIC_MODEL, STUDIO_AUDIO_LISTING } from "../../media/catalog-audio";
import { studioAudioModels } from "./audio-inputs";
import { speechToolModels } from "./speech-sources";
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

/** A model only an admin can see right now says so on its card. */
function clientEntry(id: string, overrides: OverrideMap): ClientEntry {
  const view = CLIENT.get(id)!;
  const entry = MEDIA_CATALOG.byId(id)!;
  if (!inAdminPreview() || modelSwitchedOn(entry, overrides.get(id)?.enabled)) return view;
  return { ...view, label: `${view.label} · sinov` };
}

/**
 * Purposes this endpoint serves: Studio pickers, priced cost × markup by `studio-pricing.ts` (the `pricing` block is
 * only true for them). «Rasm» / «Video» keep their own forms and ladders; internal purposes are never public.
 * P2b: + the edit / upscale / background-removal purposes (same tool, same pricing block). P3 / P5 add theirs here.
 */
export const CATALOG_PURPOSES: ReadonlySet<string> = new Set([...STUDIO_PURPOSES, STUDIO_VIDEO_PURPOSE, STUDIO_SPEECH_PURPOSE]);

export async function mediaCatalog(purposeId: string): Promise<CatalogResponse> {
  // P6: the «Audio» tab lists its modes at once (P9: «Musiqa» has two models) — a listing id, not a job purpose.
  if (purposeId === STUDIO_AUDIO_LISTING) {
    // P10: + «Transkripsiya» / «Dublyaj» (their own switches; listed after the four modes, priced by the same block).
    const [available, tools, pricing, overrides] = await Promise.all([studioAudioModels(), speechToolModels(), mediaPricing(), mediaOverrides()]);
    return {
      purpose: purposeId,
      defaultModelId: available.includes(MUSIC_MODEL) ? MUSIC_MODEL : (available[0] ?? null),
      models: [...available, ...tools].map((id) => clientEntry(id, overrides)),
      pricing,
    };
  }
  if (!CATALOG_PURPOSES.has(purposeId) || !MEDIA_PURPOSES.byId(purposeId)) throw new ApiError("Noma'lum maqsad", 400);
  // The Video tab also follows the paid-video switch `video.enabled` (off = no model listed, the route refuses too).
  // P5: the «Ovoz» tab follows `studio.voice.enabled` and Gemini's `TTS_GEMINI_MODEL` (`studioSpeechModels`).
  const [available, pricing, overrides] = await Promise.all([
    purposeId === STUDIO_VIDEO_PURPOSE ? studioVideoModels() : purposeId === STUDIO_SPEECH_PURPOSE ? studioSpeechModels() : availableModels(purposeId),
    mediaPricing(),
    mediaOverrides(),
  ]);
  const resolved = resolveModel(MEDIA_PURPOSES, purposeId, { available: (id) => available.includes(id) });
  return {
    purpose: purposeId,
    defaultModelId: resolved.ok ? resolved.modelId : null,
    models: available.map((id) => clientEntry(id, overrides)),
    pricing,
  };
}

export const GALLERY_PAGE = 24;

export type GalleryImage = { url: string; w: number | null; h: number | null };
/**
 * A clip in the gallery (P3): played from the result file itself (`?inline=1`, HTTP Range). `requestedSeconds`, `aspect`,
 * `sound` and `effect` are what was BOUGHT, so «Qayta yaratish» re-opens the form at the same settings and price.
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
  /**
   * P11 §D: a clip of another tool («Montaj», «Dublyaj», a burned «Transkripsiya»): its `prompt` only names the job
   * («Subtitrli video») and its model is no Video tab model, so the card offers neither a repeat nor a next step.
   */
  derived: boolean;
};
/** A speech result in the gallery (P5): played from the MP3 itself (`?inline=1`). */
export type GalleryAudio = { src: string; seconds: number | null; voices: string[]; clone: boolean };
/** A transcript in the gallery (P11 §D): the text's head and its language; the result page has the whole text and the subtitles. */
export type GalleryText = { excerpt: string; language: string | null };
/**
 * What a gallery item is, by its tool and result: `image` (Rasm), `video` (Video; a «Montaj» / «Dublyaj» / burned
 * «Transkripsiya» MP4), `audio` (Ovoz, Audio, a «Montaj» / «Dublyaj» MP3; P8b: a podcast / greeting while folded),
 * `text` (a «Transkripsiya» without a burn). The gallery filters by it (`?kind=`).
 */
export type GalleryKind = "image" | "video" | "audio" | "text";
export const GALLERY_KINDS: readonly GalleryKind[] = ["image", "video", "audio", "text"];
export type GalleryItem = {
  id: string;
  kind: GalleryKind;
  /** The speech of an audio item, `null` otherwise. */
  audio: GalleryAudio | null;
  /** The transcript of a text item, `null` otherwise. */
  text: GalleryText | null;
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
  kind: string;
  created_at: Date;
  cursor_ts: string;
  topic: string;
  model: string | null;
  prompt: string | null;
  images: unknown;
  video: unknown;
  speech: unknown;
  transcribe: unknown;
  favorite: boolean;
};

function audioOf(id: string, raw: unknown): GalleryAudio {
  const s = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const voices = Array.isArray(s.voices) ? s.voices.filter((v): v is string => typeof v === "string").slice(0, 4) : [];
  return { src: `/api/generations/${id}/file?inline=1`, seconds: num(s.seconds), voices, clone: s.clone === true };
}

/** How much of a transcript the gallery card shows. */
export const GALLERY_TEXT_EXCERPT = 280;

function textOf(raw: unknown): GalleryText {
  const t = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const text = typeof t.text === "string" ? t.text.replace(/\s+/g, " ").trim() : "";
  const language = typeof t.language === "string" && t.language ? t.language : typeof t.requestedLanguage === "string" && t.requestedLanguage ? t.requestedLanguage : null;
  return { excerpt: text.length > GALLERY_TEXT_EXCERPT ? `${text.slice(0, GALLERY_TEXT_EXCERPT - 1)}…` : text, language };
}

/** The `?kind=` of the gallery route: one of the kinds, or none; anything else is a 400. */
export function parseGalleryKind(raw: string | null): GalleryKind | null {
  if (raw === null || raw === "") return null;
  if ((GALLERY_KINDS as readonly string[]).includes(raw)) return raw as GalleryKind;
  throw new ApiError("Noto'g'ri tur", 400);
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

function videoOf(id: string, raw: unknown, derived: boolean): GalleryVideo {
  const v = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const effect = ALL_EFFECT_SCENES.find((e) => e.id === v.effect) ?? null;
  return {
    src: `/api/generations/${id}/file?inline=1`,
    seconds: num(v.seconds),
    requestedSeconds: effect ? null : num(v.requestedSeconds),
    aspect: typeof v.aspect === "string" && v.aspect ? v.aspect : null,
    sound: typeof v.sound === "boolean" ? v.sound : null,
    effect: effect?.id ?? null,
    effectLabel: effect?.label ?? null,
    derived,
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
 * The kind of a stored result, in SQL (the filter and the item read the same expression): the Rasm tool's pictures, the
 * Video tool's clips, a «Montaj» / «Dublyaj» MP4 or a burned «Transkripsiya» (only these three look inside `doc_json`, so
 * the common tools never pay for reading a large document), a transcript
 * without a burn, else an audio (Ovoz, Audio, a «Montaj» / «Dublyaj» MP3, a folded podcast / greeting).
 */
const KIND_SQL = `CASE WHEN tool_id = 'studio-image' THEN 'image'
                       WHEN tool_id = 'studio-video' THEN 'video'
                       WHEN tool_id IN ('studio-mix', 'studio-dub', 'studio-transcribe') AND doc_json ? 'video' THEN 'video'
                       WHEN tool_id = 'studio-transcribe' THEN 'text'
                       ELSE 'audio' END`;

/**
 * P7b «Sevimlilar» (`favorites: true`): only the starred items, with the same order and keyset cursor (a cursor of
 * the full list is a valid starting point of the filtered one — both are ordered by `created_at, id`). P11 §D `kind`:
 * only the items of that kind, the same way. Ownership stays in the inner WHERE (`user_id = $1`): no filter widens it.
 */
export async function studioGallery(
  userId: string,
  cursor: ListCursor | null,
  limit = GALLERY_PAGE,
  opts: { favorites?: boolean; kind?: GalleryKind | null } = {},
): Promise<{ items: GalleryItem[]; nextCursor: string | null }> {
  // P8b: podcast / greeting results join the gallery (kind audio) only while `studio.legacy_fold` is on.
  const tools = await studioGalleryToolIds();
  const rows = await query<Row>(
    `SELECT g.id, g.tool_id, g.kind, g.created_at, g.topic,
            EXISTS (SELECT 1 FROM studio_favorites f WHERE f.user_id = $1 AND f.generation_id = g.id) AS favorite,
            to_char(g.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS cursor_ts,
            COALESCE(g.doc_json->>'imageModel', g.doc_json->'video'->>'model', g.doc_json->'speech'->>'model', g.doc_json->'studioAudio'->>'model',
                     g.doc_json->'transcribe'->>'model', g.doc_json->'dub'->>'model') AS model,
            COALESCE(g.doc_json->>'imagePrompt', g.doc_json->'video'->>'prompt', g.doc_json->'studioAudio'->>'prompt') AS prompt,
            g.doc_json->'images' AS images, g.doc_json->'video' AS video,
            COALESCE(g.doc_json->'speech', g.doc_json->'studioAudio', g.doc_json->'audio', g.doc_json->'mix', g.doc_json->'dub') AS speech,
            g.doc_json->'transcribe' AS transcribe
       FROM (SELECT id, tool_id, created_at, topic, doc_json, ${KIND_SQL} AS kind
               FROM generations
              WHERE user_id = $1 AND tool_id = ANY($6::text[]) AND status = 'COMPLETED' AND files_purged_at IS NULL) g
      WHERE ($2::timestamp IS NULL
             OR (g.created_at <= ($2::timestamp AT TIME ZONE 'UTC')
                 AND (g.created_at < ($2::timestamp AT TIME ZONE 'UTC') OR g.id < $3::uuid)))
        AND (NOT $5::boolean OR EXISTS (SELECT 1 FROM studio_favorites f WHERE f.user_id = $1 AND f.generation_id = g.id))
        AND ($7::text IS NULL OR g.kind = $7)
      ORDER BY g.created_at DESC, g.id DESC
      LIMIT $4`,
    [userId, cursor?.ts ?? null, cursor?.id ?? null, limit + 1, opts.favorites === true, tools, opts.kind ?? null],
  );
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => {
      const kind: GalleryKind = r.kind === "video" ? "video" : r.kind === "text" ? "text" : r.kind === "image" ? "image" : "audio";
      return {
        id: r.id,
        kind,
        // P6: an «Audio» result is an audio item too (the result file is always one MP3).
        audio: kind === "audio" ? audioOf(r.id, r.speech) : null,
        text: kind === "text" ? textOf(r.transcribe) : null,
        createdAt: new Date(r.created_at).toISOString(),
        modelId: r.model,
        // A podcast / greeting has no Studio model: the card names the tool («Podkast», «Tabriknoma»); a «Montaj» (its
        // `studio/mix-*` id is no catalog model) names itself.
        modelLabel: (r.model ? MEDIA_CATALOG.byId(r.model)?.label : null) ?? (isVoiceTemplate(r.tool_id) ? TOOL_BY_SLUG[r.tool_id]!.title : r.tool_id === "studio-mix" ? "Montaj" : null),
        // An effect clip has no prompt: the topic names it («Effekt: …»).
        prompt: r.prompt || r.topic,
        images: kind === "image" ? imagesOf(r.id, r.images) : [],
        video: kind === "video" ? videoOf(r.id, r.video, r.tool_id !== "studio-video") : null,
        fileUrl: `/api/generations/${r.id}/file`,
        favorite: r.favorite === true,
      };
    }),
    nextCursor: rows.length > limit && last ? encodeCursor({ ts: last.cursor_ts, id: last.id }) : null,
  };
}
