/**
 * Maqola 2 (AUDIT-17) — modul eksportlari. Dvigatel (`engine.ts`) va
 * kirish (`input.ts`) shu yerdan; render/ko'ruvchi tomonlar (`layout.ts`,
 * `review.ts`, `edit.ts`) o'z fayllaridan import qilinadi (WP2/5/7).
 */
export { buildArticleDoc, articleWordPlan, articleWordsPerPage, planVisuals, outlineFromLlm, fallbackOutline, prismaSpec } from "./engine";
export type { ArticleBuildOpts, ArticleBuildResult, ArticleCost, ArticleGuardSummary, ArticleStage } from "./engine";
export { articleInputFromValues, encodeArticleValues, parseArticleJson, parseUserData, normalizeDoi, normalizeOrcid, ARTICLE_INPUT_LIMITS } from "./input";
export type { ArticleInput, ArticleUserRef, ArticleUserData } from "./input";
export { guardSection, skeletonCoverage, missingFactNumbers, factNumbers, numbersOf, wordsOf } from "./guard";
export type { GuardOpts, SectionGuardReport } from "./guard";
export { articleSystemPrompt, outlinePrompt, sectionPrompt, abstractPrompt, abstractSystemPrompt, highlightsPrompt, FILLER_PHRASES, formatRefLine } from "./prompts";
export type { ArticleContext, SectionPlan } from "./prompts";
