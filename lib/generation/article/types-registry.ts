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
    guidance: [
      "Uzbek HAC (OAK) journal voice: the introduction ends with an explicit aim; the literature-and-methods section names concrete sources per claim and the methods actually used (or the analytical framework if no experiment).",
      "Results report only what USER FACTS / SOURCES support — never invented measurements; qualitative results are stated as observations with citations.",
      "Discussion compares with at least three cited studies and states practical significance for Uzbekistan where relevant; conclusion mirrors the aim without new claims.",
    ],
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
    guidance: [
      "Classic IMRAD: introduction states the gap and a testable aim; Methods are written as a reproducible protocol (design, sample or materials, procedure, analysis) — if the author gave no experiment, describe the analytical procedure honestly instead of inventing one.",
      "Results are separated from interpretation; Discussion interprets, compares with cited work, states limitations; Conclusion answers the aim only.",
    ],
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
    guidance: [
      "Uzbek 'introduction – main part – conclusion' bulletin article: the main part is 3–5 thematic sections with their own titles, each developing one argument with sources; no IMRAD vocabulary (no 'Methods'/'Results' headings).",
      "The introduction gives relevance and aim in 1–2 paragraphs; the conclusion lists concrete findings and recommendations as short statements.",
    ],
    judge: {
      skip: ["methods"],
      describe: { comparison: "each thematic section engages cited sources (agrees, contrasts or extends them), not just lists them." },
    },
    skeleton: [S("intro", "intro", 15, { hard: true }), S("body", "body", 70, { hard: true }), S("conclusion", "conclusion", 15, { hard: true })],
    freeSections: { min: 3, max: 5 },
    defaultProfile: "university",
    pages: ["3-5", "5-10", "10-15"],
  },
  review_narrative: {
    id: "review_narrative",
    label: { uz: "Sharh (obzor)", ru: "Обзор литературы", en: "Narrative review" },
    hint: "Kirish → tematik bo‘limlar → sintez va bo‘shliqlar → istiqbol → Xulosa; 30–100 manba",
    guidance: [
      "Narrative (literature) review: there is NO own experiment — never write 'our study measured'; synthesise the cited literature by themes, contrasting approaches and pointing out gaps.",
      "The methods section briefly states how sources were selected (databases, period, inclusion criteria); the synthesis section argues, it does not summarise paper by paper.",
      "Close with an evidence-based research agenda (future directions), not with generic praise of the topic.",
    ],
    judge: {
      describe: {
        novelty: "the review offers a clear organising framework or synthesis that goes beyond listing sources.",
        methods: "the source-selection procedure (databases, period, inclusion/exclusion) is stated transparently.",
        comparison: "the synthesis explicitly contrasts findings of different cited studies (agreement, contradiction, gaps).",
      },
    },
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
    guidance: [
      "Systematic review (PRISMA 2020): the protocol, eligibility criteria, information sources, search strategy, selection process and risk-of-bias assessment are each described explicitly and match the PRISMA flow numbers.",
      "Results synthesise the included studies (characteristics table, main outcomes); never invent study counts or effect sizes — use only the numbers given in USER FACTS / SOURCES.",
      "Discussion states certainty of evidence and limitations of both the studies and the review process.",
    ],
    judge: {
      describe: {
        methods: "search strategy, eligibility criteria and selection process are reproducible (PRISMA items present and consistent).",
        novelty: "the review question is precise and the synthesis adds a clear answer or evidence map.",
      },
    },
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
    guidance: [
      "Short communication: one focused finding; combined methods-and-results section stays concise and factual; no extended literature survey.",
      "Discussion is 1–3 paragraphs: significance, one comparison with prior work, one limitation.",
    ],
    judge: { describe: { comparison: "the discussion relates the finding to at least one or two directly relevant cited studies." } },
    skeleton: [S("intro", "intro", 20, { hard: true }), S("results_methods", "results_methods", 50, { hard: true }), S("discussion", "discussion", 30)],
    wordRange: [1200, 3000],
    defaultProfile: "apa",
    pages: ["3-5"],
  },
  case_study_care: {
    id: "case_study_care",
    label: { uz: "Keys-tadqiqot (CARE)", ru: "Клинический случай (CARE)", en: "Case report (CARE)" },
    hint: "CARE 13 punkt: bemor/obyekt ma’lumoti → kuzatuvlar → Timeline → diagnostika → aralashuv → natija → muhokama → nuqtai nazar → rozilik",
    guidance: [
      "Clinical/technical case report following CARE: patient (or object) information, findings, a dated timeline, diagnostic reasoning, intervention and outcome are reported as observed facts from USER FACTS — nothing is invented.",
      "Discussion explains why the case is instructive and compares with published cases; include a patient perspective and consent statement sections as given by the skeleton.",
    ],
    judge: {
      describe: {
        methods: "the timeline and diagnostic/intervention details are specific enough for a reader to follow the case chronologically.",
        novelty: "the report states clearly what is unusual or instructive about this case.",
      },
    },
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
    guidance: [
      "Conference abstract (thesis): a single dense block — context, gap, aim, method, key result, significance — in that order, no headings, no literature survey.",
      "Every sentence carries information; no introductory filler; at most one or two citations.",
    ],
    judge: {
      skip: ["comparison", "methods"],
      describe: { chain: "aim → method → result → significance are all present and consistent within the block." },
    },
    skeleton: [S("body", "body", 100, { hard: true })],
    wordRange: [200, 300],
    defaultProfile: "conference",
    pages: ["1-2"],
  },
  conference_extended: {
    id: "conference_extended",
    label: { uz: "Kengaytirilgan tezis / konferensiya maqolasi", ru: "Расширенные тезисы", en: "Extended abstract / conference paper" },
    hint: "500–1 500 so‘z, qisqa IMRAD + 1–2 vizual",
    guidance: [
      "Extended abstract / short conference paper: compact IMRAD — the introduction is one paragraph with the aim; methods are a brief but reproducible description; results give the main finding; conclusion states significance and next steps.",
      "Prefer one table or figure that carries the core result; avoid long literature discussion.",
    ],
    skeleton: [S("intro", "intro", 20, { hard: true }), S("methods", "methods", 25), S("results", "results", 30, { hard: true }), S("conclusion", "conclusion", 25, { hard: true })],
    wordRange: [500, 1500],
    defaultProfile: "conference",
    pages: ["1-2", "3-5"],
  },
  methodical: {
    id: "methodical",
    label: { uz: "Metodik maqola", ru: "Методическая статья", en: "Methodological article" },
    hint: "Muammo → nazariy asos → metodika bayoni (bosqichma-bosqich) → qo‘llash namunasi → samaradorlik → tavsiyalar → Xulosa",
    guidance: [
      "Methodical article: the core is a step-by-step procedure (numbered steps, inputs/outputs of each step, tools) that a reader could apply; the theory section justifies the method with sources.",
      "Give a worked example with concrete inputs (from USER FACTS or clearly labelled illustrative values), then an evaluation of applicability and recommendations for practitioners/teachers.",
    ],
    judge: {
      describe: {
        methods: "the procedure is described step by step so a reader could apply it (inputs, actions, outputs, tools).",
        novelty: "the method or its adaptation is clearly distinguished from existing approaches.",
        comparison: "the evaluation section relates the method to alternative approaches in the cited literature.",
      },
    },
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
    guidance: [
      "Analytical article: define the object of analysis and its information base precisely; the analysis section is the core — structured by criteria or factors, using tables/schemes, every quantitative statement sourced.",
      "Problems are stated as findings of the analysis (cause → consequence), solutions are specific, feasible and tied to the problems; the conclusion summarises findings and recommendations without new arguments.",
    ],
    judge: {
      describe: {
        methods: "the object, information base and analytical criteria are stated so the analysis could be repeated with the same sources.",
        comparison: "problems and solutions are related to what cited studies report (supporting or contrasting).",
      },
    },
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
    guidance: [
      "International (Elsevier/IEEE) style: numbered sections, a structured abstract and highlights; the introduction ends with explicit contributions (bullet-like sentences) and the paper organisation.",
      "Related work positions the paper against specific cited works; methods are precise and reproducible; results are compared quantitatively where data exists; limitations and future work close the discussion.",
    ],
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
