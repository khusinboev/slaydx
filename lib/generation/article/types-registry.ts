/**
 * 12 maqola turi — SKELET reyestri (Maqola 2, AUDIT-17).
 *
 * Har tur: bo'limlar ketma-ketligi, ulushlari, majburiylik. Bu ma'lumot
 * uch joyda ishlatiladi: (1) LLM rejasi/promptlari (`article/prompts.ts`),
 * (2) tuzilma darvozasi (`structure.ts` — `hard` bo'limlar), (3) forma
 * galereyasi (`ArticleTypeGallery`). Asos — tadqiqot (docs/AUDIT-17.md §2):
 * IMRAD variantlari, OAK jurnallari (Kirish → Adabiyotlar tahlili va
 * metodlar → Natijalar → Muhokama → Xulosa), CARE 13 punkt, PRISMA,
 * Frontiers/JMIR tur cheklovlari.
 *
 * Ulushlar — TAVSIYA (rasmiy standart yo'q), qattiq qoida emas: dvigatel
 * ular bo'yicha so'z byudjetini taqsimlaydi, darvoza esa faqat `hard`
 * bo'limlarning BORLIGINI tekshiradi.
 */
import type { ArticleType, ArticleTypeId, SkeletonSection } from "./types";

const S = (id: string, titleKey: SkeletonSection["titleKey"], sharePct: number, o: { required?: boolean; hard?: boolean } = {}): SkeletonSection => ({
  id,
  titleKey,
  sharePct,
  required: o.required ?? true,
  ...(o.hard ? { hard: true } : {}),
});

export const ARTICLE_TYPES: Record<ArticleTypeId, ArticleType> = {
  imrad_oak: {
    id: "imrad_oak",
    label: { uz: "OAK jurnali (IMRAD + Xulosa)", ru: "Журнал ОАК (IMRAD + Заключение)", en: "OAK journal (IMRAD + Conclusion)" },
    hint: "Kirish → Adabiyotlar tahlili va metodlar → Natijalar → Muhokama → Xulosa — O‘zbekiston jurnallarining asosiy shakli",
    skeleton: [
      S("intro", "intro", 15, { hard: true }),
      S("litreview_methods", "litreview_methods", 25),
      S("results", "results", 25, { hard: true }),
      S("discussion", "discussion", 25),
      S("conclusion", "conclusion", 10, { hard: true }),
    ],
    defaultProfile: "oak",
    pages: ["3-5", "5-10", "10-15"],
  },
  imrad_classic: {
    id: "imrad_classic",
    label: { uz: "Original tadqiqot (IMRAD)", ru: "Оригинальное исследование (IMRAD)", en: "Original research (IMRAD)" },
    hint: "Introduction → Methods → Results → Discussion → Conclusion — xalqaro empirik maqola",
    skeleton: [
      S("intro", "intro", 12, { hard: true }),
      S("methods", "methods", 25, { hard: true }),
      S("results", "results", 28, { hard: true }),
      S("discussion", "discussion", 27),
      S("conclusion", "conclusion", 8),
    ],
    defaultProfile: "apa",
    pages: ["3-5", "5-10", "10-15"],
  },
  three_part_uz: {
    id: "three_part_uz",
    label: { uz: "Nazariy / gumanitar (Kirish–Asosiy qism–Xulosa)", ru: "Теоретическая / гуманитарная", en: "Theoretical / humanities" },
    hint: "Kirish → mavzu bo‘yicha 3–5 nomlangan bo‘lim → Xulosa — universitet xabarnomalari, TATU tipidagi jurnallar",
    skeleton: [S("intro", "intro", 15, { hard: true }), S("body", "body", 70, { hard: true }), S("conclusion", "conclusion", 15, { hard: true })],
    freeSections: { min: 3, max: 5 },
    defaultProfile: "university",
    pages: ["3-5", "5-10", "10-15"],
  },
  review_narrative: {
    id: "review_narrative",
    label: { uz: "Sharh (obzor)", ru: "Обзор литературы", en: "Narrative review" },
    hint: "Kirish → tematik bo‘limlar → sintez va bo‘shliqlar → istiqbol → Xulosa; 30–100 manba",
    skeleton: [
      S("intro", "intro", 12, { hard: true }),
      S("methods", "search", 8, { required: false }),
      S("body", "body", 50, { hard: true }),
      S("synthesis", "synthesis", 15),
      S("future", "future", 8),
      S("conclusion", "conclusion", 7, { hard: true }),
    ],
    freeSections: { min: 3, max: 6 },
    defaultProfile: "apa",
    pages: ["5-10", "10-15"],
  },
  review_systematic: {
    id: "review_systematic",
    label: { uz: "Sistematik sharh (PRISMA)", ru: "Систематический обзор (PRISMA)", en: "Systematic review (PRISMA)" },
    hint: "Structured abstract → Kirish → Metodlar (protokol, mezonlar, qidiruv, tanlash, bias) → Natijalar (PRISMA flow) → Muhokama → Xulosa",
    skeleton: [
      S("intro", "intro", 10, { hard: true }),
      S("protocol", "protocol", 6),
      S("eligibility", "eligibility", 8),
      S("sources", "sources", 6),
      S("search", "search", 8),
      S("selection", "selection", 6),
      S("bias", "bias", 6),
      S("results", "results", 25, { hard: true }),
      S("discussion", "discussion", 18),
      S("conclusion", "conclusion", 7, { hard: true }),
    ],
    requiresPrisma: true,
    structuredAbstract: true,
    defaultProfile: "apa",
    pages: ["5-10", "10-15"],
  },
  short_communication: {
    id: "short_communication",
    label: { uz: "Qisqa xabar", ru: "Краткое сообщение", en: "Short communication" },
    hint: "Qisqa kirish → Metodlar va natijalar birga → Muhokama; ≤3 000 so‘z, ≤2 vizual, ≤20 manba",
    skeleton: [S("intro", "intro", 20, { hard: true }), S("results_methods", "results_methods", 50, { hard: true }), S("discussion", "discussion", 30)],
    wordRange: [1200, 3000],
    defaultProfile: "apa",
    pages: ["3-5"],
  },
  case_study_care: {
    id: "case_study_care",
    label: { uz: "Keys-tadqiqot (CARE)", ru: "Клинический случай (CARE)", en: "Case report (CARE)" },
    hint: "CARE 13 punkt: bemor/obyekt ma’lumoti → kuzatuvlar → Timeline → diagnostika → aralashuv → natija → muhokama → nuqtai nazar → rozilik",
    skeleton: [
      S("intro", "intro", 10, { hard: true }),
      S("patient", "patient", 10),
      S("findings", "findings", 10),
      S("timeline", "timeline", 8, { hard: true }),
      S("diagnostic", "diagnostic", 12),
      S("intervention", "intervention", 12),
      S("outcome", "outcome", 10),
      S("discussion", "discussion", 18, { hard: true }),
      S("perspective", "perspective", 5, { required: false }),
      S("consent", "consent", 5),
    ],
    requiresTimeline: true,
    defaultProfile: "apa",
    pages: ["3-5", "5-10"],
  },
  conference_thesis: {
    id: "conference_thesis",
    label: { uz: "Konferensiya tezisi", ru: "Тезисы конференции", en: "Conference abstract" },
    hint: "200–300 so‘z, bitta blok: kontekst → bo‘shliq → maqsad → metod → natija → ahamiyat; ≤3 manba",
    skeleton: [S("body", "body", 100, { hard: true })],
    wordRange: [200, 300],
    defaultProfile: "conference",
    pages: ["1-2"],
  },
  conference_extended: {
    id: "conference_extended",
    label: { uz: "Kengaytirilgan tezis / konferensiya maqolasi", ru: "Расширенные тезисы", en: "Extended abstract / conference paper" },
    hint: "500–1 500 so‘z, qisqa IMRAD + 1–2 vizual",
    skeleton: [S("intro", "intro", 20, { hard: true }), S("methods", "methods", 25), S("results", "results", 30, { hard: true }), S("conclusion", "conclusion", 25, { hard: true })],
    wordRange: [500, 1500],
    defaultProfile: "conference",
    pages: ["1-2", "3-5"],
  },
  methodical: {
    id: "methodical",
    label: { uz: "Metodik maqola", ru: "Методическая статья", en: "Methodological article" },
    hint: "Muammo → nazariy asos → metodika bayoni (bosqichma-bosqich) → qo‘llash namunasi → samaradorlik → tavsiyalar → Xulosa",
    skeleton: [
      S("intro", "intro", 12, { hard: true }),
      S("theory", "theory", 15),
      S("procedure", "procedure", 30, { hard: true }),
      S("example", "example", 18),
      S("evaluation", "evaluation", 10),
      S("recommendations", "recommendations", 8),
      S("conclusion", "conclusion", 7, { hard: true }),
    ],
    defaultProfile: "university",
    pages: ["3-5", "5-10", "10-15"],
  },
  analytical: {
    id: "analytical",
    label: { uz: "Tahliliy maqola", ru: "Аналитическая статья", en: "Analytical article" },
    hint: "Kirish → tahlil obyekti va axborot bazasi → tahlil (jadval/sxema ustun) → muammolar → yechim/tavsiyalar → Xulosa",
    skeleton: [
      S("intro", "intro", 12, { hard: true }),
      S("object", "object", 12),
      S("analysis", "analysis", 40, { hard: true }),
      S("problems", "problems", 14),
      S("solutions", "solutions", 14),
      S("conclusion", "conclusion", 8, { hard: true }),
    ],
    defaultProfile: "oak",
    pages: ["3-5", "5-10", "10-15"],
  },
  elsevier_ieee_style: {
    id: "elsevier_ieee_style",
    label: { uz: "Xalqaro (Elsevier / IEEE uslubi)", ru: "Международный (Elsevier / IEEE)", en: "International (Elsevier / IEEE style)" },
    hint: "Raqamlangan bo‘limlar 1., 1.1., structured abstract, Highlights 3–5 × ≤85 belgi; Scopus/WoS jurnallari uchun",
    skeleton: [
      S("intro", "intro", 12, { hard: true }),
      S("litreview", "litreview", 15),
      S("methods", "methods", 23, { hard: true }),
      S("results", "results", 25, { hard: true }),
      S("discussion", "discussion", 18),
      S("conclusion", "conclusion", 7, { hard: true }),
    ],
    numberedHeadings: true,
    highlights: { min: 3, max: 5, maxChars: 85 },
    structuredAbstract: true,
    defaultProfile: "ieee",
    pages: ["5-10", "10-15"],
  },
};

export function isArticleTypeId(v: unknown): v is ArticleTypeId {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(ARTICLE_TYPES, v);
}

/**
 * Noma'lum/bo'sh → `imrad_oak`. Eski formadagi `kind` qiymatlari ham
 * ko'chiriladi: `imrad` → `imrad_classic`, `standard` → `three_part_uz`
 * (eski standart maqola aynan Kirish–Asosiy qism–Xulosa edi).
 */
export function normalizeArticleType(v: unknown, legacyKind?: string): ArticleTypeId {
  if (isArticleTypeId(v)) return v;
  if (legacyKind === "imrad") return "imrad_classic";
  if (legacyKind === "standard") return "three_part_uz";
  return "imrad_oak";
}

/** Har tur skeletidagi `hard` bo'limlar (tuzilma darvozasi uchun). */
export function hardSections(type: ArticleTypeId): string[] {
  return ARTICLE_TYPES[type].skeleton.filter((s) => s.hard).map((s) => s.id);
}
