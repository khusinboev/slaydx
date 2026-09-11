import { ApiError, handler, json, limit, readJson, requireUser } from "@/lib/server/api";
import { parseArticleFix, rewriteArticle } from "@/lib/server/article-rewrite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Bitta `writer` chaqiruvi (30 s) + hisobot qoidalari; DOCX qayta yasash alohida (`rebuild`). */
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Tayyorlik hisobotidagi «Tuzatish» (Maqola 2, AUDIT-17 WP7).
 *
 * Tana `{baseVersion, fix}` — `fix` hisobot bergan shartnoma
 * (`{op:"rewrite", target, instruction}`); server uni `writer` roli bilan
 * bajaradi, natijani tahrir oplari sifatida yozadi va hisobotni qayta
 * hisoblaydi. Javob `{generation, ops}` — `PATCH …/doc` bilan bir xil
 * `generation` (klient `adopt` qiladi) + qo'llangan op lar.
 *
 * Kredit yechilmaydi. Route yupqa: mantiq `lib/server/article-rewrite.ts`
 * (u yerda test bilan qoplangan; route `cookies()` ga bog'liq).
 */
export const POST = handler("generations/rewrite", async (req, ctx: Ctx) => {
  const { user } = await requireUser(req);
  const { id } = await ctx.params;
  if (!UUID.test(id)) throw new ApiError("Noto'g'ri id", 400);

  // Har tuzatish — LLM chaqiruvi: 10 daqiqada 20 ta yetadi.
  await limit(`rewrite:${user.id}`, 20, 600);

  const body = await readJson<Record<string, unknown>>(req, 16 * 1024);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError("So'rov tanasi obyekt bo'lishi kerak", 400);
  const baseVersion = body.baseVersion;
  if (typeof baseVersion !== "number" || !Number.isInteger(baseVersion) || baseVersion < 0) throw new ApiError("«baseVersion» yaroqsiz", 400);
  const fix = parseArticleFix(body.fix);

  return json(await rewriteArticle(id, user.id, baseVersion, fix));
});
