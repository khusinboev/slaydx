/**
 * Maqola 2 (AUDIT-17) — tiplar. Izomorf: server/DOM importi YO'Q.
 *
 * Yagona manba qarori: matn `AcademicDoc.sections` da (oqadigan hujjat —
 * `paginate.ts` va `render-docx` bloklari qayta ishlatiladi), bu yerdagi
 * `ArticleModel` esa METAMA'LUMOT: tur, nashr profili, mualliflar,
 * TEKSHIRILGAN manbalar, sxemalar, tayyorlik hisoboti. Tartib va raqamlash
 * (UDK → sarlavha → mualliflar → annotatsiya ×3 → bo'limlar → adabiyotlar;
 * 1-rasm / 1.1-rasm / (1) / [1; 25-b.]) — `article/layout.ts planArticle`.
 */

/* ────────────────────────── maqola turlari ────────────────────────── */

export const ARTICLE_TYPE_IDS = [
  "imrad_oak",
  "imrad_classic",
  "three_part_uz",
  "review_narrative",
  "review_systematic",
  "short_communication",
  "case_study_care",
  "conference_thesis",
  "conference_extended",
  "methodical",
  "analytical",
  "elsevier_ieee_style",
] as const;
export type ArticleTypeId = (typeof ARTICLE_TYPE_IDS)[number];

/** Bo'lim sarlavhasi kaliti — `article/labels.ts` uz/ru/en yorlig'i. */
export type SectionKey =
  | "intro"
  | "litreview"
  | "litreview_methods"
  | "methods"
  | "results"
  | "results_methods"
  | "discussion"
  | "conclusion"
  | "main"
  | "synthesis"
  | "future"
  | "protocol"
  | "eligibility"
  | "sources"
  | "search"
  | "selection"
  | "bias"
  | "patient"
  | "findings"
  | "timeline"
  | "diagnostic"
  | "intervention"
  | "outcome"
  | "perspective"
  | "consent"
  | "theory"
  | "procedure"
  | "example"
  | "evaluation"
  | "recommendations"
  | "object"
  | "analysis"
  | "problems"
  | "solutions"
  | "body";

export type SkeletonSection = {
  /** Barqaror id — `DocSection.id` shu bo'ladi (tahrir yo'llari, darvozalar). */
  id: string;
  titleKey: SectionKey;
  /** Umumiy hajmdagi ulushi (%); jami ≈ 100. */
  sharePct: number;
  /** Bo'lim model rejasida bo'lishi kerakmi. */
  required: boolean;
  /** Yo'q bo'lsa generatsiya XATO bilan tugaydi (kredit qaytadi) — `structure.ts`. */
  hard?: boolean;
};

export type ArticleType = {
  id: ArticleTypeId;
  label: { uz: string; ru: string; en: string };
  /** Galereya kartasi uchun bir qatorli izoh (uz). */
  hint: string;
  skeleton: SkeletonSection[];
  /** `three_part_uz`: asosiy qism — mavzu bo'yicha nomlangan 3–5 bo'lim. */
  freeSections?: { min: number; max: number };
  /** So'z chegarasi (tezislar); bet emas. */
  wordRange?: [number, number];
  /** PRISMA flow-diagramma majburiy (`review_systematic`). */
  requiresPrisma?: boolean;
  /** Timeline jadvali majburiy (`case_study_care`). */
  requiresTimeline?: boolean;
  /** Bo'limlar 1., 1.1. raqamlanadi (xalqaro uslub). */
  numberedHeadings?: boolean;
  /** Highlights (Elsevier): 3–5 ta, har biri ≤85 belgi. */
  highlights?: { min: number; max: number; maxChars: number };
  /** Structured abstract (Background/Methods/Results/Conclusions). */
  structuredAbstract?: boolean;
  /** Standart nashr profili. */
  defaultProfile: PublicationProfileId;
  /** Mos hajm paketlari (bet). */
  pages: readonly PagesId[];
};

/* ────────────────────────── nashr profillari ────────────────────────── */

export const PUBLICATION_PROFILE_IDS = ["oak", "university", "apa", "ieee", "conference"] as const;
export type PublicationProfileId = (typeof PUBLICATION_PROFILE_IDS)[number];

export const CITE_STYLES = ["gost", "numeric", "apa7", "ieee"] as const;
export type CiteStyle = (typeof CITE_STYLES)[number];

export type PublicationProfile = {
  id: PublicationProfileId;
  label: { uz: string; ru: string; en: string };
  hint: string;
  font: string;
  /** Tana shrifti (pt). */
  sizePt: number;
  /** Qator oralig'i (× — 1 yakka, 1.5). */
  line: number;
  marginsCm: { top: number; bottom: number; left: number; right: number };
  cite: CiteStyle;
  refsMin: number;
  refsMax: number;
  /** «Oxirgi N yil» manbalarning kamida `recentShare` ulushi. */
  recentYearsMin: number;
  recentShare: number;
  /** OAK: ikkinchi «REFERENCES» ro'yxati (translit/inglizcha). */
  secondEnglishList: boolean;
  udk: boolean;
  numberedSections: boolean;
  /** «1-rasm» (flat) yoki «1.1-rasm» (bob bo'yicha). */
  figureNumbering: "flat" | "chapter";
  tableSizePt: number;
  maxPages?: number;
  /** Annotatsiya so'z chegarasi. */
  abstractWords: [number, number];
  /** Kalit so'zlar soni. */
  keywords: [number, number];
};

/* ────────────────────────── hajm ────────────────────────── */

export const PAGES_IDS = ["1-2", "3-5", "5-10", "10-15"] as const;
export type PagesId = (typeof PAGES_IDS)[number];

/* ────────────────────────── manbalar ────────────────────────── */

export type ReferenceVerified = "openalex" | "crossref" | "user" | "unverified";

export type Reference = {
  /** `W2741809807` (OpenAlex) | `doi:10.…` | `u1` (foydalanuvchi). */
  id: string;
  doi?: string;
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  url?: string;
  publisher?: string;
  place?: string;
  /** Sahifalar «25–31» — GOST ro'yxati uchun. */
  pages?: string;
  verified: ReferenceVerified;
  /** Matnda kamida bir marta iqtibos qilinganmi — faqat shular ro'yxatga kiradi. */
  cited: boolean;
  /** Yakuniy tartib raqami (planArticle beradi). */
  n?: number;
  /** Foydalanuvchi bergan erkin matn (parse qilinmagan manba). */
  raw?: string;
};

/* ────────────────────────── sxemalar ────────────────────────── */

export type FigureNode = { id: string; label: string; kind?: "start" | "end" | "step" | "decision" | "data" };
export type FigureEdge = { from: string; to: string; label?: string };

export type FigureSpec =
  | { kind: "flow"; direction: "TB" | "LR"; nodes: FigureNode[]; edges: FigureEdge[] }
  | { kind: "process"; steps: string[] }
  | { kind: "tree"; root: string; children: TreeNode[] }
  | { kind: "prisma"; identified: number; screened: number; excludedScreen: number; eligible: number; excludedElig: number; included: number; sources?: string }
  | { kind: "chart"; chart: "bar" | "line" | "pie"; dataSource: "user"; series: { name: string; values: number[] }[]; categories: string[]; unit?: string };

export type TreeNode = { label: string; children?: TreeNode[] };

export type Figure = {
  id: string;
  kind: "scheme" | "chart";
  caption: string;
  spec: FigureSpec;
  /** PNG: `data:` (yaratishda) → aktiv URL (`extractAssets`). */
  url?: string;
  assetId?: string;
  /** Piksel o'lchami (300 dpi). */
  w: number;
  h: number;
  /** «Manba: muallif tomonidan tuzilgan» / «[5] asosida». */
  source?: string;
  /** Maket buzilsa (sikl, juda katta) — rasm o'rniga raqamlangan ro'yxat. */
  fallbackBlocks?: import("../types").Block[];
};

/* ────────────────────────── hisobot ────────────────────────── */

export type ReviewLevel = "green" | "yellow" | "red";

export type ReviewCheck = {
  id: string;
  level: ReviewLevel;
  label: string;
  detail?: string;
  /** «Tuzatish» tugmasi — server qayta yozadi (`ArticleOp rewrite`). */
  fix?: { op: "rewrite"; target: string; instruction: string };
};

export type ArticleReview = {
  /** 0–100. */
  score: number;
  checks: ReviewCheck[];
  judgeNotes: string[];
  verifiedShare: number;
  recentShare: number;
  builtAt: string;
};

/* ────────────────────────── model ────────────────────────── */

export type ArticleAuthor = { name: string; degree?: string; org?: string; email?: string; orcid?: string };

export type ArticleModel = {
  v: 1;
  type: ArticleTypeId;
  profile: PublicationProfileId;
  cite: CiteStyle;
  udk?: string;
  authors: ArticleAuthor[];
  /** Kalit so'zlar — uz/ru/en. */
  keywords: Partial<Record<"uz" | "ru" | "en", string[]>>;
  highlights?: string[];
  references: Reference[];
  figures: Figure[];
  review?: ArticleReview;
  /** «Natijalarim / tajriba» — foydalanuvchi faktlari (qo'riqchi uchun). */
  userFacts?: string;
  /** Maqola tili (annotatsiya baribir 3 tilda). */
  language: string;
};

export const ARTICLE_LIMITS = {
  authors: 6,
  userRefs: 40,
  keywords: 12,
  keywordsMin: 5,
  highlights: 5,
  highlightChars: 85,
  figures: 4,
  figureNodes: 14,
  figureEdges: 24,
  refs: 80,
  udkChars: 40,
  userFactsChars: 12_000,
} as const;
