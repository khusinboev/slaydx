/**
 * INSHO DVIGATELI (Talaba ishlari 2, AUDIT-19 WP-D) — umumiy kirish.
 *
 * Qatlamlar:
 *   types.ts     kontekst/tur id lari, `EssayModel` (= `AcademicDoc.essay`), chegaralar
 *   registry.ts  kontekst × tur: hajm, tuzilma, `guidance`, `JudgeSpec`
 *   rubric.ts    DTM 24 → 100 · akademik 100 · IELTS band — VAZNLAR BITTA JOYDA
 *   input.ts     forma ↔ `EssayInput` (`essayInputFromValues` / `encodeEssayValues`)
 *   prompts.ts   inglizcha tizim prompti, reja, insho, qayta yozish
 *   parse.ts     model javobi → bandlar
 *   engine.ts    `buildEssayDoc` — reja → matn → qo'riqchi → hisobot → sayqal
 *   review.ts    `reviewEssay` — 12 qoida + kontekst baholovchisi
 *   polish.ts    `runEssayPolish` — neytral yadro (`report/polish-core.ts`) o'rami
 *
 * Ulash (WP-E / lead): `write-llm.ts` `essay` shoxi → `buildEssayDoc`,
 * `tools.ts` formasi → `EssayComposer`, `edit-adapters.ts` → `essay`.
 */
export { ESSAY_CONTEXT_IDS, ESSAY_KIND_IDS, ESSAY_LIMITS, ESSAY_RUBRIC_IDS, essayKindsOf, isEssayContextId, isEssayKindId } from "./types";
export type { EssayContextId, EssayJudgeCriterion, EssayKindId, EssayModel, EssayParagraph, EssayParagraphRole, EssayRubricId, EssayWords } from "./types";

export {
  ESSAY_CONTEXTS,
  IELTS_LINKERS,
  essayBodyParagraphs,
  essayCitationPolicy,
  essayContextSpec,
  essayEdgeWords,
  essayEpigraphPolicy,
  essayKindSpec,
  essayLanguage,
  essayWords,
} from "./registry";
export type { EssayContextSpec, EssayJudgeSpec, EssayKindSpec, EssayLang, EssayPerson } from "./registry";

export { DTM_NOTE, ESSAY_RUBRICS, essayJudgeDetail, essayJudgeOf, essayRubric, essayScore, essayWeights, ieltsBand, ieltsBandScore, ieltsBands, judgeScoreOf, rubricPoints, ruleShareOf } from "./rubric";
export type { EssayJudge, EssayRubric } from "./rubric";

export { encodeEssayValues, essayContextOf, essayInputFromValues, essayKindOf, parseEpigraph } from "./input";
export type { EssayInput } from "./input";

export { ESSAY_FILLER, ESSAY_FILLER_EXTRA, ESSAY_SINGLE_CALL_WORDS, essayCtx, essayLengthLine, essayNeedsTwoParts, essayPrompt, essaySystemPrompt, outlinePrompt, rewritePrompt, wordRangePrompt } from "./prompts";
export type { EssayCtx, EssayParagraphPlan, EssayPart, EssayRewriteTarget } from "./prompts";

export { essayBlocksFromLlm } from "./parse";

export { buildEssayDoc, fallbackOutline, outlineFromLlm } from "./engine";
export type { EssayBuildOpts, EssayBuildResult, EssayCost, EssayStage } from "./engine";

export {
  ESSAY_RULE_IDS,
  ESSAY_TARGETS,
  LINKERS_MIN,
  REPETITION_JACCARD,
  essayJudgeChecks,
  essayJudgeSystemPrompt,
  essayModelOf,
  essaySection,
  essayTextOf,
  isClaimSentence,
  neutralEssayJudge,
  parseEssayJudge,
  reviewEssay,
  ruleChecks,
  sentencesOf,
  unsourcedStats,
} from "./review";
export type { EssayReviewOpts, EssayRuleId, EssayText } from "./review";

export { ESSAY_ACCEPT_DELTA, ESSAY_MAX_FIXES, ESSAY_POLISH_BELOW, ESSAY_POLISH_MIN_MS, applyEssayOps, essayUserNeeds, judgeFromReview, planEssayPolish, rewriteEssayFix, runEssayPolish } from "./polish";
export type { EssayOp, EssayPolishDeps, EssayPolishResult, EssayRewriteDeps } from "./polish";
