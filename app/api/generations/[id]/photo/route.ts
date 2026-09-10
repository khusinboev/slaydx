import { ApiError, handler, json, limit, requireUser } from "@/lib/server/api";
import { uploadResumePhoto } from "@/lib/server/resume-photo-commit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Yuklash sof — AI chaqiruvi yo'q. 30 s yetadi (`slides/…/image` bilan bir xil). */
export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Rezyume suratini almashtirish (Rezyume 2, AUDIT-15).
 *
 * `multipart/form-data`: `file` (kesilgan PNG/JPEG), ixtiyoriy
 * `original` (asl surat — keyin qayta markazlash uchun), `shape`,
 * `crop` (JSON) va `baseVersion`. `remove=1` bo'lsa surat olib
 * tashlanadi.
 *
 * Route atayin yupqa — barcha tekshiruv `lib/server/resume-photo-commit.ts`
 * da (`slides/[index]/image/route.ts` bilan bir xil naqsh).
 */
export const POST = handler("generations/resume-photo", async (req, ctx: Ctx) => {
  const { user } = await requireUser(req);
  const { id } = await ctx.params;
  if (!UUID.test(id)) throw new ApiError("Noto'g'ri id", 400);

  await limit(`imgup:${user.id}`, 30, 3600);

  const generation = await uploadResumePhoto(req, id, user.id);
  return json({ generation });
});
