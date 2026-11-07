import "server-only";
import { MEDIA_CATALOG, MEDIA_PURPOSES, STUDIO_IMAGE_PURPOSE } from "../../media/catalog";
import { STUDIO_VIDEO_PURPOSE, isAvatarModel } from "../../media/catalog-video";
import { categoriesOf, cleanSlots, isLibraryCategory, templateError, type LibraryItem, type LibraryMedia, type StudioTemplate, type TemplateMedia } from "../../media/library";
import type { CatalogEntry } from "../../studio-core";
import { ApiError } from "../api";
import { query, queryOne } from "../db";
import { availableModels, studioVideoModels } from "./availability";

/**
 * Public reads of the Studio library (docs/studio/P2B-SPEC.md): `GET /api/media/library?category=` and
 * `GET /api/media/templates`. Only enabled rows; only public fields (no seed keys, sort numbers, writers, timestamps);
 * a picture template is listed only when its model is a Studio picture model AVAILABLE right now (the same `availableModels`
 * the generations route refuses with) and it still validates against the catalog ParamSchema (`templateError`).
 *
 * A clip template (docs/studio/P11-SPEC.md package G) names a SUGGESTED model and is listed whichever models the admin turned
 * on, as long as any clip can be sold: the page applies it to the suggested model, else to the one on screen.
 *
 * The rows are cached in-process for 30 s (an admin write in this process drops the cache at once; other processes
 * catch up within the TTL). Availability is NOT cached here: it is read per request, through its own 30 s caches.
 */

export const LIBRARY_TTL_MS = 30_000;

type PromptRow = { id: string; media: LibraryMedia; category: string; title: string; prompt: string; preview_id: string | null };
type TemplateRow = { id: string; media?: TemplateMedia; category: string; title: string; model_id: string; params: unknown; skeleton: string; slots: unknown; preview_id: string | null };

let cache: { at: number; prompts: PromptRow[]; templates: TemplateRow[] } | null = null;

/** Drops this process's cache (after an admin write; tests). */
export function invalidateLibrary(): void {
  cache = null;
}

async function rows(): Promise<{ prompts: PromptRow[]; templates: TemplateRow[] }> {
  if (cache && Date.now() - cache.at < LIBRARY_TTL_MS) return cache;
  const [prompts, templates] = await Promise.all([
    query<PromptRow>(`SELECT id::text AS id, media, category, title, prompt, preview_id FROM studio_prompts WHERE enabled ORDER BY category, sort, id`),
    query<TemplateRow>(
      `SELECT id::text AS id, media, category, title, model_id, params, skeleton, slots, preview_id FROM studio_templates WHERE enabled ORDER BY sort, id`,
    ),
  ]);
  cache = { at: Date.now(), prompts, templates };
  return cache;
}

export const previewUrl = (id: string | null): string | null => (id ? `/api/media/library/preview/${id}` : null);

export type LibraryResponse = { categories: { id: string; label: string; count: number }[]; items: LibraryItem[] };

/** The enabled prompts of a kind (all, or one category's), categories in their fixed order with their counts. */
export async function publicLibrary(category: string | null, media: LibraryMedia = "image"): Promise<LibraryResponse> {
  if (category !== null && category !== "" && !isLibraryCategory(category, media)) throw new ApiError("Noma'lum toifa", 400);
  const { prompts } = await rows();
  const own = prompts.filter((p) => p.media === media);
  const counts = new Map<string, number>();
  for (const p of own) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  const known = categoriesOf(media);
  const items = own
    .filter((p) => known.some((c) => c.id === p.category) && (!category || p.category === category))
    .map((p) => ({ id: p.id, media: p.media, category: p.category, title: p.title, prompt: p.prompt, previewUrl: previewUrl(p.preview_id) }));
  return {
    categories: known.filter((c) => (counts.get(c.id) ?? 0) > 0).map((c) => ({ id: c.id, label: c.label, count: counts.get(c.id)! })),
    items,
  };
}

/**
 * The catalog model a template of `media` may name: a Studio drawing model, or a text / image → video model. An effect has
 * no prompt and an avatar's prompt is a script, so neither can carry a skeleton.
 */
export function templateModel(media: TemplateMedia, id: string): CatalogEntry | null {
  const purpose = MEDIA_PURPOSES.byId(media === "video" ? STUDIO_VIDEO_PURPOSE : STUDIO_IMAGE_PURPOSE)!;
  const entry = purpose.allowed.includes(id) ? MEDIA_CATALOG.byId(id) : null;
  if (!entry || (media === "video" && (entry.capabilities.includes("effect") || isAvatarModel(id)))) return null;
  return entry;
}

/** A stored template as the public shape, or `null` when it does not validate against the catalog any more. */
export function publicTemplate(r: TemplateRow): StudioTemplate | null {
  const media = r.media ?? "image";
  // A category the code no longer knows hides the row, as in the prompt library (review NIT-7).
  if (!isLibraryCategory(r.category, media)) return null;
  if (templateError({ modelId: r.model_id, params: r.params, skeleton: r.skeleton, slots: r.slots }, templateModel(media, r.model_id))) return null;
  return {
    id: r.id,
    media,
    category: r.category,
    title: r.title,
    modelId: r.model_id,
    params: { ...(r.params as Record<string, unknown>) },
    skeleton: r.skeleton,
    slots: cleanSlots(r.slots as Record<string, unknown>[]),
    previewUrl: previewUrl(r.preview_id),
  };
}

/** The enabled, valid templates of a kind that can be used right now: a picture's model on sale; for a clip, any clip model on sale. */
export async function publicTemplates(media: TemplateMedia = "image"): Promise<{ items: StudioTemplate[] }> {
  const [{ templates }, available] = await Promise.all([rows(), media === "video" ? studioVideoModels() : availableModels(STUDIO_IMAGE_PURPOSE)]);
  const ok = new Set(available);
  const usable = (t: TemplateRow) => (t.media ?? "image") === media && (media === "video" ? ok.size > 0 : ok.has(t.model_id));
  return { items: templates.filter(usable).map(publicTemplate).filter((t): t is StudioTemplate => t !== null) };
}

/** A preview picture (public: previews are curated catalog art, never user content). */
export async function libraryPreview(id: string): Promise<{ mime: string; bytes: Buffer } | null> {
  if (!/^[0-9a-f]{24}$/.test(id)) return null;
  return queryOne<{ mime: string; bytes: Buffer }>(`SELECT mime, bytes FROM studio_library_previews WHERE id = $1`, [id]);
}
