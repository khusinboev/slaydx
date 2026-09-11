/**
 * Maqola KIRISHI (Maqola 2, AUDIT-17) — formadan dvigatelgacha.
 *
 * `FormValues` (satr/son/mantiqiy) bilan `ArticleInput` orasidagi yagona
 * ko'prik, `resume/input.ts` naqshi: ikki tomonga ishlaydi —
 *   • `articleInputFromValues` — server (dvigatel, zond);
 *   • `encodeArticleValues`    — klient (forma qiymatlarini yig'adi).
 * Ikkalasi bitta faylda, chunki JSON maydonlar shakli AYNAN mos bo'lishi
 * kerak; ajratilsa vergul/JSON farqi bilan jim sinardi.
 *
 * Yassi maydonlar (`articleType`, `pubProfile`, `citeStyle`, `udk`,
 * `figureCount`, `research`) `DocMeta` da ham bor (`extractMeta`); bu
 * yerda ular QAYTA o'qiladi, chunki dvigatel `ArticleInput` ni bitta
 * obyekt sifatida oladi — ikkita manba (meta + input) ajralib ketmasin
 * deb normalizatsiya bitta joyda.
 *
 * Server importi YO'Q (izomorf): `lib/server/validate.ts` JSON maydon
 * ro'yxatini `article-params.ts` dan oladi.
 */
import type { FormValues } from "../../types";
import { splitCsv, joinCsv } from "../slide-params";
import {
  ARTICLE_LIMITS,
  CITE_STYLES,
  PAGES_IDS,
  type ArticleAuthor,
  type ArticleType,
  type ArticleTypeId,
  type CiteStyle,
  type PagesId,
  type PublicationProfileId,
} from "./types";
import { ARTICLE_TYPES, normalizeArticleType } from "./types-registry";
import { normalizePublicationProfile } from "./profiles";

/** Foydalanuvchining o'z manbasi — DOI yoki erkin matn (yoki ikkalasi). */
export type ArticleUserRef = {
  /** `u1`, `u2` … — matndagi iqtibos `[u1]` shu id bilan. */
  id: string;
  doi?: string;
  /** Erkin matnli manba («Karimov A. Ta'limda AI. — Toshkent: Fan, 2022.»). */
  raw?: string;
  title?: string;
  authors?: string[];
  year?: number;
  venue?: string;
  url?: string;
};

/** Foydalanuvchi ma'lumoti — FAQAT shundan raqamli grafik chiziladi. */
export type ArticleUserData = {
  categories: string[];
  series: { name: string; values: number[] }[];
  unit?: string;
};

export type ArticleInput = {
  topic: string;
  articleType: ArticleTypeId;
  pubProfile: PublicationProfileId;
  /** Profil standartini bekor qiladi; berilmasa profilniki. */
  citeStyle?: CiteStyle;
  /** uz | ru | en — maqola tili (annotatsiya baribir uchalasida). */
  language: "uz" | "ru" | "en";
  pages: PagesId;
  authors: ArticleAuthor[];
  udk: string;
  keywords: string[];
  /** «Natijalarim / tajriba» — VERBATIM saqlanadigan faktlar. */
  userFacts: string;
  userRefs: ArticleUserRef[];
  userData?: ArticleUserData;
  figureCount: number;
  research: boolean;
  extra: string;
  /** Yuklangan fayl matni (`meta.sourceText`) — kontekst. */
  sourceText: string;
};

/** Maydon chegaralari — `ARTICLE_LIMITS` ga qo'shimcha, faqat kirish uchun. */
export const ARTICLE_INPUT_LIMITS = {
  topicChars: 300,
  nameChars: 120,
  orgChars: 200,
  degreeChars: 80,
  emailChars: 120,
  keywordChars: 60,
  rawRefChars: 400,
  refTitleChars: 300,
  refAuthors: 10,
  extraChars: 1500,
  categories: 12,
  series: 4,
  seriesNameChars: 60,
} as const;

/* ────────────────────────── kesilgan JSON ga chidamlilik ────────────────────────── */

/**
 * Kesilgan/buzuq JSON ni tiklaydi (`parseResumeJson` bilan bir qaror).
 *
 * `sanitizeValues` maydonni belgi bo'yicha kesadi (`MAX_JSON` 24 000):
 * `[{"doi":"…"},{"raw":"Kari` kabi yarim JSON keladi. Butun ro'yxatni
 * yo'qotish o'rniga oxirgi TO'LIQ `}` gacha qirqib, ro'yxat/obyekt
 * yopiladi va qayta uriniladi.
 */
export function parseArticleJson(raw: unknown, field: string): unknown {
  if (raw && typeof raw === "object") return raw;
  const t = String(raw ?? "").trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    /* pastda tiklanadi */
  }
  const cut = t.lastIndexOf("}");
  if (cut > 0) {
    const head = t.slice(0, cut + 1);
    const candidates = t.startsWith("[") ? [`${head}]`, head] : t.startsWith("{") ? [`${head}}`, `${head}]}`, head] : [head];
    for (const candidate of candidates) {
      try {
        const v = JSON.parse(candidate);
        console.warn(`[article] «${field}» JSON kesilgan (${t.length} belgi) — ${candidate.length} belgigacha tiklandi`);
        return v;
      } catch {
        /* keyingi nomzod */
      }
    }
  }
  console.warn(`[article] «${field}» JSON o'qib bo'lmadi (${t.length} belgi) — bo'sh qoldirildi`);
  return null;
}

function jsonRows(values: FormValues, field: string): Record<string, unknown>[] {
  const v = parseArticleJson(values[field], field);
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object" && !Array.isArray(x));
}

/* ────────────────────────── yordamchilar ────────────────────────── */

const str = (v: unknown, max: number): string =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : typeof v === "number" ? String(v) : "";
const text = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * DOI ni bitta shaklga keltiradi: `https://doi.org/10.1/x`, `doi:10.1/x`,
 * `DOI 10.1/x` → `10.1/x`. Crossref/OpenAlex ikkalasi ham prefikssiz
 * shaklni kutadi; dedup ham shu shaklda.
 */
export function normalizeDoi(raw: unknown): string {
  const t = String(raw ?? "")
    .trim()
    .replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi\s*:?\s*/i, "")
    .trim();
  return /^10\.\d{4,9}\/\S+$/i.test(t) ? t.replace(/[.,;)\]]+$/, "") : "";
}

/** ORCID `0000-0002-1825-0097` — oxirgi belgi X bo'lishi mumkin. */
export function normalizeOrcid(raw: unknown): string {
  const t = String(raw ?? "")
    .trim()
    .replace(/^(?:https?:\/\/)?orcid\.org\//i, "");
  return /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/i.test(t) ? t.toUpperCase() : "";
}

function isLang(v: string): v is "uz" | "ru" | "en" {
  return v === "uz" || v === "ru" || v === "en";
}

function isPagesId(v: string): v is PagesId {
  return (PAGES_IDS as readonly string[]).includes(v);
}

function isCiteStyle(v: string): v is CiteStyle {
  return (CITE_STYLES as readonly string[]).includes(v);
}

/**
 * Hajm TURGA mos bo'lishi kerak: tezis «10–15 bet» bo'lmaydi, sharh
 * «1–2 bet» bo'lmaydi. Nomuvofiq tanlov turning BIRINCHI paketiga
 * tushadi (forma ham shuni ko'rsatadi), noma'lum qiymat esa `3-5` ga
 * (`defaultPages("article")`), u ham bo'lmasa — birinchisiga.
 *
 * `priceFor` (lib/tools.ts) ham SHU funksiyani chaqiradi — narx va
 * dvigatel hajmi bitta qoidadan: aks holda «1–2» narxiga 10 betlik
 * sharh so'rab bo'lardi.
 */
export function normalizeArticlePages(type: ArticleType, raw: unknown): PagesId {
  const v = str(raw, 10);
  if (isPagesId(v) && type.pages.includes(v)) return v;
  return type.pages.includes("3-5") ? "3-5" : type.pages[0];
}

/** Formadagi tur (eski `kind` ham) — `priceFor` va kirish uchun bitta joy. */
export function articleTypeOf(values: FormValues): ArticleType {
  return ARTICLE_TYPES[normalizeArticleType(str(values.articleType, 40), str(values.kind, 20))];
}

function authorOf(row: Record<string, unknown>): ArticleAuthor | null {
  const name = str(row.name, ARTICLE_INPUT_LIMITS.nameChars);
  if (!name) return null;
  const a: ArticleAuthor = { name };
  const degree = str(row.degree, ARTICLE_INPUT_LIMITS.degreeChars);
  const org = str(row.org ?? row.organization, ARTICLE_INPUT_LIMITS.orgChars);
  const email = str(row.email, ARTICLE_INPUT_LIMITS.emailChars);
  const orcid = normalizeOrcid(row.orcid);
  if (degree) a.degree = degree;
  if (org) a.org = org;
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) a.email = email;
  if (orcid) a.orcid = orcid;
  return a;
}

function userRefOf(row: Record<string, unknown>, i: number): ArticleUserRef | null {
  const doi = normalizeDoi(row.doi ?? row.DOI);
  const raw = text(row.raw ?? row.text, ARTICLE_INPUT_LIMITS.rawRefChars).replace(/\s+/g, " ");
  const title = str(row.title, ARTICLE_INPUT_LIMITS.refTitleChars);
  // DOI ni foydalanuvchi erkin matn ichida ham yozgan bo'lishi mumkin.
  const doiInRaw = !doi && raw ? normalizeDoi(raw.match(/10\.\d{4,9}\/\S+/)?.[0]) : "";
  const finalDoi = doi || doiInRaw;
  if (!finalDoi && !raw && !title) return null;
  const r: ArticleUserRef = { id: `u${i + 1}` };
  if (finalDoi) r.doi = finalDoi;
  if (raw) r.raw = raw;
  if (title) r.title = title;
  const authors = Array.isArray(row.authors)
    ? row.authors.map((a) => str(a, ARTICLE_INPUT_LIMITS.nameChars)).filter(Boolean).slice(0, ARTICLE_INPUT_LIMITS.refAuthors)
    : typeof row.authors === "string"
      ? splitCsv(row.authors, ARTICLE_INPUT_LIMITS.refAuthors, ARTICLE_INPUT_LIMITS.nameChars)
      : [];
  if (authors.length) r.authors = authors;
  const year = Number(row.year);
  if (Number.isInteger(year) && year >= 1800 && year <= 2100) r.year = year;
  const venue = str(row.venue ?? row.journal, ARTICLE_INPUT_LIMITS.refTitleChars);
  if (venue) r.venue = venue;
  const url = str(row.url, 300);
  if (/^https?:\/\//i.test(url)) r.url = url;
  return r;
}

/**
 * Foydalanuvchi ma'lumoti — faqat TO'LIQ shakl qabul qilinadi: kategoriyalar
 * + har seriyada kategoriya soniga TENG sonli qiymatlar. Yarim jadvaldan
 * grafik chizilsa u aldamchi bo'ladi («uydirma raqam TAQIQ» qoidasi
 * shu yerda ham amal qiladi).
 */
export function parseUserData(raw: unknown): ArticleUserData | undefined {
  const v = parseArticleJson(raw, "userData");
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  const categories = Array.isArray(o.categories)
    ? o.categories.map((c) => str(c, 40)).filter(Boolean).slice(0, ARTICLE_INPUT_LIMITS.categories)
    : [];
  if (categories.length < 2) return undefined;
  const series = (Array.isArray(o.series) ? o.series : [])
    .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === "object")
    .map((s) => ({
      name: str(s.name, ARTICLE_INPUT_LIMITS.seriesNameChars),
      values: Array.isArray(s.values) ? s.values.map((x) => Number(x)) : [],
    }))
    .filter((s) => s.name && s.values.length === categories.length && s.values.every((x) => Number.isFinite(x)))
    .slice(0, ARTICLE_INPUT_LIMITS.series);
  if (!series.length) return undefined;
  const out: ArticleUserData = { categories, series };
  const unit = str(o.unit, 20);
  if (unit) out.unit = unit;
  return out;
}

/* ────────────────────────── forma → kirish ────────────────────────── */

export function articleInputFromValues(values: FormValues): ArticleInput {
  const type = articleTypeOf(values);
  const articleType = type.id;
  const pubProfile = normalizePublicationProfile(str(values.pubProfile, 20), type.defaultProfile);
  const langRaw = str(values.language, 8).toLowerCase();
  const pages = normalizeArticlePages(type, values.pages);
  const citeRaw = str(values.citeStyle, 10);

  let authors = jsonRows(values, "authors")
    .map(authorOf)
    .filter((a): a is ArticleAuthor => Boolean(a))
    .slice(0, ARTICLE_LIMITS.authors);
  // Eski forma (bitta muallif yassi maydonlarda) — ko'chiriladi.
  if (!authors.length) {
    const legacy = authorOf({ name: values.author, degree: values.degree, org: values.organization, email: values.email });
    if (legacy) authors = [legacy];
  }

  const keywordsJson = parseArticleJson(values.keywords, "keywords");
  const keywords = (Array.isArray(keywordsJson)
    ? keywordsJson.map((k) => str(k, ARTICLE_INPUT_LIMITS.keywordChars)).filter(Boolean)
    : splitCsv(values.keywords, ARTICLE_LIMITS.keywords, ARTICLE_INPUT_LIMITS.keywordChars)
  ).slice(0, ARTICLE_LIMITS.keywords);

  const userRefs = jsonRows(values, "userRefs")
    .slice(0, ARTICLE_LIMITS.userRefs)
    .map(userRefOf)
    .filter((r): r is ArticleUserRef => Boolean(r))
    // id lar bo'shliqsiz qayta beriladi — `[u3]` iqtibosi doim mavjud manbaga ishora qilsin.
    .map((r, i) => ({ ...r, id: `u${i + 1}` }));

  const figRaw = Number(values.figureCount ?? 2);
  const input: ArticleInput = {
    topic: str(values.topic, ARTICLE_INPUT_LIMITS.topicChars),
    articleType,
    pubProfile,
    language: isLang(langRaw) ? langRaw : "uz",
    pages,
    authors,
    udk: str(values.udk, ARTICLE_LIMITS.udkChars),
    keywords,
    userFacts: text(values.userFacts, ARTICLE_LIMITS.userFactsChars),
    userRefs,
    figureCount: Math.max(0, Math.min(ARTICLE_LIMITS.figures, Number.isFinite(figRaw) ? Math.round(figRaw) : 2)),
    research: values.research !== false,
    extra: text(values.extra, ARTICLE_INPUT_LIMITS.extraChars),
    sourceText: text(values.sourceText, 24_000),
  };
  if (isCiteStyle(citeRaw)) input.citeStyle = citeRaw;
  const userData = parseUserData(values.userData);
  if (userData) input.userData = userData;
  return input;
}

/** Klient uchun teskari yo'l — forma holatidan `FormValues`. */
export function encodeArticleValues(input: ArticleInput): FormValues {
  const out: FormValues = {
    topic: input.topic,
    articleType: input.articleType,
    pubProfile: input.pubProfile,
    language: input.language,
    pages: input.pages,
    authors: JSON.stringify(input.authors),
    udk: input.udk,
    keywords: JSON.stringify(input.keywords),
    userFacts: input.userFacts,
    userRefs: JSON.stringify(input.userRefs.map((r) => { const { id, ...rest } = r; void id; return rest; })),
    figureCount: input.figureCount,
    research: input.research,
    extra: input.extra,
  };
  if (input.citeStyle) out.citeStyle = input.citeStyle;
  if (input.userData) out.userData = JSON.stringify(input.userData);
  if (input.sourceText) out.sourceText = input.sourceText;
  return out;
}

/** CSV ko'rinishi — eski forma/qidiruv uchun (`keywords` chips). */
export function keywordsCsv(input: ArticleInput): string {
  return joinCsv(input.keywords);
}
