import { ApiError, handler, json, limit, requireUser } from "@/lib/server/api";
import { patchDocFromRequest } from "@/lib/server/slide-commit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Tahrir sof hisob — LLM chaqiruvi yo'q. 30 s ortig'i bilan yetadi. */
export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ko'ruvchidagi tahrirni yozadi.
 *
 * Tana — butun hujjat EMAS, operatsiyalar ro'yxati (`{baseVersion, ops}`):
 * hujum yuzasi kichik qoladi va server hech qachon klient yuborgan
 * dokni ishonchli deb qabul qilmaydi.
 *
 * Bu route atayin yupqa: egalik, holat, versiya qulfi va operatsiya
 * mantig'i — hammasi `lib/server/slide-commit.ts` da (u yerda test bilan
 * qoplangan; route'ning o'zi `cookies()` ga bog'liq bo'lgani uchun
 * testdan chaqirilmaydi — `tests/logo.test.mts` naqshi).
 */
export const PATCH = handler("generations/doc", async (req, ctx: Ctx) => {
  const { user } = await requireUser(req);
  const { id } = await ctx.params;
  if (!UUID.test(id)) throw new ApiError("Noto'g'ri id", 400);

  // Tahrir tez-tez keladi (har 400 ms koalessiya) — daqiqasiga 120 ta
  // yetarli, lekin cheksiz emas.
  await limit(`edit:${user.id}`, 120, 60);

  const generation = await patchDocFromRequest(req, id, user.id);
  return json({ generation });
});
