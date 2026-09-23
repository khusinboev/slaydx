import "server-only";
import { ApiError } from "./api";

/**
 * Yuklash so'rovining `multipart/form-data` tanasini HAJM CHEGARASI bilan o'qiydi (SECB-05).
 *
 * Ilgari chegara faqat `Content-Length` sarlavhasidan olinardi. Chunked
 * so'rovda sarlavha yo'q — tekshiruv o'tib ketar, `req.formData()` esa
 * butun tanani (nginx `client_max_body_size` gacha) xotiraga yutib,
 * keyingina `file.size` bilan «juda katta» derdi. Endi tana oqimdan
 * sanab o'qiladi va `maxBytes` dan oshgan zahoti oqim bekor qilinadi —
 * xotirada chegara + bitta bo'lakdan ortiq hech narsa bo'lmaydi.
 *
 * `null` — tana yo'q yoki multipart sifatida o'qilmadi (chaqiruvchi
 * avvalgidek «Fayl yuborilmadi» deydi).
 */
export async function readUploadForm(req: Request, maxBytes: number, tooBig: string): Promise<FormData | null> {
  // Arzon tekshiruv birinchi: sarlavha bo'lsa, tana umuman o'qilmaydi.
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) throw new ApiError(tooBig, 413);
  if (!req.body) return null;

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch((e: unknown) => console.warn("[upload] oqim bekor qilinmadi", e));
        throw new ApiError(tooBig, 413);
      }
      chunks.push(value);
    }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    // Klient ulanishni uzdi — `req.formData()` ham shu holda `null` berardi.
    console.warn("[upload] tana o'qilmadi", e instanceof Error ? e.message : e);
    return null;
  }

  const body = Buffer.concat(chunks, total);
  const type = req.headers.get("content-type") ?? "";
  return new Response(body, { headers: { "content-type": type } }).formData().catch(() => null);
}
