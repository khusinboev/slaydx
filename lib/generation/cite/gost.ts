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
import type { Reference } from "../types";
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

/* ──────────── kitob / normativ hujjat / internet (AUDIT-19) ──────────── */

/**
 * KITOB (darslik, monografiya) — o'zbek GOST 7.1 shakli:
 *
 *   Karimov A. Ta'limda raqamli texnologiyalar. – Toshkent: Fan, 2022. – 240 b.
 *
 * `formatGost` dan farqi: hajm `pageCount` dan olinadi (Google Books
 * `pageCount` beradi, `pages` esa maqola sahifalari uchun), shahar
 * berilmasa element butunlay tushadi (GOST'da bo'sh element yozilmaydi —
 * «– : Fan, 2022» bo'lmaydi).
 */
export function formatGostBook(ref: Reference, lang = "uz"): string {
  const L = langKey(lang);
  const who = gostAuthors(ref, lang);
  const title = ref.title.trim().replace(/[.\s]+$/, "");
  const place = ref.place?.trim();
  const publisher = ref.publisher?.trim();
  const year = ref.year ? String(ref.year) : "";
  const parts: string[] = [dot(who ? `${dot(who)} ${title}` : title)];
  const imprint = [place && publisher ? `${place}: ${publisher}` : place || publisher || "", year].filter(Boolean).join(", ");
  if (imprint) parts.push(`${imprint}.`);
  const total = ref.pageCount && ref.pageCount > 0 ? String(ref.pageCount) : normalizePages(ref.pages);
  if (total) parts.push(isPageRange(total) ? `${PAGE[L].range} ${total}.` : `${total} ${PAGE[L].total}`);
  return parts.join(" – ");
}

/** Hujjat TURI — raqam prefiksidan, bo'lmasa organ nomidan. */
export function lawKindOf(ref: Pick<Reference, "docNo" | "issuer">): "law" | "decree" | "resolution" | "cabinet" {
  const no = (ref.docNo ?? "").toUpperCase().replace(/[‘’ʻ`´ʼ]/g, "");
  if (/^(PF|УП|UP)\s*[-–]?\s*\d/.test(no)) return "decree";
  if (/^(PQ|ПП|PP)\s*[-–]?\s*\d/.test(no)) return "resolution";
  if (/^(ORQ|ЗРУ|LRU)\s*[-–]?\s*\d/.test(no)) return "law";
  const who = ref.issuer ?? "";
  if (/Prezident|Президент/i.test(who)) return "resolution";
  if (/Vazirlar Mahkama|Кабинет Министров/i.test(who)) return "cabinet";
  return "law";
}

const LAW_WORD: Record<LangKey, Record<"law" | "decree" | "resolution" | "cabinet", string>> = {
  uz: { law: "Qonuni", decree: "Farmoni", resolution: "Qarori", cabinet: "Qarori" },
  ru: { law: "Закон", decree: "Указ", resolution: "Постановление", cabinet: "Постановление" },
  en: { law: "Law", decree: "Decree", resolution: "Resolution", cabinet: "Resolution" },
};

/** Sarlavhaning o'zi rasmiy nom (ichida «Qonuni»/«Farmoni»/… bor)mi. */
function isOfficialTitle(title: string): boolean {
  return /(qonun|farmon|qaror|закон|указ|постановлен|\blaw\b|decree|resolution)/i.test(title);
}

/** ISO «2019-09-20» → «20.09.2019»; bo'lmasa yil; ikkalasi ham yo'q — "". */
function lawDate(ref: Pick<Reference, "docDate" | "year">): string {
  const m = String(ref.docDate ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  return ref.year ? String(ref.year) : "";
}

/**
 * NORMATIV HUJJAT (lex.uz) — O'zbekiston amaliyotidagi shakl:
 *
 *   O‘zbekiston Respublikasining «Ta’lim to‘g‘risida»gi Qonuni,
 *   20.09.2019 y., № O‘RQ-563. — https://lex.uz/docs/5013009
 *
 * Model bergan sarlavha ko'pincha ALLAQACHON rasmiy to'liq nom («…
 * Qonuni») — u holda organ va hujjat so'zi qayta qo'shilmaydi, aks holda
 * «O‘zR Prezidentining «O‘zR Prezidentining …» Farmoni» chiqardi.
 */
export function formatGostLaw(ref: Reference, lang = "uz"): string {
  const L = langKey(lang);
  const title = ref.title.trim().replace(/[.\s]+$/, "");
  const kind = lawKindOf(ref);
  const word = LAW_WORD[L][kind];
  const issuer = ref.issuer?.trim() ?? "";
  let head: string;
  if (isOfficialTitle(title)) head = title;
  else if (L === "uz") head = issuer ? `${issuer}ning «${title}» ${word}` : `«${title}» ${word}`;
  else if (L === "ru") head = issuer ? `${word} ${issuer} «${title}»` : `${word} «${title}»`;
  else head = issuer ? `${word} of ${issuer} «${title}»` : `${word} «${title}»`;

  const date = lawDate(ref);
  const tail: string[] = [];
  if (date) tail.push(L === "uz" ? `${date} y.` : L === "ru" ? `${date} г.` : date);
  if (ref.docNo) tail.push(L === "en" ? `No. ${ref.docNo.trim()}` : `№ ${ref.docNo.trim()}`);
  const body = tail.length ? `${head}, ${tail.join(", ")}.` : dot(head);
  return ref.url ? `${body} — ${ref.url.trim()}` : body;
}

const ACCESSED: Record<LangKey, string> = { uz: "Murojaat sanasi", ru: "дата обращения", en: "accessed" };

/**
 * INTERNET manbasi: «Nomi // URL (Murojaat sanasi: 12.03.2026)».
 * «Murojaat sanasi» O'zbekiston uslubiy ko'rsatmalarida MAJBURIY —
 * sana bo'lmasa qavs yozilmaydi (yolg'on sana qo'yilmaydi).
 */
export function formatGostWeb(ref: Reference, lang = "uz"): string {
  const L = langKey(lang);
  const who = gostAuthors(ref, lang);
  const title = ref.title.trim().replace(/[.\s]+$/, "");
  const head = who ? `${dot(who)} ${title}` : title;
  const url = ref.url?.trim() ?? "";
  const m = String(ref.accessed ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const when = m ? `${m[3]}.${m[2]}.${m[1]}` : "";
  if (!url) return dot(head);
  return `${head} // ${url}${when ? ` (${ACCESSED[L]}: ${when})` : ""}`;
}
