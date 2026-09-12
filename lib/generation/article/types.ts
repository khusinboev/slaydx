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

/** Baholovchi mezonlari — `review.ts` shu ro'yxatdan o'qiydi (tur moslamasi uchun shu yerda). */
export const JUDGE_CRITERIA = ["novelty", "chain", "methods", "comparison", "overclaim", "style"] as const;
export type JudgeCriterion = (typeof JUDGE_CRITERIA)[number];

/**
 * Turga bog'liq baholovchi moslamasi (AUDIT-18 Q-7): `skip` — bu turga
 * mos kelmaydigan mezonlar (tezisda «taqqoslash», sharhda «metodlar»
 * IMRAD ma'nosida) balldan chiqariladi; `describe` — mezonning shu tur
 * uchun ta'rifi (sharhda «methods» = qidiruv/tanlov shaffofligi).
 */
export type ArticleJudgeConfig = {
  skip?: JudgeCriterion[];
  describe?: Partial<Record<JudgeCriterion, string>>;
};

export type ArticleType = {
  id: ArticleTypeId;
  label: { uz: string; ru: string; en: string };
  /** Galereya kartasi uchun bir qatorli izoh (uz). */
  hint: string;
  /**
   * Turga xos YOZISH qoidalari (en, 2–4 qator) — tizim promptiga «TYPE
   * RULES» sifatida kiradi (AUDIT-18 Q-7: ilgari faqat «Article type: …»
   * deyilardi, sharh/metodik/tahliliy bir xil ovozda chiqardi).
   */
  guidance: string[];
  /** Turga bog'liq baholovchi mezonlari; berilmasa — standart 6 mezon. */
  judge?: ArticleJudgeConfig;
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
  /**
   * Adabiyotlar ro'yxati shrifti (pt) va intervali — OAK/universitet
   * jurnallari ro'yxatni tana matnidan kichik teradi (oriens.uz: TNR 12,
   * 1.15). Aks holda 12 manba × 2 ro'yxat 2,5 betni egallaydi (jonli smoke).
   */
  refsSizePt: number;
  refsLine: number;
  /**
   * Annotatsiya (×3) intervali — OAK/universitet jurnallari annotatsiyani
   * 12 pt yakka/1.15 teradi; 1.5 da uch tilli annotatsiya 1,6 bet oladi
   * (3–5 betlik smoke: 6 bet chiqdi). Shrift `size − 2` (rendererda).
   */
  abstractLine: number;
  maxPages?: number;
  /** Annotatsiya so'z chegarasi. */
  abstractWords: [number, number];
  /** Kalit so'zlar soni. */
  keywords: [number, number];
};

/* ────────────────────────── hajm ────────────────────────── */

export const PAGES_IDS = ["1-2", "3-5", "5-10", "10-15"] as const;
export type PagesId = (typeof PAGES_IDS)[number];

/**
 * Paketga sig'adigan sxema soni. Paket — hujjatning UMUMIY beti: 3–5 betlik
 * OAK maqolada uch annotatsiya + ikki adabiyot ro'yxati ≈ 2,5 bet, har sxema
 * ≈ 0,5 bet — ikkita sxema bilan 6 bet chiqdi (jonli smoke). Tezisda (1–2)
 * dvigatel baribir sxema chizmaydi. Forma ham, server (`parseArticleInput`)
 * ham shu jadvaldan kesadi.
 */
/**
 * So'z rejasi (`articleWordPlan`): `total` — butun hujjat, `body` — bo'limlar,
 * `abstracts` — uch annotatsiya jami, `abstractAim` — bitta annotatsiya
 * mo'ljali, `refs` — kutilayotgan manba soni, `figures` — sxema soni.
 */
export type ArticleWordPlan = { perPage: number; total: number; body: number; abstracts: number; abstractAim: number; refs: number; figures: number };

export const FIGURES_BY_PAGES: Record<PagesId, number> = { "1-2": 0, "3-5": 1, "5-10": 3, "10-15": 4 };
export const maxFiguresFor = (pages: PagesId): number => FIGURES_BY_PAGES[pages];

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

/**
 * Sxema turlari. Dastlabki 5 tasi — AUDIT-17 WP3; `layers`/`cycle`/
 * `timeline`/`matrix`/`compare` — AUDIT-18 WP-B (Q-5). `prisma` (dvigatel
 * statistikadan quradi) va `chart` (faqat foydalanuvchi ma'lumoti) formada
 * tanlanmaydi — `SELECTABLE_FIGURE_KINDS`.
 */
export type FigureKind = "flow" | "process" | "tree" | "prisma" | "chart" | "layers" | "cycle" | "timeline" | "matrix" | "compare";
export const FIGURE_KINDS: readonly FigureKind[] = ["flow", "process", "tree", "prisma", "chart", "layers", "cycle", "timeline", "matrix", "compare"];
/** Formadagi «Sxema turlari» tanlovi (`figureKinds`) — faqat model o'zi tuzadigan turlar. */
export const SELECTABLE_FIGURE_KINDS = ["flow", "process", "tree", "layers", "cycle", "timeline", "matrix", "compare"] as const;
export type SelectableFigureKind = (typeof SELECTABLE_FIGURE_KINDS)[number];
export const isSelectableFigureKind = (v: unknown): v is SelectableFigureKind => (SELECTABLE_FIGURE_KINDS as readonly string[]).includes(String(v));

export type FigureSpec =
  | { kind: "flow"; direction: "TB" | "LR"; nodes: FigureNode[]; edges: FigureEdge[] }
  | { kind: "process"; steps: string[] }
  | { kind: "tree"; root: string; children: TreeNode[] }
  | { kind: "prisma"; identified: number; screened: number; excludedScreen: number; eligible: number; excludedElig: number; included: number; sources?: string }
  | { kind: "chart"; chart: "bar" | "line" | "pie"; dataSource: "user"; series: { name: string; values: number[] }[]; categories: string[]; unit?: string }
  /** Qatlamli arxitektura: `layers[0]` — eng yuqori (ilova), oxirgisi — eng pastki (fizik); har qatlamda ≤4 band; `arrows` — qatlamlar orasida ikki tomonlama o'q (standart yoqiq). */
  | { kind: "layers"; layers: { label: string; items?: string[] }[]; direction?: "TB"; arrows?: boolean }
  /** Sikl: 3–8 bosqich aylana bo'ylab, yoy o'qlar; `center` — markazdagi yorliq; `clockwise` standart `true`. */
  | { kind: "cycle"; steps: { label: string }[]; center?: string; clockwise?: boolean }
  /** Vaqt chizig'i: 3–10 voqea, `when` chiziq ostida, `label` navbatma-navbat tepada/pastda. */
  | { kind: "timeline"; events: { when: string; label: string }[]; direction?: "LR" }
  /** 2×2 matritsa: AYNAN 4 kvadrant (yuqori-chap, yuqori-o'ng, pastki-chap, pastki-o'ng); o'qlar ixtiyoriy (SWOT — o'qsiz). */
  | { kind: "matrix"; xAxis?: FigureAxis; yAxis?: FigureAxis; quadrants: { title: string; items?: string[] }[] }
  /** Taqqoslash: ikki ustun (≤6 band); `rows` berilsa — mezon bo'yicha qatorlar (chapda mezon, ikki ustunda qiymat). */
  | { kind: "compare"; left: { title: string; items: string[] }; right: { title: string; items: string[] }; rows?: string[] };

export type FigureAxis = { low: string; high: string; label?: string };
export type TreeNode = { label: string; children?: TreeNode[] };

/** Yangi turlarning son chegaralari (`figureSpecFromLlm` kesadi, maket `null` beradi). */
export const FIGURE_LIMITS = {
  layersMin: 2,
  layersMax: 7,
  layerItems: 4,
  cycleMin: 3,
  cycleMax: 8,
  timelineMin: 3,
  timelineMax: 10,
  quadrants: 4,
  quadrantItems: 4,
  compareItems: 6,
  /** Formadagi «Sxema turlari» tanlovi — oq ro'yxat hajmi. */
  figureKinds: 9,
} as const;

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

/**
 * Avto-sayqal jurnali (Maqola 3, AUDIT-18 Q-1…Q-3) — `article/polish.ts`
 * `runPolish` yozadi. `accepted` — yangi ball eskisidan OSHGANDA (Q-3);
 * aks holda eski hujjat qoladi, `after` — rad etilgan urinish bali.
 * `skipped[].reason` — `POLISH_SKIP` kalitlari: `user` (foydalanuvchi
 * ma'lumoti kerak, Q-2), `manual`, `limit`, `budget`, `error`.
 */
export type PolishLog = {
  before: number;
  after: number;
  applied: { target: string; instruction: string }[];
  skipped: { id: string; reason: string }[];
  accepted: boolean;
  at: string;
};

/** «Sizdan kutiladi» bandi (Q-2): AI o'ylab topmaydigan ma'lumot. */
export type UserNeed = { id: "udk" | "authors" | "results"; label: string; hint: string };

export type ArticleReview = {
  /** 0–100. */
  score: number;
  checks: ReviewCheck[];
  judgeNotes: string[];
  verifiedShare: number;
  recentShare: number;
  builtAt: string;
  /** Avto-sayqal jurnali (dvigatel 8-bosqich yoki `POST …/polish`). */
  polish?: PolishLog;
  /** «Sizdan kutiladi» — `polish.ts userNeeds` (panel o'qiydi, hisoblamaydi). */
  userNeeds?: UserNeed[];
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
