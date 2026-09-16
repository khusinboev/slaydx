/**
 * INSHO RUBRIKALARI VA BALL (AUDIT-19 WP-D) — VAZNLAR BITTA JOYDA.
 *
 * Uch kontekst — uch xil rasmiy o'lchov:
 *
 *   dtm24        DTM/maktab inshosi 24 ball: mazmun 8 · tuzilma 5 ·
 *                til boyligi 5 · savodxonlik 4 · ijodiylik 2.
 *                X-8: taqsimot TAXMINIY — rasmiy DTM hujjatida ballar
 *                mezonlar kesimida ochiq berilmagan, shuning uchun
 *                hisobot panelida izoh (`ESSAY_RUBRIC_NOTES`) chiqadi.
 *   academic100  OTM esse 100 ball: tezis 25 · dalil 25 · tuzilma 20 ·
 *                til 20 · rasmiylashtirish 10.
 *   ielts_band   IELTS Task 2: 4 mezon TENG, har biri 0–3 baholovchi
 *                ballidan band 1–9 ga o'giriladi: band = 4 + ball×(5/3)
 *                (0 → 4, 3 → 9), yakuniy ball = mean(band) × 100 / 9.
 *
 * Qoidalar (`review.ts`) va baholovchi ULUSHI ham shu yerda: maktab va
 * IELTS da RUBRIKA asosiy (baholovchi 0.6 / qoidalar 0.4), akademik esse
 * da maqoladagi neytral nisbat (qoidalar 0.6 / baholovchi 0.4) qoladi —
 * u yerda deterministik qoidalar (thesis statement, topic sentence,
 * hajm, klişe) janrning o'zini o'lchaydi.
 *
 * Ballga TEGADIGAN hech narsa bu fayldan tashqarida yo'q: hisobot
 * (`review.ts`), sayqal (`polish.ts`) va testlar `essayScore` ni chaqiradi.
 */
import { JUDGE_NEUTRAL } from "../report/judge";
import { LEVEL_SCORE } from "../report/score";
import type { JudgeResult, ReviewCheck } from "../report/types";
import { ESSAY_CONTEXTS } from "./registry";
import {
  ACADEMIC_CRITERIA,
  DTM_CRITERIA,
  IELTS_CRITERIA,
  type EssayContextId,
  type EssayJudgeCriterion,
  type EssayRubricId,
} from "./types";

/** Insho baholovchisining natijasi — neytral shakl, insho mezonlari ustida. */
export type EssayJudge = JudgeResult<EssayJudgeCriterion>;

export type EssayRubric = {
  id: EssayRubricId;
  criteria: readonly EssayJudgeCriterion[];
  /** Mezon ulushi (dtm24 — ball, academic100 — ball, ielts_band — teng 1). */
  weights: Partial<Record<EssayJudgeCriterion, number>>;
  /** Rubrikaning to'liq bali (IELTS da band shkalasi — `null`). */
  maxPoints: number | null;
  /** Qoidalar ulushi (0..1); baholovchi ulushi = 1 − ruleWeight. */
  ruleWeight: number;
  /** Hisobot paneliga qo'shiladigan izohlar. */
  notes: string[];
};

/** X-8 — DTM taqsimoti taxminiy ekanini foydalanuvchi ko'rishi SHART. */
export const DTM_NOTE =
  "DTM mezonlari bo‘yicha ball taqsimoti TAXMINIY (mazmun 8 · tuzilma 5 · til 5 · savodxonlik 4 · ijodiylik 2): rasmiy DTM hujjatida mezonlar kesimidagi aniq ballar berilmagan.";

export const ESSAY_RUBRICS: Record<EssayRubricId, EssayRubric> = {
  dtm24: {
    id: "dtm24",
    criteria: DTM_CRITERIA,
    weights: { content: 8, structure: 5, language: 5, literacy: 4, creativity: 2 },
    maxPoints: 24,
    ruleWeight: 0.4,
    notes: [DTM_NOTE],
  },
  academic100: {
    id: "academic100",
    criteria: ACADEMIC_CRITERIA,
    weights: { thesis: 25, evidence: 25, structure: 20, language: 20, format: 10 },
    maxPoints: 100,
    ruleWeight: 0.6,
    notes: [],
  },
  ielts_band: {
    id: "ielts_band",
    criteria: IELTS_CRITERIA,
    weights: { tr: 1, cc: 1, lr: 1, gra: 1 },
    maxPoints: null,
    ruleWeight: 0.4,
    notes: ["IELTS bandlari baholovchi bahosidan o‘girilgan taxmin (0→4, 3→9); rasmiy imtihon bali emas."],
  },
};

export function essayRubric(context: EssayContextId): EssayRubric {
  return ESSAY_RUBRICS[ESSAY_CONTEXTS[context].rubric];
}

/** Qoidalar / baholovchi ulushi (kontekstga qarab). */
export function essayWeights(context: EssayContextId): { rule: number; judge: number } {
  const rule = essayRubric(context).ruleWeight;
  return { rule, judge: 1 - rule };
}

/* ────────────────────────── IELTS band ────────────────────────── */

export const IELTS_BAND_MIN = 4;
export const IELTS_BAND_MAX = 9;

/**
 * Baholovchi bali 0–3 → IELTS band. Chiziqli: 0 → 4, 3 → 9 (qadam 5/3),
 * yaxlitlab. 4 dan past band berilmaydi — 0–3 shkalasi «umuman javob
 * bermadi» ni ham 4 ga tushiradi, bu ataylab: biz IMTIHON emasmiz,
 * baho ko'rsatma sifatida beriladi (X-8 bilan bir qaror).
 */
export function ieltsBand(score: number): number {
  const s = Math.max(0, Math.min(3, score));
  return Math.max(1, Math.min(IELTS_BAND_MAX, Math.round(IELTS_BAND_MIN + s * (5 / 3))));
}

/** Har mezon bo'yicha band (skip qilinganlari chiqariladi). */
export function ieltsBands(judge: EssayJudge): Partial<Record<EssayJudgeCriterion, number>> {
  const skip = new Set<string>(judge.skipped ?? []);
  const out: Partial<Record<EssayJudgeCriterion, number>> = {};
  for (const c of IELTS_CRITERIA) if (!skip.has(c)) out[c] = ieltsBand(judge[c] ?? JUDGE_NEUTRAL);
  return out;
}

/** `round(mean(band) × 100 / 9)` — baholovchi tomonining 0–100 bali. */
export function ieltsBandScore(judge: EssayJudge): number {
  const bands = Object.values(ieltsBands(judge));
  if (!bands.length) return 100;
  const mean = bands.reduce((a, b) => a + b, 0) / bands.length;
  return Math.round((mean * 100) / IELTS_BAND_MAX);
}

/* ────────────────────────── ball ────────────────────────── */

/**
 * Baholovchi tomonining 0–100 bali. Rubrikaga qarab:
 *   dtm24/academic100 — Σ (ball/3 × vazn) / Σ vazn (skip qilingan mezon
 *                        MAXRAJDAN ham chiqadi — adolatsiz past ball yo'q);
 *   ielts_band        — `ieltsBandScore`.
 */
export function judgeScoreOf(rubric: EssayRubric, judge: EssayJudge): number {
  if (rubric.id === "ielts_band") return ieltsBandScore(judge);
  const skip = new Set<string>(judge.skipped ?? []);
  let points = 0;
  let total = 0;
  for (const c of rubric.criteria) {
    if (skip.has(c)) continue;
    const w = rubric.weights[c] ?? 0;
    total += w;
    points += (Math.max(0, Math.min(3, judge[c] ?? JUDGE_NEUTRAL)) / 3) * w;
  }
  return total ? Math.round((points / total) * 100) : 100;
}

/** Rubrika BALLARIDA (DTM 24 dan, akademik 100 dan) — panel detali uchun. */
export function rubricPoints(rubric: EssayRubric, judge: EssayJudge): number | null {
  if (rubric.maxPoints === null) return null;
  return Math.round((judgeScoreOf(rubric, judge) * rubric.maxPoints) / 100);
}

/** Qoidalar tomonining ulushi (yashil 1 / sariq 0.5 / qizil 0). */
export function ruleShareOf(rules: ReviewCheck[]): number {
  if (!rules.length) return 1;
  return rules.reduce((n, c) => n + LEVEL_SCORE[c.level], 0) / rules.length;
}

/**
 * Yakuniy 0–100 ball: kontekst ulushlari bilan qoidalar + baholovchi.
 * `scoreReviewFor` (maqola) o'rniga shu — insho bali RUBRIKA bo'yicha
 * vaznlangan, teng emas.
 */
export function essayScore(rules: ReviewCheck[], judge: EssayJudge, context: EssayContextId): number {
  const rubric = essayRubric(context);
  const w = essayWeights(context);
  const score = w.rule * ruleShareOf(rules) * 100 + w.judge * judgeScoreOf(rubric, judge);
  return Math.max(0, Math.min(100, Math.round(score)));
}

/* ────────────────────────── band detali ────────────────────────── */

/**
 * `ReviewCheck.detail` matni: IELTS da «Band 7 · 2/3» (band ko'rinadi,
 * xom ball esa `judgeFromReview` uchun o'qiladigan qoladi), boshqa
 * kontekstlarda «2/3».
 */
export function essayJudgeDetail(context: EssayContextId, criterion: EssayJudgeCriterion, value: number): string {
  const v = Math.max(0, Math.min(3, value));
  if (essayRubric(context).id !== "ielts_band") return `${v}/3`;
  return `Band ${ieltsBand(v)} · ${v}/3`;
}

/* ────────────────────────── qurish ────────────────────────── */

/**
 * Qisman ballardan to'liq `EssayJudge`. Kontekst mezonlariga kirmagan
 * kalitlar ham neytral bilan to'ldiriladi (neytral qatlam `JudgeResult<C>`
 * ni to'liq `Record` deb ko'radi; ball faqat rubrika mezonlaridan).
 */
export function essayJudgeOf(context: EssayContextId, scores: Partial<Record<EssayJudgeCriterion, number>> = {}, o: Partial<Pick<EssayJudge, "notes" | "fixes">> = {}): EssayJudge {
  const all = [...DTM_CRITERIA, ...ACADEMIC_CRITERIA, ...IELTS_CRITERIA] as EssayJudgeCriterion[];
  const base = Object.fromEntries(all.map((c) => [c, JUDGE_NEUTRAL])) as Record<EssayJudgeCriterion, number>;
  for (const c of essayRubric(context).criteria) if (scores[c] !== undefined) base[c] = Math.max(0, Math.min(3, Math.round(scores[c]!)));
  return { ...base, notes: o.notes ?? [], fixes: o.fixes ?? [] };
}
