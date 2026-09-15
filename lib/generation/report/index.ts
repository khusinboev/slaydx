/**
 * NEYTRAL HISOBOT/SAYQAL QATLAMI (AUDIT-19 R0-A) — maqola (`article/`),
 * kurs ishi (`work/`) va insho (`essay/`) dvigatellari shu yerdan
 * foydalanadi. Izomorf: DOM/server/LLM importi YO'Q (LLM chaqiruvi
 * dependensiya sifatida tashqaridan keladi).
 *
 * Qatlamlar:
 *   types.ts        DocReview, ReviewCheck, PolishLog, UserNeed, JudgeResult<C>, JudgeSpec<C>
 *   score.ts        ball formulasi, 3-gram takror, vizual havolalar
 *   judge.ts        baholovchi prompti/tahlili (mezonlar spetsifikatsiyadan)
 *   text.ts         sampleForJudge — proporsional kesish, kirish/xulosa to'liq
 *   guard.ts        guardSection — iqtibos/raqam/«suv» tekshiruvi
 *   filler.ts       FILLER_PHRASES
 *   polish-core.ts  applyPolishWith / runPolishWith — avto-sayqal (Q-2, Q-3)
 */
export type { DocReview, JudgeResult, JudgeSpec, PolishLog, ReviewCheck, ReviewGuardInput, ReviewLevel, UserNeed } from "./types";

export { JUDGE_WEIGHT, LEVEL_SCORE, RULE_WEIGHT, check, jaccard, langKey, rewrite, scoreReviewFor, sectionText, textBlocks, trigrams, visualCoverageOf } from "./score";
export type { UnreferencedVisual, VisualCoverage, VisualFigureRef, VisualLabels, VisualNumbers } from "./score";

export { JUDGE_MIN_MS, JUDGE_NEUTRAL, JUDGE_NO_ANSWER, JUDGE_TIMEOUT_MS, clampScore, judgeChecksFor, judgeCriteriaOf, judgeSystemPromptFor, neutralJudgeFor, parseJudgeFor } from "./judge";

export { MIN_CHARS, sampleForJudge } from "./text";
export type { SampleGroup, SampledGroup } from "./text";

export { factNumbers, guardSection, missingFactNumbers, numbersOf, wordsOf } from "./guard";
export type { GuardOpts, SectionGuardReport } from "./guard";

export { FILLER_PHRASES } from "./filler";

export {
  ADD_RE,
  HONESTY_LIMIT,
  POLISH_JUDGE_NOTE,
  POLISH_JUDGE_RESERVE_MS,
  POLISH_MAX_FIXES,
  POLISH_MIN_FIX_MS,
  POLISH_SKIP,
  REWRITE_REVIEW_NOTE,
  REWRITE_TIMEOUT_MS,
  RewriteError,
  STRONG_RE,
  WEAK_RE,
  applyPolishWith,
  isVisualBlock,
  keepVisuals,
  needsUserData,
  runPolishWith,
} from "./polish-core";
export type { ApplyOpsResult, ApplyPolishDeps, ApplyPolishResultOf, Fix, PolishPlan, PolishSkip, RewriteOutOf, RunPolishDeps, RunPolishResult } from "./polish-core";
