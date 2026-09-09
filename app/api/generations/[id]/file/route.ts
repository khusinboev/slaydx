import { ApiError, handler, requireUser } from "@/lib/server/api";
import { pdfAvailable, pdfFileName, toPdf } from "@/lib/server/pdf";
import { ensureFreshFile } from "@/lib/server/slide-commit";
import { getGenerationFile } from "@/lib/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Eskirgan slayd fayli avval qayta yasaladi (`ensureFreshFile`) — PPTX render vaqti. */
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** LibreOffice PDF ga o'gira oladigan turlar. */
const CONVERTIBLE = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

/** Fayl nomidagi sarlavha injeksiyasini oldini oladi. */
function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * Yaratilgan faylni beradi.
 *
 * Egalik `getGenerationFile` ichida SQL darajasida tekshiriladi — id ni
 * bilgan begona foydalanuvchi hujjatni ololmaydi (IDOR yo'q).
 */
export const GET = handler("generations/file", async (req, ctx: Ctx) => {
  const { user } = await requireUser(req);
  const { id } = await ctx.params;
  if (!UUID.test(id)) throw new ApiError("Noto'g'ri id", 400);

  /*
   * ESKIRGAN FAYL HECH QACHON BERILMAYDI.
   *
   * Ko'ruvchida tahrir qilingandan keyin `doc_version` oshadi, PPTX esa
   * klientning 3 soniyalik debounce'idan keyingi `POST …/rebuild` bilan
   * yangilanadi. Foydalanuvchi shu oraliqda «Yuklab olish» ni bossa,
   * ilgari ekrandagidan FARQ QILADIGAN eski fayl tushardi — bu
   * loyihaning asosiy va'dasini («ko'rdim = oldim») buzardi. Shuning
   * uchun bu yerda versiya tekshiriladi va kerak bo'lsa avval qayta
   * yasaladi. Slayd bo'lmagan vositalarda ikkala versiya ham 0 —
   * qo'shimcha ish bo'lmaydi.
   */
  await ensureFreshFile(id, user.id);

  const file = await getGenerationFile(id, user.id);
  if (!file) throw new ApiError("Fayl topilmadi yoki muddati tugagan", 404);

  /**
   * `?format=pdf` — DOCX/PPTX ni PDF ga o'giradi.
   *
   * O'girish talab bo'yicha: PDF bazada saqlanmaydi, aks holda har
   * hujjatning ikkinchi nusxasi `BYTEA` ni ikki barobar og'irlashtirardi.
   */
  const wantsPdf = new URL(req.url).searchParams.get("format") === "pdf";
  if (wantsPdf) {
    if (!pdfAvailable()) throw new ApiError("PDF o'girish bu serverda yoqilmagan", 503);
    /*
     * Ruxsat etilganlar RO'YXATI, taqiqlanganlar emas.
     *
     * Ilgari shart `image/*` ni rad etardi, ya'ni qolgan HAMMA narsa
     * LibreOffice ga tushardi. Bir nechta rasm endi ZIP bo'lib keladi
     * va u arxivni o'girishga urinish 90 soniyalik timeout bilan
     * tugardi. Faqat LibreOffice haqiqatan o'gira oladigan turlar
     * o'tkaziladi.
     */
    if (!CONVERTIBLE.has(file.mime)) {
      throw new ApiError("Bu fayl allaqachon tayyor formatda", 400);
    }
    const pdf = await toPdf(new Uint8Array(file.bytes), file.fileName);
    if (!pdf) throw new ApiError("PDF tayyorlanmadi — qayta urinib ko'ring", 502);
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(pdf.byteLength),
        "Content-Disposition": contentDisposition(pdfFileName(file.fileName)),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": file.mime,
      "Content-Length": String(file.bytes.byteLength),
      "Content-Disposition": contentDisposition(file.fileName),
      // Hujjat shaxsiy — proxy yoki CDN keshlamasin.
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
