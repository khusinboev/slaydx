import { handler, json, limit, requireUser } from "@/lib/server/api";
import { uploadPhoto } from "@/lib/server/photo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Rezyume surati (Rezyume 2). `multipart/form-data`: `file` (kesilgan),
 * `original` (ixtiyoriy asl), `crop` (JSON), `shape`.
 * Javob: `{ assetId, mime, size, shape, originalAssetId?, crop? }`.
 *
 * 20 ta / 5 daqiqa: kesish dialogida foydalanuvchi bir necha marta
 * qayta markazlashi normal hol, lekin har yuklash 5 MB gacha bayt.
 */
export const POST = handler("uploads-photo", async (req) => {
  const { user } = await requireUser(req);
  await limit(`photo:${user.id}`, 20, 300);
  return json(await uploadPhoto(req, user.id));
});
