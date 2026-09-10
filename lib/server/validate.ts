import "server-only";
import { MAX_SOURCE_CHARS } from "../tools";
import type { FormValues } from "../types";

/**
 * Formadan kelgan qiymatlarni tozalaydi.
 *
 * Bu chegara pul bilan bog'liq: cheklovsiz matn to'g'ridan-to'g'ri LLM ga
 * ketsa, bitta so'rov katta token hisobini yeyishi mumkin.
 */

/** Oddiy matn maydoni (mavzu, ism, kafedra...). */
const MAX_FIELD = 4_000;
/**
 * «Fayl asosida» va tarjima uchun manba matni — XOM shift.
 *
 * Qiymat `lib/tools.ts` dan IMPORT qilinadi va shu yerda takrorlanmaydi:
 * u klient ham ko'radigan `TRANSLATION_MAX_CHARS` bilan bir juftlik
 * bo'lib ishlaydi (`preflightError` matn kesilganini shu son orqali
 * biladi). Ilgari ikkalasi ikki faylda mustaqil turar va xato xabari
 * foydalanuvchi ko'rgan songa mos kelmasdi.
 *
 * Bundan qanchasi modelga ketishi vositaga bog'liq va uchinchi joyda
 * hal qilinadi: `lib/generation/meta.ts` dagi `SOURCE_TEXT_LIMIT`
 * (kontekst uchun 24 000).
 */
const MAX_SOURCE = MAX_SOURCE_CHARS;
/** Bitta formadagi maydonlar soni. */
const MAX_KEYS = 80;

const SOURCE_FIELDS = new Set(["sourceText"]);

/**
 * O'RTA hajmli maydonlar — oddiy maydondan katta, manba matnidan kichik.
 *
 * `userGlossary` («O'z lug'atim», Tarjimon 2): har qatorda `atama =
 * tarjima`. 4 000 belgilik `MAX_FIELD` da bu ~100 atama — texnik hujjat
 * uchun kam, shuning uchun 8 000. `MAX_SOURCE` (200 000) esa bu maydonga
 * ortiqcha: lug'at HAR partiyaning promptiga tushadi, ya'ni uning
 * uzunligi token hisobiga partiyalar soniga KO'PAYTIRILIB ta'sir qiladi.
 */
const MAX_MID = 8_000;
const MID_FIELDS = new Set(["userGlossary"]);

/** Faqat kutilgan turdagi qiymatlar o'tadi; kalitlar oq ro'yxat shaklida. */
export function sanitizeValues(raw: unknown): FormValues | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: FormValues = {};
  let count = 0;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (count++ >= MAX_KEYS) break;
    if (!/^[a-zA-Z0-9_]{1,40}$/.test(key)) continue;
    if (value === null) {
      out[key] = null;
    } else if (typeof value === "boolean") {
      out[key] = value;
    } else if (typeof value === "number") {
      out[key] = Number.isFinite(value) ? value : 0;
    } else if (typeof value === "string") {
      const limit = SOURCE_FIELDS.has(key) ? MAX_SOURCE : MID_FIELDS.has(key) ? MAX_MID : MAX_FIELD;
      // Nol bayt Postgres `text` ga yozilmaydi — oldindan olib tashlaymiz.
      out[key] = value.replace(/\0/g, "").slice(0, limit);
    }
  }
  return out;
}

export { MAX_FIELD, MAX_MID, MAX_SOURCE };
