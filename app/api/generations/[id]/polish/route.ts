import { ApiError, handler, json, readJson, requireUser } from "@/lib/server/api";
import { polishGeneration } from "@/lib/server/doc-polish";
import { assertFreeLlmEnabled, withFreeLlm } from "@/lib/server/spend";

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
 * BEPUL, lekin faqat PUL bilan to'langan hujjatda (bonus ball emas) va
 * chegarali: hujjat bo'yicha 3 marta/kun (Q-1), foydalanuvchi bo'yicha
 * kunlik (`FREE_LLM_DAILY_POLISH`), global shift, bitta hujjatda bitta AI
 * tahrir — `lib/server/spend.ts` (prod-readiness C10; kun Toshkent vaqti
 * bilan). Route yupqa: mantiq `lib/server/doc-polish.ts`
 * — u adapterga qarab maqola yoki INSHO sayqalini yuritadi (AUDIT-19).
 */
export const POST = handler("generations/polish", async (req, ctx: Ctx) => {
  const { user } = await requireUser(req);
  const { id } = await ctx.params;
  if (!UUID.test(id)) throw new ApiError("Noto'g'ri id", 400);
  assertFreeLlmEnabled();

  const body = await readJson<Record<string, unknown>>(req, 4 * 1024);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError("So'rov tanasi obyekt bo'lishi kerak", 400);
  const baseVersion = body.baseVersion;
  if (typeof baseVersion !== "number" || !Number.isInteger(baseVersion) || baseVersion < 0) throw new ApiError("«baseVersion» yaroqsiz", 400);

  return json(
    await withFreeLlm({ endpoint: "polish", userId: user.id, doc: { id, baseVersion }, signal: req.signal }, (complete) =>
      polishGeneration(id, user.id, baseVersion, { complete }),
    ),
  );
});
