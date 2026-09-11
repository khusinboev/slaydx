/**
 * APA 7 ro'yxat satri (Maqola 2, WP5) — `apa` profili va OAK REFERENCES.
 *
 *   Maqola: Lin, C., Huang, A., & Lu, O. (2023). Sarlavha. Venue, 45–67. https://doi.org/10.…
 *   Kitob:  Karimov, A. (2022). Sarlavha. Fan.
 *
 * Qoidalar (APA 7, 9.8–10.1):
 *   • muallif «Familiya, I. O.», oxirgisidan oldin «&» (uz «va», ru «и» —
 *     matn ichidagi iqtibos bilan bir xil, `layout.ts apaJoin`);
 *   • 7+ muallif → birinchi 6, «…», oxirgisi (APA 21+ qoidasining
 *     soddalashgani — OpenAlex baribir 6 tagacha beradi);
 *   • yil «(2023)», yo'q bo'lsa «(n.d.)» / «(yilsiz)» / «(б. г.)»;
 *   • DOI doim `https://doi.org/…` shaklida, oxirida NUQTA YO'Q (APA
 *     havoladan keyin nuqta qo'ymaydi); DOI bo'lmasa URL;
 *   • nashr joyi YOZILMAYDI (APA 7 — faqat nashriyot);
 *   • sahifa diapazoni en dash «45–67», «pp.» yo'q (jurnal); jild/son
 *     `Reference` da yo'q — tushiriladi.
 * Ro'yxat tartibi (alifbo) — `layout.ts orderReferences`.
 */
import type { Reference } from "../article/types";
import { authorsOf, familyCommaInitials } from "./names";
import { dot, isPageRange, langKey, normalizePages } from "./gost";

const JOIN: Record<"uz" | "ru" | "en", { and: string; nd: string }> = {
  uz: { and: "va", nd: "yilsiz" },
  ru: { and: "и", nd: "б. г." },
  en: { and: "&", nd: "n.d." },
};

/** «Lin, C., Huang, A., & Lu, O.» — bo'sh bo'lsa "". */
export function apaAuthors(ref: Reference, lang: string): string {
  const names = authorsOf(ref).map(familyCommaInitials);
  if (!names.length) return "";
  const { and } = JOIN[langKey(lang)];
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]}, ${and} ${names[1]}`;
  if (names.length > 6) return `${names.slice(0, 6).join(", ")}, … ${names[names.length - 1]}`;
  return `${names.slice(0, -1).join(", ")}, ${and} ${names[names.length - 1]}`;
}

export function formatApa(ref: Reference, lang = "en"): string {
  const L = langKey(lang);
  const who = apaAuthors(ref, lang);
  const year = ref.year ? String(ref.year) : JOIN[L].nd;
  const title = ref.title.trim().replace(/[.\s]+$/, "");
  const venue = ref.venue?.trim().replace(/[.\s]+$/, "");
  const publisher = ref.publisher?.trim();
  const pages = normalizePages(ref.pages);
  const link = ref.doi ? `https://doi.org/${ref.doi.trim()}` : ref.url?.trim() ?? "";
  const parts: string[] = [];
  // Muallifsiz — sarlavha muallif o'rnida: «Sarlavha. (2023). Venue.»
  if (who) parts.push(`${dot(who)} (${year}).`, dot(title));
  else parts.push(dot(title), `(${year}).`);
  if (venue) {
    // Jurnal: «Venue, 45–67.»; sahifa jami hajm bo'lsa («120») — yozilmaydi.
    parts.push(dot(pages && isPageRange(pages) ? `${venue}, ${pages}` : venue));
  } else if (publisher) parts.push(dot(publisher));
  if (link) parts.push(link);
  return parts.join(" ");
}
