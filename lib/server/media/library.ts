import "server-only";
import { MEDIA_CATALOG, MEDIA_PURPOSES, STUDIO_IMAGE_PURPOSE } from "../../media/catalog";
import { LIBRARY_CATEGORIES, cleanSlots, isLibraryCategory, templateError, type LibraryItem, type StudioTemplate } from "../../media/library";
import { ApiError } from "../api";
import { query, queryOne } from "../db";
import { availableModels } from "./availability";

/**
 * Public reads of the Studio library (docs/studio/P2B-SPEC.md): `GET /api/media/library?category=` and
 * `GET /api/media/templates`. Only enabled rows; only public fields (no seed keys, sort numbers, writers, timestamps);
 * a template is listed only when its model is a Studio picture model AVAILABLE right now (the same `availableModels` the
 * generations route refuses with) and it still validates against the catalog ParamSchema (`templateError`).
 *
 * The rows are cached in-process for 30 s (an admin write in this process drops the cache at once; other processes
 * catch up within the TTL). Availability is NOT cached here: it is read per request, through its own 30 s caches.
 */

export const LIBRARY_TTL_MS = 30_000;

type PromptRow = { id: string; category: string; title: string; prompt: string; preview_id: string | null };
type TemplateRow = { id: string; category: string; title: string; model_id: string; params: unknown; skeleton: string; slots: unknown; preview_id: string | null };

let cache: { at: number; prompts: PromptRow[]; templates: TemplateRow[] } | null = null;

/** Drops this process's cache (after an admin write; tests). */
export function invalidateLibrary(): void {
  cache = null;
}

async function rows(): Promise<{ prompts: PromptRow[]; templates: TemplateRow[] }> {
  if (cache && Date.now() - cache.at < LIBRARY_TTL_MS) return cache;
  const [prompts, templates] = await Promise.all([
    query<PromptRow>(`SELECT id::text AS id, category, title, prompt, preview_id FROM studio_prompts WHERE enabled ORDER BY category, sort, id`),
    query<TemplateRow>(
      `SELECT id::text AS id, category, title, model_id, params, skeleton, slots, preview_id FROM studio_templates WHERE enabled ORDER BY sort, id`,
    ),
  ]);
  cache = { at: Date.now(), prompts, templates };
  return cache;
}

export const previewUrl = (id: string | null): string | null => (id ? `/api/media/library/preview/${id}` : null);

export type LibraryResponse = { categories: { id: string; label: string; count: number }[]; items: LibraryItem[] };

/** The enabled prompts (all, or one category's), categories in their fixed order with their counts. */
export async function publicLibrary(category: string | null): Promise<LibraryResponse> {
  if (category !== null && category !== "" && !isLibraryCategory(category)) throw new ApiError("Noma'lum toifa", 400);
  const { prompts } = await rows();
  const counts = new Map<string, number>();
  for (const p of prompts) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  const known = new Set<string>(LIBRARY_CATEGORIES.map((c) => c.id));
  const items = prompts
    .filter((p) => known.has(p.category) && (!category || p.category === category))
    .map((p) => ({ id: p.id, category: p.category, title: p.title, prompt: p.prompt, previewUrl: previewUrl(p.preview_id) }));
  return {
    categories: LIBRARY_CATEGORIES.filter((c) => (counts.get(c.id) ?? 0) > 0).map((c) => ({ id: c.id, label: c.label, count: counts.get(c.id)! })),
    items,
  };
}

/** A stored template as the public shape, or `null` when it does not validate against the catalog any more. */
export function publicTemplate(r: TemplateRow): StudioTemplate | null {
  const studio = MEDIA_PURPOSES.byId(STUDIO_IMAGE_PURPOSE)!.allowed.includes(r.model_id);
  const model = studio ? MEDIA_CATALOG.byId(r.model_id) : null;
  if (templateError({ modelId: r.model_id, params: r.params, skeleton: r.skeleton, slots: r.slots }, model)) return null;
  return {
    id: r.id,
    category: r.category,
    title: r.title,
    modelId: r.model_id,
    params: { ...(r.params as Record<string, unknown>) },
    skeleton: r.skeleton,
    slots: cleanSlots(r.slots as Record<string, unknown>[]),
    previewUrl: previewUrl(r.preview_id),
  };
}

/** The enabled, valid templates whose model can be sold right now. */
export async function publicTemplates(): Promise<{ items: StudioTemplate[] }> {
  const [{ templates }, available] = await Promise.all([rows(), availableModels(STUDIO_IMAGE_PURPOSE)]);
  const ok = new Set(available);
  return { items: templates.filter((t) => ok.has(t.model_id)).map(publicTemplate).filter((t): t is StudioTemplate => t !== null) };
}

/** A preview picture (public: previews are curated catalog art, never user content). */
export async function libraryPreview(id: string): Promise<{ mime: string; bytes: Buffer } | null> {
  if (!/^[0-9a-f]{24}$/.test(id)) return null;
  return queryOne<{ mime: string; bytes: Buffer }>(`SELECT mime, bytes FROM studio_library_previews WHERE id = $1`, [id]);
}
