import { ApiError, handler, json, limit, readJson, requireUser } from "@/lib/server/api";
import { budgetFor } from "@/lib/generation/budget";
import { enqueueGeneration, listGenerations } from "@/lib/server/jobs";
import { sanitizeValues } from "@/lib/server/validate";
import { sourceCharsForRequest } from "@/lib/server/source-upload";
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

  /*
   * 1 200 000 bayt: tarjima chegarasi 200 000 BELGI, kirill/o'zbek matni
   * UTF-8 da belgisiga ~2 bayt, JSON qochirish (`\n`, `\"`) esa ustiga
   * qo'shadi — 400 000 bayt oldin 200 000 belgilik matnni «So'rov hajmi
   * juda katta» deb rad etardi.
   */
  const body = await readJson<{ slug?: unknown; values?: unknown }>(req, 1_200_000);
  const slug = typeof body.slug === "string" ? body.slug : "";
  const tool = slug ? TOOL_BY_SLUG[slug] : undefined;
  if (!tool) throw new ApiError("Noma'lum vosita", 400);

  const values = sanitizeValues(body.values);
  if (!values) throw new ApiError("Forma qiymatlari noto'g'ri", 400);

  /*
   * Tarjima hajmi — SERVERDA aniqlanadi (Tarjimon 2, WP1).
   *
   * Narx endi hajmga bog'liq, ya'ni `sourceChars` PUL maydoni. Klient
   * uni yuborishi mumkin (formada narxni ko'rsatish uchun), lekin bu
   * yerda U USTIDAN YOZILADI:
   *
   *   fayl rejimi — `source_uploads.chars` (yuklashda o'lchangan);
   *   matn rejimi — `sourceText` ning haqiqiy uzunligi.
   *
   * Aks holda 200 000 belgilik hujjatni `sourceChars: 1` bilan yuborib,
   * 3 000 tangaga tarjima qildirish mumkin bo'lardi.
   */
  if (tool.id === "translation") {
    const assetId = typeof values.sourceAssetId === "string" ? values.sourceAssetId.trim() : "";
    if (assetId) {
      const row = /^[0-9a-f]{24}$/i.test(assetId)
        ? await sourceCharsForRequest(user.id, assetId)
        : null;
      // Qator yo'q — eski/o'chirilgan/begona `assetId`. Bu YIQILISH emas,
      // aniq ko'rsatma: forma faylni qayta yuklaydi.
      if (!row) throw new ApiError("Yuklangan fayl topilmadi — qayta yuklang", 400);
      // Matn bazada — so'rov tanasida takrorlanmaydi (200 000 belgi
      // JSON'da 400 KB+ bo'lardi va har generatsiyada qayta yuborilardi).
      values.sourceText = "";
      values.sourceChars = row.chars;
      values.fileName = row.name;
      values.sourceKind = row.kind;
    } else {
      values.sourceChars = String(values.sourceText ?? "").length;
      // Matn rejimida bu ikkisi ma'nosiz — qolib ketsa `priceFor` va
      // dvigatel «fayl bor» deb o'ylardi.
      delete values.sourceKind;
      delete values.sourceAssetId;
    }
  }

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
    // Byudjet ish HAJMIDAN hisoblanadi: 1 varaqlik insho 285 s lik
    // slotni band qilmasin, 45 betlik kurs ishi esa unga sig'may
    // yiqilmasin. `WORKER_JOB_TIMEOUT_MS` yuqori chegara bo'lib qoladi.
    budgetMs: budgetFor(tool, values, env.worker.jobTimeoutMs),
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
