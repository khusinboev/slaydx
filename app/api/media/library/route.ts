import { handler, json, limit } from "@/lib/server/api";
import { clientIp } from "@/lib/server/ratelimit";
import { publicLibrary } from "@/lib/server/media/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/media/library?category=` (docs/studio/P2B-SPEC.md, «Namuna promptlar»): the enabled library prompts — all,
 * or one category's — and the categories that have any. Public fields only; rows cached ≤ 30 s server-side.
 */
export const GET = handler("media/library", async (req) => {
  await limit(`media:library:${clientIp(req)}`, 120, 60);
  return json(await publicLibrary(new URL(req.url).searchParams.get("category")));
});
