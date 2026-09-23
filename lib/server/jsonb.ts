import "server-only";
import { cleanText } from "../generation/safe-text";

/**
 * JSONB parametrini xavfsiz seriyalash (AUDIT prod-readiness C03: BEB-01, BEA-02).
 *
 * `JSON.stringify` yolg'iz surrogatni `\ud83d` escape'i, NUL ni `\u0000`
 * qilib chiqaradi — ikkalasini ham Postgres `jsonb` rad etadi va
 * UPDATE/INSERT butunlay yiqiladi. Ilgari bu worker'da «fayl saqlandi →
 * `completeJob` yiqildi → FAILED + to'liq qaytarish, fayl esa yuklab
 * olinadi» zanjirini berardi; tahrir/qoralama/o'yin natijasida esa 500.
 *
 * Shuning uchun HAR JSONB yozuvi shu funksiyadan o'tadi: har satr (qiymat
 * ham, KALIT ham) `cleanText` bilan tozalanadi. Toza qiymat uchun natija
 * `JSON.stringify` bilan baytma-bayt bir xil — mavjud yozuvlar o'zgarmaydi.
 * `toJSON` (masalan `Date`) replacer'dan OLDIN ishlaydi, ya'ni hurmat qilinadi.
 */
export function toJsonb(value: unknown): string {
  return JSON.stringify(value, jsonbReplacer);
}

function jsonbReplacer(_key: string, v: unknown): unknown {
  if (typeof v === "string") return cleanText(v);
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const keys = Object.keys(v);
    // Kalitlarni qayta qurish faqat kerak bo'lsa — aks holda obyekt o'zi
    // qaytadi (katta `doc_json` da har tugunni nusxalamaslik uchun).
    if (keys.some((k) => cleanText(k) !== k)) {
      const out: Record<string, unknown> = {};
      for (const k of keys) out[cleanText(k)] = (v as Record<string, unknown>)[k];
      return out;
    }
  }
  return v;
}
