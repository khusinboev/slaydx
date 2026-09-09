import { ApiError, handler, json, requireUser } from "@/lib/server/api";
import { cancelGeneration, deleteGeneration, getGeneration } from "@/lib/server/jobs";
import { hasGenerationFile } from "@/lib/server/storage";
import { refund } from "@/lib/server/credits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `?since=` so'rov parametrini o'qiydi (L4 — jonli poll).
 *
 * Klient oxirgi ko'rgan `liveSeq` ni yuboradi. Noto'g'ri qiymat (raqam
 * emas, manfiy) — e'tiborsiz qoldiriladi (`undefined`), ya'ni server
 * o'zgarish bo'lgan-bo'lmaganidan qat'iy nazar `live` ni qaytaradi.
 */
export function parseSince(req: Request): number | undefined {
  const raw = new URL(req.url).searchParams.get("since");
  if (raw === null) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Bitta generatsiya holati — klient shu endpointni polling qiladi. */
export const GET = handler("generations/get", async (req, ctx: Ctx) => {
  const { user } = await requireUser(req);
  const { id } = await ctx.params;
  if (!UUID.test(id)) throw new ApiError("Noto'g'ri id", 400);

  const since = parseSince(req);
  const gen = await getGeneration(id, user.id, { since });
  if (!gen) throw new ApiError("Topilmadi", 404);

  const hasFile = gen.status === "COMPLETED" ? await hasGenerationFile(id, user.id) : false;
  // `live` faqat `getGeneration` uni qaytarganda qo'shiladi — kalit
  // umuman yo'q bo'lsa klient eskisini saqlaydi (`mergeLive`).
  const { live, ...rest } = gen;
  const body = "live" in gen ? { ...rest, live, hasFile } : { ...rest, hasFile };
  return json({ generation: body });
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
