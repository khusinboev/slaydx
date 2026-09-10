/**
 * Tarjima manbasining IZOMORF tiplari (Tarjimon 2, WP1).
 *
 * Nega alohida fayl: `lib/server/source-upload.ts` da `import "server-only"`
 * bor, ya'ni undan tip import qilgan har qanday klient modul (forma,
 * `lib/api-client.ts`) qurilishda yiqilardi. `lib/generation/index.ts`
 * ham xuddi shunday: u worker ichida ishlaydi, lekin `BuildOptions`
 * tipini ko'ruvchi va testlar ham o'qiydi.
 *
 * Shuning uchun SHARTNOMA (tiplar) shu yerda, AMALGA OSHIRISH esa
 * server faylida. `slide-types.ts` bilan bir xil naqsh.
 */

/**
 * Qo'llanadigan manba formatlari.
 *
 * Ro'yxat YOPIQ va u ayni paytda uchta joyning shartnomasi: yuklash
 * sniffi (`sniffSourceKind`), format adapterlari (WP2 `extractSegments`)
 * va chiqish formati (chiqish = kirish; `pdf` dan tashqari — unga qayta
 * yozib bo'lmaydi, shuning uchun u DOCX ga o'giriladi).
 */
export type SourceKind = "docx" | "pptx" | "xlsx" | "pdf" | "txt" | "md" | "csv";

/** Har bir turning MIME i — saqlash va yuklab olish sarlavhasi uchun. */
export const SOURCE_MIME: Record<SourceKind, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
};

/** Forma `accept` atributi — sniff ro'yxati bilan bitta manbadan. */
export const SOURCE_ACCEPT = ".docx,.pptx,.xlsx,.pdf,.txt,.md,.csv";

/**
 * Worker `buildArtifact` ga beradigan manba (`BuildOptions.source`).
 *
 * `bytes` — ASL fayl: tarjima dvigateli (WP2/WP3) aynan shu baytlar
 * ichidagi matn tugunlarini almashtiradi, ya'ni jadval/shrift/rasm/
 * kolontitul o'z joyida qoladi. Ilgari `/api/extract` faqat matn olib,
 * baytlarni tashlab yuborardi — natija esa GOST profilidagi YANGI DOCX
 * bo'lardi (`docs/AUDIT.md` P1-20).
 */
export type TranslationSource = {
  bytes: Uint8Array;
  name: string;
  kind: SourceKind;
  mime: string;
  /** Yuklashda o'lchangan, narx hisoblangan belgilar soni. */
  chars: number;
};

/**
 * `POST /api/uploads/source` javobi — server ham, klient ham shu tipni
 * ishlatadi (javob shakli ikki joyda mustaqil yozilib ajralib ketmasin).
 */
export type SourceUploadResult = {
  assetId: string;
  name: string;
  kind: SourceKind;
  /** Fayl hajmi (bayt). */
  size: number;
  /** Narx aynan shu songa qarab hisoblanadi (server ustunligi). */
  chars: number;
  /** Formadagi «Olingan matn (ko'rish)» paneli uchun QISQARTIRILGAN nusxa. */
  text: string;
  /** `text` to'liq emas — panel «…» belgisi bilan ko'rsatadi. */
  truncatedPreview: boolean;
};

/** Ko'rish paneliga yuboriladigan matn chegarasi (javob hajmini ushlab turadi). */
export const SOURCE_PREVIEW_CHARS = 20_000;
