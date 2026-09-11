import "server-only";
import { MAX_SOURCE_CHARS } from "../tools";
import { RESUME_JSON_FIELDS } from "../generation/resume/input";
import { ARTICLE_JSON_FIELDS } from "../generation/article-params";
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

/**
 * JSON kodlangan forma maydonlari (Rezyume 2, B-3).
 *
 * Rezyumening tajriba/ta'lim/sertifikat/til/havola ro'yxatlari
 * `FormValues` ga JSON SATRI sifatida tushadi. 4 000 belgilik
 * `MAX_FIELD` da 12 ta ish joyi va har biriga 10 tagacha band SIG'MAYDI:
 * satr o'rtasidan kesilar, `JSON.parse` yiqilar va foydalanuvchi butun
 * tajriba bo'limini YO'QOTARDI. Endi chegara 24 000 va kesilgan JSON ni
 * `parseResumeJson` oxirgi to'liq elementgacha tiklaydi.
 *
 * Ro'yxat `resume/input.ts` dan IMPORT qilinadi — u yerda ham,
 * bu yerda ham qo'lda yozilsa, yangi maydon qo'shilganda jim kesilardi.
 */
const MAX_JSON = 24_000;
/*
 * Maqola 2: `authors`, `userRefs`, `keywords`, `userData` ham JSON —
 * 40 ta manba qatori 4 000 belgiga sig'maydi; ro'yxat `article-params.ts`
 * reyestridan (rezyume bilan bir xil naqsh).
 */
const JSON_FIELDS = new Set<string>([...RESUME_JSON_FIELDS, ...ARTICLE_JSON_FIELDS]);

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
      const limit = SOURCE_FIELDS.has(key) ? MAX_SOURCE : JSON_FIELDS.has(key) ? MAX_JSON : MID_FIELDS.has(key) ? MAX_MID : MAX_FIELD;
      // Nol bayt Postgres `text` ga yozilmaydi — oldindan olib tashlaymiz.
      out[key] = value.replace(/\0/g, "").slice(0, limit);
    }
  }
  return out;
}

export { MAX_FIELD, MAX_JSON, MAX_MID, MAX_SOURCE };
