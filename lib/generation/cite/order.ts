/**
 * ADABIYOTLAR RO'YXATI TARTIBI — O'zbekiston qoidasi (AUDIT-19 WP-B).
 *
 * OTM uslubiy ko'rsatmalari (BuxDU, TATU, TDIU, ГОСТ 7.32-2017 amaliyoti)
 * ro'yxatni ALIFBO bo'yicha emas, HUJJAT KUCHI bo'yicha guruhlaydi:
 *
 *   1. Qonunlar (O‘RQ / ЗРУ)
 *   2. Prezident farmon va qarorlari (PF/УП, PQ/ПП)
 *   3. Vazirlar Mahkamasi qarorlari
 *   4. Vazirlik va idora hujjatlari
 *   5. Kitob / monografiya / darslik
 *   6. Ilmiy maqola
 *   7. Statistika va hisobotlar
 *   8. Internet manbalari («Murojaat sanasi» bilan)
 *
 * Har guruh ICHIDA alifbo: kirill yozuvi lotinga o'giriladi (`translit.ts`)
 * — aks holda «Ўзбекистон» va «O‘zbekiston» ro'yxatning ikki uchida
 * turardi. Tartib raqami (`Reference.n`) SHU yerda beriladi.
 *
 * `article/layout.ts orderReferences` (maqola) TEGILMAYDI: jurnal maqolasi
 * ro'yxati boshqa qoidada (matnda birinchi iqtibos tartibi / alifbo).
 */
import { kindOf, type Reference } from "../types";
import { lawKindOf } from "./gost";
import { authorsOf } from "./names";
import { scriptOf, transliterate } from "./translit";

export const UZ_GROUPS = ["law", "president", "cabinet", "ministry", "book", "article", "statistics", "web"] as const;
export type UzGroup = (typeof UZ_GROUPS)[number];

/** Statistika/hisobot belgilari — rasmiy to'plamlar internetdan OLDIN turadi. */
const STATS_RE =
  /(statistik|статистич|statistics|stat\.uz|qo[‘’'ʻ]mita|комитет|hisobot|отч[её]т|\breport\b|yillik axborot|bulletin|byulleten)/i;

/**
 * Manbaning ro'yxatdagi guruhi. `kind:"law"` bo'lganlar hujjat raqami/
 * organiga qarab 1–4 guruhga bo'linadi (`lawKindOf`).
 */
export function uzGroupOf(ref: Reference): UzGroup {
  const kind = kindOf(ref);
  if (kind === "law") {
    const k = lawKindOf(ref);
    if (k === "decree" || k === "resolution") return "president";
    if (k === "cabinet") return "cabinet";
    if (/vazirlik|vazirligi|ministr|министер|министр/i.test(ref.issuer ?? "")) return "ministry";
    return "law";
  }
  if (kind === "book") return "book";
  if (kind === "article") return "article";
  // Kitob/maqola bo'lmagan qolgani — statistik to'plammi yoki oddiy sayt.
  const hay = [ref.title, ref.publisher, ref.venue, ref.issuer].filter(Boolean).join(" ");
  if (STATS_RE.test(hay)) return "statistics";
  return "web";
}

const RANK: Record<UzGroup, number> = Object.fromEntries(UZ_GROUPS.map((g, i) => [g, i])) as Record<UzGroup, number>;

/**
 * Alifbo kaliti: birinchi muallif familiyasi (bo'lmasa sarlavha), kirill
 * → lotin, apostrof shakllari bir xil, kichik harf.
 */
export function sortKeyOf(ref: Reference): string {
  const family = authorsOf(ref)[0]?.family ?? "";
  const base = (family || ref.title || ref.raw || "").trim();
  const sc = scriptOf(base);
  const latin = sc.cyrillic ? transliterate(base, sc.lang === "uz" ? "uz" : "ru") : base;
  return latin
    .toLowerCase()
    .replace(/[‘’ʻ`´ʼ]/g, "'")
    .replace(/^[«"'(\[\s]+/, "")
    .trim();
}

/**
 * Ro'yxatni O'zbekiston tartibiga soladi va `n` ni qayta beradi.
 * Kirish massivi O'ZGARMAYDI (yangi obyektlar qaytadi).
 */
export function orderUzReferences(refs: Reference[]): Reference[] {
  const decorated = refs.map((ref, i) => ({ ref, i, group: RANK[uzGroupOf(ref)], key: sortKeyOf(ref) }));
  decorated.sort((a, b) => {
    if (a.group !== b.group) return a.group - b.group;
    const byKey = a.key.localeCompare(b.key, "en");
    // Teng kalitda BOSHLANG'ICH tartib saqlanadi — natija barqaror.
    return byKey !== 0 ? byKey : a.i - b.i;
  });
  return decorated.map((d, idx) => ({ ...d.ref, n: idx + 1 }));
}
