import { ApiError, handler, json, limit, readJson, requireUser } from "@/lib/server/api";
import { enqueueGeneration, listGenerations } from "@/lib/server/jobs";
import { sanitizeValues } from "@/lib/server/validate";
import { missingRequired, preflightError, priceFor, TOOL_BY_SLUG, topicOf } from "@/lib/tools";
import { startInlineWorker } from "@/lib/server/worker";
import { env } from "@/lib/server/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Foydalanuvchining o'z generatsiyalari. Boshqa userniki chiqmaydi. */
export const GET = handler("generations/list", async (req) => {
  const { user } = await requireUser(req);
  const rows = await listGenerations(user.id);
  return json({ generations: rows });
});

/**
 * Yangi generatsiyani navbatga qo'yadi.
 *
 * Muhim farqlar (ilgari `/api/generate` shu ishni qilardi):
 *   - kirish talab qilinadi — anonim so'rov pullik LLM ni chaqira olmaydi,
 *   - narx **serverda** hisoblanadi — klient yuborgan `price` e'tiborsiz,
 *   - pul yechish va navbatga qo'yish bitta tranzaksiyada,
 *   - hujjat HTTP ichida emas, worker da yaratiladi (timeout yo'q).
 */
export const POST = handler("generations/create", async (req) => {
  const { user } = await requireUser(req);

  // Ikki qatlam: qisqa portlash va soatlik umumiy chegara.
  await limit(`gen:burst:${user.id}`, 5, 60);
  await limit(`gen:hour:${user.id}`, 60, 3600);

  const body = await readJson<{ slug?: unknown; values?: unknown }>(req, 400_000);
  const slug = typeof body.slug === "string" ? body.slug : "";
  const tool = slug ? TOOL_BY_SLUG[slug] : undefined;
  if (!tool) throw new ApiError("Noma'lum vosita", 400);

  const values = sanitizeValues(body.values);
  if (!values) throw new ApiError("Forma qiymatlari noto'g'ri", 400);

  /**
   * Majburiy maydonlar SERVERDA tekshiriladi.
   *
   * Ilgari tekshiruv faqat formada edi: to'g'ridan-to'g'ri yuborilgan
   * so'rov universitetsiz yoki mavzusiz o'tib ketardi, ish navbatga
   * tushardi va puli yechilardi — natija esa yaroqsiz hujjat bo'lardi.
   */
  const missing = missingRequired(tool, values);
  if (missing.length) {
    throw new ApiError(`To'ldirilmagan maydon: ${missing.join(", ")}`, 400, { missing });
  }

  // «To'ldirilgan, lekin biz uddalay olmaymiz» — pul yechilishidan oldin.
  const blocked = preflightError(tool, values);
  if (blocked) throw new ApiError(blocked, 400);

  const price = priceFor(tool, values);
  const topic = topicOf(values, tool);

  const result = await enqueueGeneration({
    userId: user.id,
    toolId: tool.id,
    topic,
    price,
    format: tool.output,
    values,
  });

  if (!result.ok) {
    throw new ApiError(
      `Balans yetarli emas. Kerak: ${result.required.toLocaleString("uz-UZ")} tanga, mavjud: ${result.available.toLocaleString("uz-UZ")}.`,
      402,
      { required: result.required, available: result.available },
    );
  }

  // Inline rejimda worker shu processda ishlaydi — birinchi so'rovda uyg'otamiz.
  if (env.worker.inline) startInlineWorker();

  return json({ id: result.id, price, status: "QUEUED" }, { status: 202 });
});
