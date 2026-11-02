import { handler, json, limit, requireUser } from "@/lib/server/api";
import { uploadStudioInput } from "@/lib/server/media/inputs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `POST /api/media/inputs` (docs/studio/P2B-SPEC.md, «Rasm yuklash»): one picture (`multipart/form-data` field `file`,
 * PNG / JPEG ≤ 5 MB, ≤ 4096 px) for a Studio edit / upscale / background-removal job. Answer:
 * `{ assetId, mime, size, w, h }`; the picture is shown back through `/api/uploads/photo/<assetId>` (owner only).
 * 30 uploads / 5 min per user; the storage quota is the photo quota (`withUploadQuota`).
 */
export const POST = handler("media/inputs", async (req) => {
  const { user } = await requireUser(req);
  await limit(`media:inputs:${user.id}`, 30, 300);
  return json(await uploadStudioInput(req, user.id));
});
