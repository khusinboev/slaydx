/**
 * Tarjima HISOBOTI — `AcademicDoc.translation` (Tarjimon 2).
 *
 * Alohida faylda: `types.ts` (hujjat modeli) va `engine.ts` (dvigatel)
 * ikkalasi shu tipga tayanadi; dvigatelni `types.ts` ga import qilish
 * aylanma bog'liqlik bo'lardi. Ko'ruvchi (`TranslationViewer`) ham
 * faqat shu tipni o'qiydi — dvigatel kodi klientga tushmaydi.
 */
export type TranslationStyle = "formal" | "business" | "plain" | "literary";
export const TRANSLATION_STYLE_IDS: readonly TranslationStyle[] = ["formal", "business", "plain", "literary"];
export function isTranslationStyle(v: unknown): v is TranslationStyle {
  return typeof v === "string" && (TRANSLATION_STYLE_IDS as readonly string[]).includes(v);
}

export type GlossaryEntry = { src: string; dst: string };

export type TranslationWarningCode =
  /** Raqam/URL/email manbada bor, tarjimada topilmadi (qabul qilindi, tekshirish tavsiya). */
  | "numbers"
  /** Maket tokenlari (⟦…⟧) mos kelmadi — asl matn qoldirildi yoki tuzatildi. */
  | "placeholders"
  /** Band tarjima qilinmadi — asl matn qoldirildi (qisman yetkazish). */
  | "untranslated"
  /** Fayl qismi (diagramma, SmartArt) tarjima qilinmadi. */
  | "skipped-part"
  /** O'ngdan chapga yoziladigan til — paragraf yo'nalishi o'zgartirilmadi. */
  | "rtl"
  /** Tanlangan manba tili aniqlangan tildan farq qiladi. */
  | "detected";

export type TranslationWarning = { code: TranslationWarningCode; detail: string; id?: string };

export type TranslationPair = {
  id: string;
  src: string;
  dst: string;
  kind: string;
  ctx?: string;
  /** Shu band uchun ogohlantirish bor (ko'ruvchida amber chiziq). */
  warn?: boolean;
};

export type TranslationReport = {
  /** So'ralgan manba tili (`avto` bo'lishi mumkin). */
  sourceLang: string;
  /** 1-o'tishda aniqlangan til (ISO kod); `avto` bo'lmasa so'ralgani. */
  detected: string;
  target: string;
  style: TranslationStyle;
  domain?: string;
  glossary: GlossaryEntry[];
  warnings: TranslationWarning[];
  /** Asl ↔ tarjima juftlari (ko'ruvchi «Taqqoslash»); tokenlar glifga aylantirilgan. */
  pairs: TranslationPair[];
  pairsTruncated?: boolean;
  segments: number;
  translated: number;
  chars: number;
  sourceKind: string;
  /** Fayl rejimida — asl fayl nomi. */
  sourceName?: string;
};
