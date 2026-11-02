import { handler, json, limit } from "@/lib/server/api";
import { clientIp } from "@/lib/server/ratelimit";
import { publicTemplates } from "@/lib/server/media/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/media/templates` (docs/studio/P2B-SPEC.md, «Shablonlar»): the enabled templates whose model is available
 * RIGHT NOW and that still validate against the model's ParamSchema. Public fields only; rows cached ≤ 30 s.
 */
export const GET = handler("media/templates", async (req) => {
  await limit(`media:templates:${clientIp(req)}`, 120, 60);
  return json(await publicTemplates());
});
