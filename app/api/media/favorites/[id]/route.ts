import { handler, json, limit, requireUser } from "@/lib/server/api";
import { setFavorite } from "@/lib/server/media/favorites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * `PUT /api/media/favorites/<generationId>` stars, `DELETE` un-stars one of the user's own finished Studio results
 * (docs/studio/P7-SPEC.md «P7b»); both answer `{ id, favorite }` and are idempotent. Free, no count limit; another
 * user's (or a missing, or a non-Studio) generation is a 404 — ownership is in the SQL. The rate limit only stops a
 * runaway client (far above what a person clicks).
 */
async function toggle(req: Request, ctx: Ctx, on: boolean) {
  const { user } = await requireUser(req);
  await limit(`media:favorites:${user.id}`, 300, 300);
  const { id } = await ctx.params;
  return json(await setFavorite(String(user.id), id, on));
}

export const PUT = handler("media/favorites/put", (req: Request, ctx: Ctx) => toggle(req, ctx, true));
export const DELETE = handler("media/favorites/delete", (req: Request, ctx: Ctx) => toggle(req, ctx, false));
