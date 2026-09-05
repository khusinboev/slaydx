import { ApiError, handler, json, requireUser } from "@/lib/server/api";
import { cancelGeneration, deleteGeneration, getGeneration } from "@/lib/server/jobs";
import { hasGenerationFile } from "@/lib/server/storage";
import { refund } from "@/lib/server/credits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Bitta generatsiya holati — klient shu endpointni polling qiladi. */
export const GET = handler("generations/get", async (req, ctx: Ctx) => {
  const { user } = await requireUser(req);
  const { id } = await ctx.params;
  if (!UUID.test(id)) throw new ApiError("Noto'g'ri id", 400);

  const gen = await getGeneration(id, user.id);
  if (!gen) throw new ApiError("Topilmadi", 404);

  const hasFile = gen.status === "COMPLETED" ? await hasGenerationFile(id, user.id) : false;
  return json({ generation: { ...gen, hasFile } });
});

/**
 * O'chirish. Navbatdagi ish avval bekor qilinadi va puli qaytariladi.
 *
 * Fayl va aktivlar ALOHIDA o'chirilmaydi: `generation_files` ham,
 * `generation_assets` ham `generations(id)` ga `ON DELETE CASCADE` bilan
 * bog'langan, shuning uchun qator o'chishi bilan baytlar ham ketadi.
 *
 * Ilgari bu yerda `deleteGenerationFile(id)` egalik tekshiruvidan OLDIN
 * chaqirilardi va u `user_id` ni so'ramasdi — begona `id` bilan kelgan
 * so'rov 409 olsa ham, fayl allaqachon o'chgan bo'lardi. Aktivlar esa
 * umuman o'chmasdi va TTL gacha bazada qolib ketardi.
 */
export const DELETE = handler("generations/delete", async (req, ctx: Ctx) => {
  const { user } = await requireUser(req);
  const { id } = await ctx.params;
  if (!UUID.test(id)) throw new ApiError("Noto'g'ri id", 400);

  const cancelled = await cancelGeneration(id, user.id);
  if (cancelled) {
    await refund(user.id, id, "Foydalanuvchi bekor qildi");
  }

  const removed = await deleteGeneration(id, user.id);
  if (!removed && !cancelled) {
    throw new ApiError("Ishlayotgan hujjatni o'chirib bo'lmaydi", 409);
  }
  return json({ ok: true, refunded: cancelled });
});
