import "server-only";
import { ApiError } from "../api";
import { queryOne } from "../db";
import { getSetting } from "../settings";
import { VOICE_TEMPLATE_TOOLS } from "../../media/voice-templates";

/**
 * Studio favourites (docs/studio/P7-SPEC.md «P7b»): the star on a result card or a gallery item. Free, no count limit.
 *
 * Ownership is in the SQL of every statement: a star is inserted only through `SELECT ... FROM generations WHERE id = $2
 * AND user_id = $1` (a finished Studio generation of THIS user), so another user's generation — or a job of another
 * tool — can never be starred; it answers 404, the same as a missing id. Removing a star deletes only the caller's own
 * row. The gallery reads the stars with the owner in its WHERE (`lib/server/media/public.ts`).
 */

/** The tools whose finished generations the Studio gallery lists — the same set `studioGallery` reads. */
export const STUDIO_GALLERY_TOOLS = ["studio-image", "studio-video", "studio-speech", "studio-audio"] as const;

/**
 * The tools the gallery and the stars read NOW: the Studio's own, plus podcast / greeting (P8b, kind audio) while the
 * dark switch `studio.legacy_fold` is on — off, exactly the Studio's own as before.
 */
export async function studioGalleryToolIds(): Promise<string[]> {
  const fold = (await getSetting("studio.legacy_fold")) === true;
  return fold ? [...STUDIO_GALLERY_TOOLS, ...VOICE_TEMPLATE_TOOLS] : [...STUDIO_GALLERY_TOOLS];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const notFound = () => new ApiError("Natija topilmadi", 404, { code: "not_found" });

/**
 * Stars (`on: true`) or un-stars one generation of the user; answers the new state. Starring twice is a no-op; un-starring
 * a generation that was never starred is too — but both require the generation to be the caller's own finished Studio
 * job (404 otherwise), so the endpoint never tells anyone whether another user's id exists.
 */
export async function setFavorite(userId: string, generationId: string, on: boolean): Promise<{ id: string; favorite: boolean }> {
  const id = generationId.trim().toLowerCase();
  if (!UUID_RE.test(id)) throw notFound();
  // P8b: podcast / greeting results are gallery items (and so starrable) only while `studio.legacy_fold` is on.
  const tools = await studioGalleryToolIds();
  const row = on
    ? await queryOne<{ id: string }>(
        `WITH g AS (
           SELECT id FROM generations
            WHERE id = $2::uuid AND user_id = $1 AND tool_id = ANY($3::text[]) AND status = 'COMPLETED'
         ), ins AS (
           INSERT INTO studio_favorites (user_id, generation_id) SELECT $1, id FROM g
           ON CONFLICT (user_id, generation_id) DO NOTHING
         )
         SELECT id::text AS id FROM g`,
        [userId, id, tools],
      )
    : await queryOne<{ id: string }>(
        `WITH g AS (
           SELECT id FROM generations WHERE id = $2::uuid AND user_id = $1 AND tool_id = ANY($3::text[])
         ), del AS (
           DELETE FROM studio_favorites f USING g WHERE f.user_id = $1 AND f.generation_id = g.id
         )
         SELECT id::text AS id FROM g`,
        [userId, id, tools],
      );
  if (!row) throw notFound();
  return { id: row.id, favorite: on };
}
