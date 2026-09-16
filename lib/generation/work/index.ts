/**
 * TALABA ISHLARI 2 (AUDIT-19) — modul eksportlari.
 *
 * Dvigatel (`buildWorkDoc`) va kirish (`workInputFromValues`) shu
 * yerdan; render/ko'ruvchi tomonlar (`layout.ts planWork`, `edit.ts`
 * — WP-C) o'z fayllaridan import qilinadi.
 *
 * `write-llm.ts` ga TEGILMAYDI: eski `writeWriterWithLlm` yo'li lead
 * R bosqichida almashtiriladi, shu paytgacha ikkala yo'l yonma-yon
 * yashaydi.
 */
export { buildWorkDoc, fallbackWorkOutline, introPartsFromLlm, planWorkVisuals, tableFromLlm, taskList, workOutlineFromLlm, EMPTY_RESEARCH_STATS, WORK_ACCEPT_DELTA, WORK_POLISH_BELOW, WORK_POLISH_MAX_PAGES, WORK_POLISH_MIN_MS } from "./engine";
export type { WorkBuildOpts, WorkBuildResult, WorkCollectResult, WorkCost, WorkGuardSummary, WorkResearchAsk, WorkStage, WorkVisualPlan } from "./engine";

export { encodeWorkValues, maxVisualsFor, parseWorkFigureKinds, parseWorkJson, parseWorkOutline, parseWorkUserRefs, workInputFromValues, workKindFromValues, WORK_INPUT_LIMITS } from "./input";
export type { WorkInput, WorkOutlineItem } from "./input";

export {
  COURSEWORK_INTRO_PARTS,
  COURSEWORK_PAGES,
  INDEPENDENT_INTRO_PARTS,
  INDEPENDENT_PAGES,
  REFERAT_INTRO_PARTS,
  REFERAT_PAGES,
  WORK_GENRES,
  WORK_JUDGE_CRITERIA,
  WORK_JUDGE_LABELS,
  genreOf,
  normalizeWorkKind,
  normalizeWorkPages,
  pagesMid,
  pagesRange,
  workKindOf,
  workKindsOf,
} from "./registry";
export type { WorkGenre, WorkJudgeCriterion, WorkKind, WorkShape, WorkVisualNeed } from "./registry";

export { SUBJECT_PROFILES, SUBJECT_PROFILE_LIST, normalizeSubjectProfile } from "./subjects";
export type { SubjectProfile, SubjectResearch } from "./subjects";

export { workLabels, workLangKey } from "./labels";
export type { WorkDocLabels, WorkLang } from "./labels";

export { BODY_FLOOR, CONCLUSION_SHARE, WORK_OVERHEAD, WORK_WORDS_PER_PAGE, chapterWords, estimateWorkDocPages, estimateWorkPages, paragraphWords, workOverheadPages, workVisualNumbers, workWordPlan } from "./plan";
export type { WorkPlanAsk, WorkWordPlan } from "./plan";

export { BALANCE_TOLERANCE, chapterBalance, factNumbers, guardSection, intakeCheck, missingFactNumbers, numbersOf, wordsOf } from "./guard";
export type { ChapterBalance, ChapterStat, GuardOpts, IntakeReport, SectionGuardReport } from "./guard";

export { HONESTY_LIMIT, introPartsLine, workConclusionPrompt, workFigureHelp, workIntroPrompt, workOutlinePrompt, workParagraphPrompt, workResearchKeywords, workRewritePrompt, workSystemPrompt } from "./prompts";
export type { WorkContext, WorkOutlinePlan, WorkSectionAsk, WorkSectionPlan } from "./prompts";

export { JUDGE_TEXT_CHARS, LENGTH_TOLERANCE, REPETITION_JACCARD, WORK_RULE_IDS, neutralWorkJudge, parseWorkJudge, reviewWork, scoreWorkReview, setUzOrderFn, textSections, workJudgeChecks, workJudgeSpec, workJudgeSystemPrompt, workJudgeUserPrompt, workRuleChecks, workVisualCoverage } from "./review";
export type { WorkJudgeResult, WorkReviewOpts, WorkRuleId, WorkRuleResult } from "./review";

export { applyWorkPolish, applyWorkSectionOps, planWorkPolish, rewriteWorkFix, runWorkPolish, workContextOf, workCriterionFixes, workJudgeFromReview, workUserNeeds } from "./polish";
export type { WorkApplyPolishResult, WorkFix, WorkPolishDeps, WorkPolishResult, WorkRewriteDeps, WorkRewriteOut, WorkSectionOp } from "./polish";

export {
  WORK_GENRE_IDS,
  WORK_INTRO_PART_IDS,
  WORK_KIND_IDS,
  WORK_LIMITS,
  WORK_MINISTRY_IDS,
  WORK_REF_KINDS,
  SUBJECT_PROFILE_IDS,
  isChapterHeadId,
  isSubjectProfileId,
  isWorkGenreId,
  isWorkIntroPartId,
  isWorkKindId,
  isWorkMinistryId,
  parseWorkSectionId,
  workGenreOfTool,
} from "./types";
export type { SubjectProfileId, WorkChapter, WorkGenreId, WorkIntroPartId, WorkKindId, WorkMinistryId, WorkModel, WorkParagraph, WorkRefKind, WorkTitleFields } from "./types";
