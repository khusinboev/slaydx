import { ApiError, handler, requireUser } from "@/lib/server/api";
import { ensureFreshFileShared } from "@/lib/server/fresh-file";
import { contentDisposition, pdfResponse } from "@/lib/server/pdf-serve";
import { getGenerationFile } from "@/lib/server/storage";
import { bytesBody } from "@/lib/server/http-bytes";

export { contentDisposition };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Eskirgan slayd fayli avval qayta yasaladi (`ensureFreshFile`) — PPTX render vaqti. */
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
   *
   * C07 (CONC-08): bir hujjatga parallel yuklab olishlar BITTA renderni
   * kutadi va render foydalanuvchi bo'yicha chegaralangan (429).
   */
  await ensureFreshFileShared(id, user.id);

  const file = await getGenerationFile(id, user.id);
  if (!file) throw new ApiError("Fayl topilmadi yoki muddati tugagan", 404);

  /**
   * `?format=pdf` — DOCX/PPTX ni PDF ga o'giradi.
   *
   * O'girish talab bo'yicha: PDF bazada saqlanmaydi, aks holda har
   * hujjatning ikkinchi nusxasi `BYTEA` ni ikki barobar og'irlashtirardi.
   * C07: disk keshi, foydalanuvchi limiti (429) va umumiy LibreOffice
   * darvozasi (503) — `lib/server/pdf-serve.ts`.
   */
  const params = new URL(req.url).searchParams;
  const wantsPdf = params.get("format") === "pdf";
  /*
   * `inline=1` — brauzer ichida ko'rsatish uchun (Tarjimon 2 «Fayl» tabi
   * iframe'i, yangi oynada ochish). `attachment` bilan Chrome iframe'da
   * ko'rsatmay, faylni yuklab olishga o'tardi. Standart — yuklab olish.
   */
  const inline = params.get("inline") === "1";
  if (wantsPdf) {
    return pdfResponse({ userId: user.id, generationId: id, file, inline });
  }

  /*
   * AUDIO (AUDIT-22): `<audio>` elementi faylni SAHIFA ICHIDA o'ynatadi
   * (`AudioViewer`), ya'ni ikkita sarlavha kerak:
   *
   *   `inline` — `attachment` bilan Chrome manbani o'ynatmasdan yuklab
   *     olishga o'tadi (Tarjimon 2 dagi PDF iframe bilan ayni sabab);
   *   `Accept-Ranges: bytes` — usiz brauzer o'rtaga «sakray» olmaydi va
   *     uzun podkastda progress chizig'i faqat oldinga yurardi.
   *
   * Diapazon so'rovining O'ZI (`Range: bytes=…`) bu yerda qo'lda
   * bajarilmaydi: fayl bazadan TO'LIQ o'qiladi (`getGenerationFile`),
   * ya'ni qisman javob tejamaydi. `Accept-Ranges` esa halol — Next
   * to'liq javobni beradi va brauzer uni keshlab, o'zi kesadi.
   *
   * `inline` PARAMETRGA bog'liq bo'lib qoladi (audio uchun ham): pleer
   * `?inline=1` bilan so'raydi, «MP3 yuklab olish» havolasi esa usiz —
   * va o'shanda fayl brauzer tabida ochilib qolmasdan YUKLANADI.
   */
  const isAudio = file.mime.startsWith("audio/");
  // `bytesBody` — nusxasiz ko'rinish (DB-06/SCALE-08): 25 MB faylni yana nusxalamaydi.
  return new Response(bytesBody(file.bytes), {
    headers: {
      "Content-Type": file.mime,
      "Content-Length": String(file.bytes.byteLength),
      "Content-Disposition": contentDisposition(file.fileName, inline ? "inline" : "attachment"),
      // Hujjat shaxsiy — proxy yoki CDN keshlamasin.
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      ...(isAudio ? { "Accept-Ranges": "bytes" } : {}),
    },
  });
});
