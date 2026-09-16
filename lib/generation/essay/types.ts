/**
 * INSHO TIPLARI (Talaba ishlari 2, AUDIT-19 WP-D).
 *
 * Uch KONTEKST, uchta butunlay boshqa janr — shuning uchun bitta «insho
 * turi» ro'yxati emas, kontekst × tur (docs/AUDIT-19.md §1, qaror 3):
 *
 *   school_dtm   maktab bitiruv / DTM inshosi (uz). O'zbek maktab
 *                an'anasida «insho» — mulohazali, tavsiflovchi,
 *                umumlashtiruvchi, argumentli va adabiy tahlil turlari.
 *                Baho — DTM 24 ballik mezoni (`rubric.ts`).
 *   academic     OTM akademik esse (uz/ru/en, 500–1 000 so'z): thesis
 *                statement kirishning oxirida, har bandda topic sentence,
 *                rasmiy registr, hedging.
 *   ielts_task2  IELTS Writing Task 2 (en, ≥250 so'z): TR/CC/LR/GRA
 *                band 1–9 (har biri yakuniy ballning 25 % i).
 *
 * TOEFL inshosi ATAYLAB yo'q: 2026 dan imtihondan chiqarilgan (qaror 3).
 *
 * «Esse» ≠ «insho»: o'zbek maktab inshosi adabiy-badiiy matn, esse esa
 * argumentli akademik janr. Shuning uchun kontekst id lari ajratilgan va
 * yorliqlar («Maktab inshosi» / «Akademik esse») ham farqli.
 *
 * Matn QAYERDA: `AcademicDoc.sections` da BITTA bo'lim (`id: "essay"`) —
 * mavjud `writeEssayWithLlm` shakli bilan mos, render (`render-docx.ts`
 * `design` ramkasi) va ko'ruvchi (`WordViewer`) o'zgarmaydi. `EssayModel`
 * — metama'lumot (tur, hajm, thesis statement, hisobot), `AcademicDoc.essay`.
 */
import type { DocReview } from "../report/types";

/* ────────────────────────── kontekst va turlar ────────────────────────── */

export const ESSAY_CONTEXT_IDS = ["school_dtm", "academic", "ielts_task2"] as const;
export type EssayContextId = (typeof ESSAY_CONTEXT_IDS)[number];

/**
 * Har kontekstning turlari. Ro'yxat BITTA joyda: forma galereyasi,
 * prompt (`TYPE RULES`) va hisobot qoidalari shu yerdan o'qiydi.
 */
export const ESSAY_KIND_IDS = {
  school_dtm: ["reflective", "descriptive", "generalizing", "argumentative", "literary"],
  academic: ["argumentative", "expository", "compare_contrast", "problem_solution", "literary"],
  ielts_task2: ["opinion", "discussion", "problem_solution", "advantages_disadvantages", "double_question"],
} as const satisfies Record<EssayContextId, readonly string[]>;

export type EssayKindId = (typeof ESSAY_KIND_IDS)[EssayContextId][number];

/** Shu kontekstda ruxsat etilgan turlar. */
export function essayKindsOf(context: EssayContextId): readonly EssayKindId[] {
  return ESSAY_KIND_IDS[context];
}

export function isEssayContextId(v: unknown): v is EssayContextId {
  return typeof v === "string" && (ESSAY_CONTEXT_IDS as readonly string[]).includes(v);
}

export function isEssayKindId(context: EssayContextId, v: unknown): v is EssayKindId {
  return typeof v === "string" && (ESSAY_KIND_IDS[context] as readonly string[]).includes(v);
}

/* ────────────────────────── baholovchi mezonlari ────────────────────────── */

/** Maktab/DTM: mazmun · tuzilma · til boyligi · savodxonlik · ijodiylik. */
export const DTM_CRITERIA = ["content", "structure", "language", "literacy", "creativity"] as const;
/** OTM akademik esse: tezis · dalil · tuzilma · til · rasmiylashtirish. */
export const ACADEMIC_CRITERIA = ["thesis", "evidence", "structure", "language", "format"] as const;
/** IELTS Task 2: Task Response · Coherence&Cohesion · Lexical Resource · Grammar. */
export const IELTS_CRITERIA = ["tr", "cc", "lr", "gra"] as const;

export type DtmCriterion = (typeof DTM_CRITERIA)[number];
export type AcademicCriterion = (typeof ACADEMIC_CRITERIA)[number];
export type IeltsCriterion = (typeof IELTS_CRITERIA)[number];
export type EssayJudgeCriterion = DtmCriterion | AcademicCriterion | IeltsCriterion;

/* ────────────────────────── rubrika ────────────────────────── */

export const ESSAY_RUBRIC_IDS = ["dtm24", "academic100", "ielts_band"] as const;
export type EssayRubricId = (typeof ESSAY_RUBRIC_IDS)[number];

/* ────────────────────────── model ────────────────────────── */

export type EssayParagraphRole = "intro" | "body" | "conclusion";

/**
 * Paragraf REJASI (matn emas — matn `sections[0].blocks` da). Hisobot
 * `topicSentences` qoidasi va sayqal ko'rsatmalari shu rejadan o'qiydi.
 */
export type EssayParagraph = {
  id: string;
  role: EssayParagraphRole;
  /** Akademik esse: bandning birinchi jumlasi (da'vo). */
  topicSentence?: string;
};

export type EssayEpigraph = { text: string; author: string };

/** So'z byudjeti — `registry.ts essayWords` YAGONA manbasi. */
export type EssayWords = { min: number; max: number; aim: number };

export type EssayModel = {
  v: 1;
  context: EssayContextId;
  kind: EssayKindId;
  language: "uz" | "ru" | "en";
  words: EssayWords;
  /** Akademik/IELTS: kirishning oxirgi jumlasi — da'vo. */
  thesisStatement?: string;
  /** Adabiy insho: epigraf (matn + muallif). */
  epigraph?: EssayEpigraph;
  /** Adabiy insho/tahlil: asar nomi (iqtibos faqat shundan). */
  workTitle?: string;
  paragraphs: EssayParagraph[];
  /**
   * Bayon shaxsi — formadan (kontekst standartini bekor qiladi).
   * MODELDA saqlanadi: hisobot (`review.ts` `person` qoidasi) va sayqal
   * hujjatdan o'qiydi, forma qiymatlari o'sha paytda yo'q.
   */
  person?: "first" | "third";
  /** Hujjat ramkasi (`ESSAY_DESIGNS`) — render o'zgarmaydi. */
  design?: string;
  review?: DocReview;
  rubric: EssayRubricId;
  /** «O'z fikrlarim/dalillarim» — VERBATIM saqlanadigan foydalanuvchi matni. */
  userFacts?: string;
};

/**
 * Kirish chegaralari. Hajm chegaralari `registry.ts` da (kontekstga
 * bog'liq), bu yerda faqat MATN maydonlari.
 */
export const ESSAY_LIMITS = {
  topicChars: 300,
  extraChars: 1500,
  epigraphChars: 400,
  epigraphAuthorChars: 120,
  workTitleChars: 200,
  userFactsChars: 4000,
  /** Paragraf rejasi shundan uzun bo'lmaydi (kirish + tana + xulosa). */
  paragraphs: 12,
  topicSentenceChars: 300,
  thesisChars: 400,
  /** Varaq chiplari (`tools.ts` essay) — narx shu yerdan O'ZGARMAYDI. */
  pagesMin: 1,
  pagesMax: 5,
  /** Bir varaqda so'z (maktab konteksti; `quality.ts WORDS_PER_PAGE`). */
  wordsPerPage: 230,
  /** Akademik esse: «1 varaq ≈ 250 so'z» (`pages` → so'z o'girmasi). */
  academicWordsPerPage: 250,
} as const;
