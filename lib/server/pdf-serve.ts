import "server-only";
import { ApiError, limit } from "./api";
import { getOrConvertPdf, type PdfConverter, type PdfDiskCache } from "./pdf-cache";
import { pdfAvailable, pdfFileName } from "./pdf";
import { busyResponse, SofficeBusyError } from "./soffice-gate";

/**
 * `GET /api/generations/{id}/file?format=pdf` javobi (C07).
 *
 * Route'dan ajratilgan: `requireUser` (cookie) faqat Next so'rov
 * kontekstida ishlaydi, bu funksiya esa egasi allaqachon tekshirilgan
 * fayl baytlarini oladi va testda to'g'ridan-to'g'ri chaqiriladi.
 *
 * Tartib muhim:
 *   1) LibreOffice yo'q → 503; o'girib bo'lmaydigan tur → 400 (limit sarflanmaydi);
 *   2) keshda bor → darhol (limit ham, `soffice` ham yo'q);
 *   3) aks holda umumiy darvoza (band → 503 + `Retry-After`, limit
 *      sarflanmaydi), slot olingach foydalanuvchi limiti (10 / 10 daqiqa →
 *      429 + `Retry-After`; slot `finally` da qaytadi), keyin `soffice`.
 */

/** LibreOffice PDF ga o'gira oladigan turlar. */
const CONVERTIBLE = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

/** Foydalanuvchi bo'yicha HAQIQIY o'girishlar chegarasi. */
const PDF_LIMIT = 10;
const PDF_WINDOW_SEC = 600;

/** Fayl nomidagi sarlavha injeksiyasini oldini oladi. */
export function contentDisposition(name: string, kind: "attachment" | "inline" = "attachment"): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export type PdfServeArgs = {
  userId: string;
  generationId: string;
  file: { bytes: Buffer; fileName: string; mime: string };
  inline: boolean;
};

export type PdfServeDeps = {
  available?: () => boolean;
  convert?: PdfConverter;
  cache?: PdfDiskCache;
  /** Standart — `limit(pdf:<user>, 10, 600)` (429 `ApiError`). */
  limitFn?: (userId: string) => Promise<void>;
};

export async function pdfResponse(args: PdfServeArgs, deps: PdfServeDeps = {}): Promise<Response> {
  if (!(deps.available ?? pdfAvailable)()) throw new ApiError("PDF o'girish bu serverda yoqilmagan", 503);
  const { file } = args;
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
  const limitFn = deps.limitFn ?? ((userId: string) => limit(`pdf:${userId}`, PDF_LIMIT, PDF_WINDOW_SEC));

  let pdf: Buffer | null;
  try {
    pdf = await getOrConvertPdf({
      generationId: args.generationId,
      bytes: new Uint8Array(file.bytes),
      fileName: file.fileName,
      beforeConvert: () => limitFn(args.userId),
      // Standart — `toPdf` (limit slot ichida, `beforeRun`).
      convert: deps.convert,
      cache: deps.cache,
    });
  } catch (e) {
    if (e instanceof SofficeBusyError) return busyResponse(e);
    throw e;
  }
  if (!pdf) throw new ApiError("PDF tayyorlanmadi — qayta urinib ko'ring", 502);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.byteLength),
      "Content-Disposition": contentDisposition(pdfFileName(file.fileName), args.inline ? "inline" : "attachment"),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
