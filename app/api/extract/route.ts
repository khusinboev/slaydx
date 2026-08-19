import { ApiError, handler, json, limit, requireUser } from "@/lib/server/api";
import { EXTRACT_MAX_BYTES, EXTRACT_MAX_CHARS, extractFromBuffer } from "@/lib/extract-text";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Yuklangan hujjatdan matn chiqaradi.
 *
 * Ilgari bu endpoint ochiq edi: PDF tahlili CPU ga og'ir, shuning uchun
 * autentifikatsiyasiz u DoS vektori edi. Endi kirish va chastota
 * chegarasi bor, hajm esa **tahlildan oldin** tekshiriladi.
 */
export const POST = handler("extract", async (req) => {
  const { user } = await requireUser(req);
  await limit(`extract:${user.id}`, 20, 300);

  // MUHIM: `req.formData()` butun tanani xotiraga o'qiydi. Ilgari hajm
  // faqat shundan keyin tekshirilardi — ya'ni 1 GB yuborilsa server
  // avval hammasini yutib, keyingina «juda katta» derdi.
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > EXTRACT_MAX_BYTES + 64 * 1024) {
    throw new ApiError(`Fayl ${Math.round(EXTRACT_MAX_BYTES / 1024 / 1024)} MB dan katta`, 413);
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw new ApiError("Fayl yuborilmadi", 400);
  if (file.size > EXTRACT_MAX_BYTES) {
    throw new ApiError(`Fayl ${Math.round(EXTRACT_MAX_BYTES / 1024 / 1024)} MB dan katta`, 413);
  }
  if (file.size === 0) throw new ApiError("Fayl bo'sh", 400);

  const buf = await file.arrayBuffer();
  const out = await extractFromBuffer(file.name, buf);
  if (!out.text.trim()) {
    return json({
      text: "",
      error:
        out.error ||
        "Fayldan matn chiqmadi. Skaner PDF bo‘lishi mumkin — matn rejimidan foydalaning.",
    });
  }

  // Javob hajmi ham cheklangan: 8 MB TXT dan 8 M belgi qaytarish
  // brauzerni ham, keyingi LLM so'rovini ham cho'ktirardi.
  const truncated = out.text.length > EXTRACT_MAX_CHARS;
  return json({
    text: truncated ? out.text.slice(0, EXTRACT_MAX_CHARS) : out.text,
    chars: Math.min(out.text.length, EXTRACT_MAX_CHARS),
    truncated,
    ...(truncated
      ? { notice: `Matn juda uzun — birinchi ${EXTRACT_MAX_CHARS.toLocaleString("uz-UZ")} belgi olindi.` }
      : {}),
  });
});
