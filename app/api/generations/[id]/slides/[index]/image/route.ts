import { ApiError, handler, json, limit, requireUser } from "@/lib/server/api";
import { uploadSlideImage } from "@/lib/server/slide-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Yuklash sof — AI chaqiruvi yo'q. 30 s yetadi (`uploads/logo` bilan bir xil). */
export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string; index: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Slayd rasmini QO'LDA yuklash (E5).
 *
 * `multipart/form-data`: `file` (PNG/JPEG) + `baseVersion` maydoni.
 * Qolgan hamma tekshiruv (hajm, sniff, egalik, versiya qulfi, maket
 * rasm joyi) — `lib/server/slide-image.ts` (`uploadSlideImage`) da, bu
 * route atayin yupqa (`doc`/`rebuild` route'lari bilan bir xil naqsh).
 */
export const POST = handler("generations/slide-image", async (req, ctx: Ctx) => {
  const { user } = await requireUser(req);
  const { id, index } = await ctx.params;
  if (!UUID.test(id)) throw new ApiError("Noto'g'ri id", 400);

  await limit(`imgup:${user.id}`, 30, 3600);

  const generation = await uploadSlideImage(req, id, user.id, Number(index));
  return json({ generation });
});
