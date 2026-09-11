/**
 * Kirill → lotin transliteratsiya (Maqola 2, WP5) — OAK «REFERENCES»
 * ro'yxati uchun.
 *
 * TANLANGAN TIZIM — **BGN/PCGN (1947, rus)**, diakritikasiz soddalashgan
 * shakl: щ → shch, ё → yo, х → kh, ц → ts, ю → yu, я → ya, е → ye (so'z
 * boshida va unlidan/ъ/ь dan keyin) aks holda e, ъ/ь tushadi. Nega ГОСТ
 * 7.79-2000 (B) emas: u «щ → shh», «ц → cz», «э → e`», «ь → `» beradi —
 * xalqaro bazalarda (Scopus/WoS, Crossref) va OAK jurnallarining o'zi
 * ko'rsatgan namunalarda aynan BGN/PCGN ko'rinishi («Tashkent»,
 * «Shchukin», «Fyodorov») qabul qilingan; ГОСТ B esa Kirill'ni o'qiy
 * olmaydigan o'quvchi uchun tushunarsiz («shhukin», «Fyodorov» → «Fyodorov»
 * bir xil, lekin «cz» va «e`» g'alati).
 *
 * O'ZBEK kirillchasi (ў қ ғ ҳ belgisi bilan aniqlanadi) — rasmiy o'zbek
 * lotin alifbosiga: ў → o‘, қ → q, ғ → g‘, ҳ → h, х → x, ж → j, ц → ts,
 * ъ → ’. O'zbek lotin matni O'ZGARMAYDI.
 *
 * Til belgisi: `[in Uzbek]` / `[in Russian]` — sarlavhadan keyin (APA 7
 * «description of non-English work» qoidasi). Inglizcha/lotin sarlavhada
 * belgi yo'q; o'zbek lotin sarlavha `[in Uzbek]` oladi (o‘/g‘ harflari
 * yoki o'zbekcha bog'lovchilar bo'yicha aniqlanadi).
 */

export type ScriptLang = "ru" | "uz" | "en";

const CYRILLIC_RE = /[Ѐ-ӿ]/;
/** Faqat o'zbek kirillchasida bor harflar. */
const UZ_CYR_RE = /[ўқғҳЎҚҒҲ]/;
/**
 * O'zbek lotin: o‘/g‘ (turli apostroflar), o'zbekcha bog'lovchi so'zlar
 * (to'liq so'z) yoki o'zbekcha o'zaklar (so'z boshida — «ta’limda»,
 * «tizimining» ham tutiladi).
 */
const UZ_LAT_RE =
  /[oOgG][‘’ʻ'`]|\b(va|uchun|bilan|hamda|asosida|orqali|haqida|hamda|yoki|bo[‘’ʻ'`]yicha)\b|\b(ta[‘’ʻ'`]lim|tahlil|rivojlan|tizim|masala|muammo|natija|jarayon|samarador|talaba|maktab|o[‘’ʻ'`]quv|tadqiqot|zamonaviy|raqamli)/iu;

/** Rus — BGN/PCGN (soddalashgan). `ye` qoidasi `transliterate` ichida. */
const RU: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n",
  о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "",
  э: "e", ю: "yu", я: "ya",
  // O'zbek/qozoq harflari rus matnida uchrasa ham o'qiladigan bo'lsin.
  ў: "o‘", қ: "q", ғ: "g‘", ҳ: "h", ә: "a", і: "i", ү: "u", ұ: "u", ң: "ng", ө: "o", һ: "h", ї: "yi", є: "ye", ґ: "g",
};

/** O'zbek kirill → rasmiy o'zbek lotin. */
const UZ: Record<string, string> = {
  ...RU,
  ж: "j",
  х: "x",
  ц: "ts",
  щ: "sh",
  ъ: "’",
  ы: "i",
  ў: "o‘",
  қ: "q",
  ғ: "g‘",
  ҳ: "h",
};

const VOWELS = new Set(["а", "е", "ё", "и", "о", "у", "ы", "э", "ю", "я", "ў", "ә", "і", "ү", "ұ", "ө"]);

/** Bitta matn qaysi yozuvda: kirill (uz/ru) yoki lotin (uz/en). */
export function scriptOf(text: string): { cyrillic: boolean; lang: ScriptLang } {
  const t = String(text ?? "");
  if (CYRILLIC_RE.test(t)) return { cyrillic: true, lang: UZ_CYR_RE.test(t) ? "uz" : "ru" };
  return { cyrillic: false, lang: UZ_LAT_RE.test(t) ? "uz" : "en" };
}

/**
 * Kirill → lotin. Lotin harflar, raqamlar, tinish belgilari o'zgarmaydi.
 * Bosh harf: ko'p harfli natija («Щ» → «Shch») keyingi harf ham bosh
 * bo'lsa («ЩИ») to'liq bosh («SHCH»).
 */
export function transliterate(text: string, lang: "ru" | "uz" = scriptOf(text).lang === "uz" ? "uz" : "ru"): string {
  const src = String(text ?? "");
  if (!CYRILLIC_RE.test(src)) return src;
  const map = lang === "uz" ? UZ : RU;
  let out = "";
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    const low = ch.toLowerCase();
    let rep = map[low];
    if (rep === undefined) {
      out += ch;
      continue;
    }
    if (low === "е") {
      // BGN/PCGN: so'z boshida, unli/ъ/ь dan keyin — «ye» (Ельцин → Yeltsin, Достоевский → Dostoyevskiy).
      const prev = i > 0 ? src[i - 1].toLowerCase() : "";
      const boundary = !prev || !/[\p{L}]/u.test(prev) || VOWELS.has(prev) || prev === "ъ" || prev === "ь";
      rep = boundary ? "ye" : "e";
    }
    if (ch !== low && rep) {
      const next = src[i + 1] ?? "";
      const prev = i > 0 ? src[i - 1] : "";
      const upperCtx = (next && /\p{Lu}/u.test(next)) || (!/\p{L}/u.test(next) && prev && /\p{Lu}/u.test(prev));
      rep = upperCtx ? rep.toUpperCase() : rep.charAt(0).toUpperCase() + rep.slice(1);
    }
    out += rep;
  }
  return out;
}

/** «[in Uzbek]» / «[in Russian]» — inglizcha matnga belgi kerak emas. */
export function languageTag(lang: ScriptLang): string {
  return lang === "uz" ? "[in Uzbek]" : lang === "ru" ? "[in Russian]" : "";
}
