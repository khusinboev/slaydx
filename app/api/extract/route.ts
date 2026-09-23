import { ApiError, handler, json, limit, requireUser } from "@/lib/server/api";
import { EXTRACT_MAX_BYTES, EXTRACT_MAX_CHARS, extractFromBuffer } from "@/lib/extract-text";
import { MAX_PDF_PAGES } from "@/lib/generation/translate/pdf";
import { readUploadForm } from "@/lib/server/upload-body";

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

  // MUHIM: ilgari hajm faqat `req.formData()` dan keyin tekshirilardi — 1 GB
  // yuborilsa server avval hammasini yutardi; keyin `Content-Length` qo'shildi,
  // lekin chunked so'rovda u yo'q. Endi tana O'QILAYOTGANDA sanaladi (SECB-05).
  const form = await readUploadForm(
    req,
    EXTRACT_MAX_BYTES + 64 * 1024,
    `Fayl ${Math.round(EXTRACT_MAX_BYTES / 1024 / 1024)} MB dan katta`,
  );
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
  const cut = out.text.length > EXTRACT_MAX_CHARS;
  // PDF sahifa chegarasidan uzun bo'lsa, faqat boshi o'qilgan (`MAX_PDF_PAGES`).
  const truncated = cut || out.truncated === true;
  return json({
    text: cut ? out.text.slice(0, EXTRACT_MAX_CHARS) : out.text,
    chars: Math.min(out.text.length, EXTRACT_MAX_CHARS),
    truncated,
    ...(cut
      ? { notice: `Matn juda uzun — birinchi ${EXTRACT_MAX_CHARS.toLocaleString("uz-UZ")} belgi olindi.` }
      : out.truncated
        ? { notice: `Hujjat juda uzun — faqat birinchi ${MAX_PDF_PAGES} sahifa o'qildi.` }
        : {}),
  });
});
