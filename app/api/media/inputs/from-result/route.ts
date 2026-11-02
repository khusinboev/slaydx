import { handler, json, limit, readJson, requireUser } from "@/lib/server/api";
import { importStudioResult } from "@/lib/server/media/inputs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/media/inputs/from-result` `{generationId, assetId}` (docs/studio/P2B-SPEC.md): «Tahrirlash» / «Sifatini
 * oshirish» / «Fonni olib tashlash» on a result card or gallery item — copies one picture of the user's OWN finished
 * Studio job into their inputs and answers `{ assetId, mime, size, w, h }`. Another user's job is a 404 (SQL ownership).
 */
export const POST = handler("media/inputs/from-result", async (req) => {
  const { user } = await requireUser(req);
  await limit(`media:inputs:${user.id}`, 30, 300);
  const body = await readJson<Record<string, unknown>>(req, 2 * 1024);
  return json(await importStudioResult(user.id, body ?? {}));
});
