import { ApiError, handler, json, limit, requireUser } from "@/lib/server/api";
import { rebuildFile } from "@/lib/server/slide-commit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** PPTX yasash rasmlar bilan bir necha soniya oladi — 60 s. */
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PPTX ni joriy `doc` dan qayta yasaydi.
 *
 * Ataylab WORKER EMAS, so'rov ichida sinxron: `claimJob` qatorni
 * `IN_PROGRESS` ga o'tkazardi va ko'ruvchi tahrir o'rtasida
 * «Yaratilmoqda» holatiga tushib qolardi.
 *
 * Klient buni oxirgi tahrirdan 3 s keyin chaqiradi (`REBUILD_DEBOUNCE_MS`),
 * shuning uchun soatiga 30 ta — normal ish uchun ko'p, ketma-ket
 * chaqirish uchun to'siq. `file_version >= doc_version` bo'lsa render
 * umuman qilinmaydi (`rebuilt: false`).
 */
export const POST = handler("generations/rebuild", async (req, ctx: Ctx) => {
  const { user } = await requireUser(req);
  const { id } = await ctx.params;
  if (!UUID.test(id)) throw new ApiError("Noto'g'ri id", 400);

  await limit(`rebuild:${user.id}`, 30, 3600);

  return json(await rebuildFile(id, user.id));
});
