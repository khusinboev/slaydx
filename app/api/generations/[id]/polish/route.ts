import { ApiError, handler, json, limit, readJson, requireUser } from "@/lib/server/api";
import { polishArticle } from "@/lib/server/article-polish";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** ≤6 `writer` chaqiruvi 2 to'lqinda (≤60 s) + baholovchi (≤35 s); DOCX qayta yasash alohida (`rebuild`). */
export const maxDuration = 150;

type Ctx = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * «Hammasini tuzatish» — avto-sayqal natija sahifasidan (Maqola 3, AUDIT-18 WP-A).
 *
 * Tana `{baseVersion}`; server hisobotdagi tuzatiladigan bandlarni o'zi
 * tuzatadi (`writer`), baholovchi (`judge`) bilan qayta baholaydi va faqat
 * ball OSHSA yozadi (Q-3). Javob `{generation, ops, polish}` — `rewrite`
 * bilan bir xil `generation` (klient `adopt` qiladi) + sayqal jurnali.
 *
 * BEPUL, lekin chegarali: maqola bo'yicha 3 marta/kun, foydalanuvchi
 * bo'yicha 20/kun (Q-1). Route yupqa: mantiq `lib/server/article-polish.ts`.
 */
export const POST = handler("generations/polish", async (req, ctx: Ctx) => {
  const { user } = await requireUser(req);
  const { id } = await ctx.params;
  if (!UUID.test(id)) throw new ApiError("Noto'g'ri id", 400);

  await limit(`polish:${user.id}`, 20, 86_400);
  await limit(`polish:${id}`, 3, 86_400);

  const body = await readJson<Record<string, unknown>>(req, 4 * 1024);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError("So'rov tanasi obyekt bo'lishi kerak", 400);
  const baseVersion = body.baseVersion;
  if (typeof baseVersion !== "number" || !Number.isInteger(baseVersion) || baseVersion < 0) throw new ApiError("«baseVersion» yaroqsiz", 400);

  return json(await polishArticle(id, user.id, baseVersion));
});
