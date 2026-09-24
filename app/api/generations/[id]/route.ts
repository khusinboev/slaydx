import { ApiError, handler, json, requireUser } from "@/lib/server/api";
import { cancelGeneration, deleteGeneration, generationStatus, getGeneration } from "@/lib/server/jobs";
import { hasGenerationFile } from "@/lib/server/storage";
import { log } from "@/lib/server/log";

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
  const s = raw.trim();
  if (!/^\d+$/.test(s)) return undefined;
  const n = Number(s);
  /*
   * int4 chegarasi (BEA-13): `since` SQL da `$3::int` — undan katta son 22003
   * «out of range» bilan 500 berardi. Soxta/buzuq klient uchun aniq 400.
   * Qoida W4-E `parseIntParam` (`lib/server/validate.ts`, `PG_INT4_MAX`) bilan
   * bir xil; u birlashgach shu tekshiruv o'shanga almashtiriladi.
   */
  if (!Number.isSafeInteger(n) || n > SINCE_MAX) throw new ApiError("Noto'g'ri since", 400);
  return n;
}

/** Postgres `int4` yuqori chegarasi (`live_seq` ham `INT`). */
const SINCE_MAX = 2_147_483_647;

/** Bitta generatsiya holati — klient shu endpointni polling qiladi. */
export const GET = handler("generations/get", async (req, ctx: Ctx) => {
  const { user } = await requireUser(req);
  const { id } = await ctx.params;
  if (!UUID.test(id)) throw new ApiError("Noto'g'ri id", 400);

  const since = parseSince(req);
  /*
   * `lean`: `values_json` o'qilmaydi, `doc` bor bo'lsa `html` qayta
   * yuborilmaydi (C09/SCALE-12). QUEUED bo'lsa javobda `queuePosition`
   * (1 dan) va `etaSec` (boshlanishigacha taxminiy soniya) bor.
   */
  const gen = await getGeneration(id, user.id, { since, lean: true });
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

  // Bekor qilish va pulni qaytarish BITTA tranzaksiyada (`cancelGeneration`, C25).
  const cancelled = await cancelGeneration(id, user.id);

  const removed = await deleteGeneration(id, user.id);
  if (!removed && !cancelled) {
    /*
     * Ikkalasi ham o'tmadi (BEA-12): qator yo'q/begona/allaqachon o'chirilgan
     * — 404 (ikkinchi bosish yoki eski ro'yxat «ishlayapti» degan xato
     * ko'rmasin); qator bor — u hozir ishlayapti (yoki shu lahzada holati
     * o'zgardi) — 409, qayta urinish mumkin.
     */
    if ((await generationStatus(id, user.id)) === null) throw new ApiError("Topilmadi", 404);
    throw new ApiError("Ishlayotgan hujjatni o'chirib bo'lmaydi", 409);
  }
  // Pul yo'li (bekor qilish = qaytarish): `reqId`/`userId` kontekstdan (C31).
  log("info", "[generations] o'chirildi", { jobId: id, genId: id, removed, cancelled, refunded: cancelled });
  return json({ ok: true, refunded: cancelled });
});
