import { handler, json, requireUser } from "@/lib/server/api";
import { parseGalleryCursor, studioGallery } from "@/lib/server/media/public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/media/gallery?cursor=` (docs/studio/P1-SPEC.md): the signed-in user's finished Studio pictures, newest
 * first, 24 per page, `nextCursor` = `null` on the last page. Ownership is in the SQL; another user's job never appears.
 * P7b: `&favorites=1` lists only the starred items («Sevimlilar»); every item carries its `favorite` flag.
 */
export const GET = handler("media/gallery", async (req) => {
  const { user } = await requireUser(req);
  const search = new URL(req.url).searchParams;
  const cursor = parseGalleryCursor(search.get("cursor"));
  return json(await studioGallery(user.id, cursor, undefined, { favorites: search.get("favorites") === "1" }));
});
