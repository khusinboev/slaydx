/**
 * Iqtibos uslublari — bitta kirish nuqtasi (Maqola 2, WP5).
 *
 *   formatReference(ref, style, lang)  — adabiyotlar ro'yxati satri:
 *       gost    → ГОСТ 7.1-2003 (OAK)            `gost.ts`
 *       numeric → GOST tavsif, DOI ixtiyoriy      `numeric.ts`
 *       apa7    → APA 7                           `apa.ts`
 *       ieee    → IEEE                            `ieee.ts`
 *   formatReferencesEnglish(refs)      — OAK «REFERENCES»: kirill → lotin
 *       (BGN/PCGN, `translit.ts`), sarlavhaga `[in Uzbek]`/`[in Russian]`,
 *       APA 7 inglizcha shakl.
 *
 * `raw` (foydalanuvchi erkin matni, `verified:"user"`) `formatReference`
 * da O'ZGARISHSIZ qaytadi — foydalanuvchi yozganini biz «to'g'rilamaymiz».
 * REFERENCES ro'yxatida esa kirill `raw` transliteratsiya qilinadi (aks
 * holda ro'yxatning maqsadi — lotin o'quvchi — yo'qoladi), lotin `raw`
 * o'zgarmaydi.
 *
 * Matn ichidagi iqtibos ko'rinishi («[1; 25-b.]», «(Lin va b., 2023)»)
 * bu yerda EMAS — `article/layout.ts renderCitations`.
 */
import type { CiteStyle, Reference } from "../article/types";
import { formatGost } from "./gost";
import { formatApa } from "./apa";
import { formatIeee } from "./ieee";
import { formatNumeric } from "./numeric";
import { languageTag, scriptOf, transliterate } from "./translit";
import { authorsOf, familyCommaInitials } from "./names";

export { formatGost } from "./gost";
export { formatApa } from "./apa";
export { formatIeee } from "./ieee";
export { formatNumeric } from "./numeric";
export { transliterate, scriptOf, languageTag } from "./translit";
export { parseAuthor, authorsOf, familyInitials, familyCommaInitials, initialsFamily, type PersonName } from "./names";

export function formatReference(ref: Reference, style: CiteStyle, lang = "uz"): string {
  if (ref.raw?.trim()) return ref.raw.trim();
  switch (style) {
    case "apa7":
      return formatApa(ref, lang);
    case "ieee":
      return formatIeee(ref);
    case "numeric":
      return formatNumeric(ref, lang);
    default:
      return formatGost(ref, lang);
  }
}

/** Matn kirill bo'lsa lotinga (`lang` jadvali bilan); aks holda o'zgarmaydi. */
function latin(s: string | undefined, lang: "ru" | "uz"): string | undefined {
  if (!s) return s;
  return scriptOf(s).cyrillic ? transliterate(s, lang) : s;
}

/**
 * Manba TILI — bitta qaror butun yozuv uchun: sarlavha, muallif, venue,
 * nashriyot bir jadval bilan o'giriladi. Aks holda «ТАТУ хабарномаси»
 * (o'zbekcha, lekin ў/қ/ғ/ҳ siz) rus jadvali bilan «khabarnomasi»
 * chiqardi; sarlavhada («рақамли») o'zbek harfi bor — shu yetadi.
 */
function referenceLang(ref: Reference): "ru" | "uz" | "en" {
  const fields = [ref.title, ref.venue, ref.publisher, ref.place, ...ref.authors].filter(Boolean) as string[];
  const scripts = fields.map(scriptOf);
  if (scripts.some((s) => s.cyrillic && s.lang === "uz")) return "uz";
  const title = scriptOf(ref.title);
  if (title.cyrillic) return "ru";
  if (scripts.some((s) => s.cyrillic)) return "ru";
  return title.lang;
}

/**
 * Bitta manbaning REFERENCES ko'rinishi: barcha matn maydonlari lotinda,
 * sarlavhadan keyin til belgisi (inglizcha sarlavhada yo'q), APA 7 (en).
 */
export function formatReferenceEnglish(ref: Reference): string {
  if (ref.raw?.trim()) {
    const raw = ref.raw.trim();
    const sc = scriptOf(raw);
    return sc.cyrillic ? `${transliterate(raw, sc.lang === "uz" ? "uz" : "ru")} ${languageTag(sc.lang)}` : raw;
  }
  const lang = referenceLang(ref);
  const table = lang === "uz" ? "uz" : "ru";
  const tag = languageTag(lang);
  const title = `${latin(ref.title, table)!.trim().replace(/[.\s]+$/, "")}${tag ? ` ${tag}` : ""}`;
  /*
   * Muallif AVVAL tahlil qilinadi, KEYIN qismlari o'giriladi: «Щукин Ё.Ё.»
   * ni butunlay o'girsak «Shchukin Yo.Yo.» chiqadi va «Yo.Yo.» endi
   * inisialga o'xshamaydi — familiya deb olinardi. Natija «Familiya, I. O.»
   * (vergulli) shaklda qaytariladi — APA tahlili uni bir ma'noli o'qiydi.
   */
  const authors = authorsOf(ref).map((n) =>
    familyCommaInitials({ family: latin(n.family, table) ?? n.family, initials: n.initials.map((i) => latin(i, table) ?? i) }),
  );
  const en: Reference = {
    ...ref,
    title,
    authors,
    ...(ref.venue ? { venue: latin(ref.venue, table) } : {}),
    ...(ref.place ? { place: latin(ref.place, table) } : {}),
    ...(ref.publisher ? { publisher: latin(ref.publisher, table) } : {}),
  };
  return formatApa(en, "en");
}

export function formatReferencesEnglish(refs: Reference[]): string[] {
  return refs.map(formatReferenceEnglish);
}
