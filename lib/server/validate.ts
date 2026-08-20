import "server-only";
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
 * Bundan qanchasi modelga ketishi vositaga bog'liq va u boshqa joyda
 * hal qilinadi: `lib/generation/meta.ts` dagi `SOURCE_TEXT_LIMIT`
 * (kontekst uchun 24 000) va `lib/tools.ts` dagi
 * `TRANSLATION_MAX_CHARS` (tarjima uchun 48 000). Bu yerdagi son
 * shunchaki «so'rov qanchalik katta bo'lishi mumkin» degan savolga
 * javob beradi.
 */
const MAX_SOURCE = 60_000;
/** Bitta formadagi maydonlar soni. */
const MAX_KEYS = 80;

const SOURCE_FIELDS = new Set(["sourceText"]);

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
      const limit = SOURCE_FIELDS.has(key) ? MAX_SOURCE : MAX_FIELD;
      // Nol bayt Postgres `text` ga yozilmaydi — oldindan olib tashlaymiz.
      out[key] = value.replace(/\0/g, "").slice(0, limit);
    }
  }
  return out;
}

export { MAX_FIELD, MAX_SOURCE };
