import { handler, json, limit, requireUser } from "@/lib/server/api";
import { uploadLogo } from "@/lib/server/logo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Slayd logotipi yuklash (WP-F).
 *
 * `multipart/form-data`, maydon nomi `file`. Javob: `{ assetId, mime, size }`.
 * Qolgan hamma tekshiruv (hajm, sniff, saqlash) `lib/server/logo.ts`
 * (`uploadLogo`) da — bu yerda faqat autentifikatsiya va chastota
 * chegarasi.
 */
export const POST = handler("uploads-logo", async (req) => {
  const { user } = await requireUser(req);
  await limit(`logo:${user.id}`, 10, 300);
  const result = await uploadLogo(req, user.id);
  return json(result);
});
