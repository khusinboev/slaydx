/**
 * ГОСТ 7.1-2003 bibliografik tavsif (Maqola 2, WP5) — OAK profili.
 *
 *   Maqola:  Familiya I.O., Familiya I.O. Sarlavha // Venue. – 2023. – B. 45–67. – DOI: 10.…
 *   Kitob:   Familiya I.O. Sarlavha. – Toshkent: Fan, 2022. – 120 b.
 *   Elektron: … – URL: https://… (DOI bo'lmasa)
 *
 * Qoidalar:
 *   • ≥4 muallif → birinchi 3 + «va b.» / «и др.» / «et al.» (til bo'yicha);
 *   • sahifa birligi: uz «B.» (bet), ru «С.», en «P.»; kitob hajmi «120 b.»;
 *   • yil yo'q — «б. г.» / «yilsiz» / «n.d.» YOZILMAYDI (GOST'da bo'sh
 *     element tushiriladi), faqat mavjud elementlar;
 *   • DOI «DOI: 10.…» — https prefikssiz (ГОСТ Р 7.0.100-2018 namunasi);
 *   • tinish: elementlar «. – » bilan, sarlavha va manba «//» bilan;
 *     nuqta ikkilanmaydi («Lin C..» yo'q).
 *
 * `raw` (foydalanuvchi erkin matni) bu yerga KELMAYDI — `index.ts` uni
 * o'zgarishsiz qaytaradi.
 */
import type { Reference } from "../article/types";
import { authorsOf, familyInitials } from "./names";

export type GostOpts = {
  /** URL (DOI bo'lmaganda) yoziladimi — `numeric` uslubida yo'q. */
  url?: boolean;
};

export type LangKey = "uz" | "ru" | "en";

export function langKey(lang: string | undefined): LangKey {
  const c = (lang || "uz").toLowerCase();
  return c === "ru" ? "ru" : c === "en" ? "en" : "uz";
}

const ET_AL: Record<LangKey, string> = { uz: "va b.", ru: "и др.", en: "et al." };
/** Maqola sahifasi «B. 45–67» va kitob hajmi «120 b.». */
const PAGE: Record<LangKey, { range: string; total: string }> = {
  uz: { range: "B.", total: "b." },
  ru: { range: "С.", total: "с." },
  en: { range: "P.", total: "p." },
};

/** Oxiridagi nuqta/bo'shliqni olib, bitta nuqta qo'yadi. */
export function dot(s: string): string {
  const t = s.replace(/[.\s]+$/, "");
  return t ? `${t}.` : "";
}

/** «25–31» / «25-31» / «120» → en dash bilan; bo'sh → "". */
export function normalizePages(p: string | undefined): string {
  return String(p ?? "")
    .trim()
    .replace(/\s*[-‐‑–—]\s*/g, "–")
    .replace(/^(pp?\.|с\.|b\.)\s*/i, "");
}

/** Sahifa diapazonmi («25–31») yoki jami hajm («120»). */
export function isPageRange(p: string): boolean {
  return /–/.test(p);
}

/** GOST muallif bloki: «Lin C., Huang A., Lu O.» yoki 4+ → «… va b.» */
export function gostAuthors(ref: Reference, lang: string): string {
  const names = authorsOf(ref).map(familyInitials);
  if (!names.length) return "";
  const L = langKey(lang);
  return names.length >= 4 ? `${names.slice(0, 3).join(", ")} ${ET_AL[L]}` : names.join(", ");
}

export function formatGost(ref: Reference, lang = "uz", opts: GostOpts = {}): string {
  const L = langKey(lang);
  const who = gostAuthors(ref, lang);
  const title = ref.title.trim().replace(/[.\s]+$/, "");
  const venue = ref.venue?.trim().replace(/[.\s]+$/, "");
  const place = ref.place?.trim();
  const publisher = ref.publisher?.trim();
  const year = ref.year ? String(ref.year) : "";
  const pages = normalizePages(ref.pages);
  const parts: string[] = [];

  // Bosh: «Muallif. Sarlavha» — muallifsiz manbada sarlavhaning o'zi.
  let head = who ? `${dot(who)} ${title}` : title;
  if (venue) {
    // Maqola: «Sarlavha // Venue. – Yil. – B. 45–67.»
    head += ` // ${venue}`;
    parts.push(dot(head));
    if (year) parts.push(`${year}.`);
    if (pages) parts.push(`${PAGE[L].range} ${pages}.`);
  } else {
    // Kitob: «Sarlavha. – Shahar: Nashriyot, yil. – 120 b.»
    parts.push(dot(head));
    const imprint = [place && publisher ? `${place}: ${publisher}` : place || publisher || "", year].filter(Boolean).join(", ");
    if (imprint) parts.push(`${imprint}.`);
    if (pages) parts.push(isPageRange(pages) ? `${PAGE[L].range} ${pages}.` : `${pages} ${PAGE[L].total}`);
  }
  if (ref.doi) parts.push(`DOI: ${ref.doi.trim()}.`);
  else if (opts.url !== false && ref.url) parts.push(`URL: ${ref.url.trim()}`);
  return parts.join(" – ");
}
