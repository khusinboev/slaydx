import { ApiError, handler, json, limit, requireUser } from "@/lib/server/api";
import { restoreDoc } from "@/lib/server/slide-commit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Tahrir sof hisob — LLM chaqiruvi yo'q. 30 s ortig'i bilan yetadi (`doc/route.ts` naqshi). */
export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Dekani BIRINCHI tahrirdan OLDINGI holatga qaytaradi («Asl holatga
 * qaytarish»).
 *
 * Tana yo'q — `baseVersion` ham kerak emas (bitta tugma). Mantiq
 * `lib/server/slide-commit.ts` dagi `restoreDoc`da (u yerda test bilan
 * qoplangan; route'ning o'zi `cookies()` ga bog'liq bo'lgani uchun
 * testdan chaqirilmaydi — `doc/route.ts` bilan bir xil naqsh).
 */
export const POST = handler("generations/doc-restore", async (req, ctx: Ctx) => {
  const { user } = await requireUser(req);
  const { id } = await ctx.params;
  if (!UUID.test(id)) throw new ApiError("Noto'g'ri id", 400);

  // Tahrir bilan bir xil limit hovuzi (`edit:${user.id}`) — restore ham
  // tahrir hisoblanadi.
  await limit(`edit:${user.id}`, 120, 60);

  const generation = await restoreDoc(id, user.id);
  return json({ generation });
});
