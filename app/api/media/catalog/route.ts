import { handler, json, limit, optionalUser } from "@/lib/server/api";
import { clientIp } from "@/lib/server/ratelimit";
import { mediaCatalog } from "@/lib/server/media/public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/media/catalog?purpose=studio.image` (docs/studio/P1-SPEC.md): the models the picker may offer RIGHT NOW
 * (provider on + keyed + not hidden by the admin), their ParamSchema and the pricing block the browser prices with.
 * Public data only: no routes, no upstream model ids, no adapters. Server-side caches keep it ≤ 30 s old (overrides
 * 30 s, settings 15 s, provider keys 30 s); the `expectedPrice` guard of the generations route covers the gap.
 */
export const GET = handler("media/catalog", async (req) => {
  await limit(`media:catalog:${clientIp(req)}`, 120, 60);
  // An admin also sees the models still off, marked «sinov» (`media/availability.ts`).
  await optionalUser(req);
  const purpose = new URL(req.url).searchParams.get("purpose") ?? "";
  return json(await mediaCatalog(purpose));
});
