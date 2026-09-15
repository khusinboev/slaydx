/**
 * AVTO-SAYQAL (Maqola 3, AUDIT-18 WP-A) — SOF, IZOMORF: sharp/DB/LLM
 * importi yo'q, `complete` tashqaridan keladi (dvigatel `engine.ts`
 * 8-bosqichda, server `article-polish.ts` «Hammasini tuzatish»da).
 *
 *   planPolish(review, doc)   → hisobotdagi TUZATILADIGAN bandlar → ≤6 fix
 *   applyPolish(doc, fixes)   → har fix `writer` bilan (mapPool 3) → op lar
 *   runPolish(doc, review)    → plan → apply → applyArticleOps → reviewArticle
 *                               (judge) → ball OSHSA qabul (Q-3), aks holda
 *                               eski hujjat; `review.polish` jurnali
 *   userNeeds(review, doc)    → «Sizdan kutiladi» (UDK, email/ORCID, natijalar)
 *
 * Qarorlar (docs/AUDIT-18.md §1):
 *   • Q-2 HALOLLIK CHEGARASI — `userFacts` bo'sh bo'lsa natija/tajriba/
 *     dastgoh/aniqlik talab qiladigan baholovchi tavsiyalari BAJARILMAYDI
 *     (`needsUserData`, inglizcha+o'zbekcha+ruscha lug'at) — `skipped`
 *     ga `reason: "user"` bilan; `udk`/`authors` doim `user`.
 *   • Q-3 — sayqal natijasi faqat ball OSHSA qabul qilinadi.
 *   • Bitta bo'limga bir nechta ko'rsatma → BITTA fix (birlashtiriladi):
 *     bo'lim ikki marta parallel qayta yozilmasin.
 *
 * «Tuzatish» (bitta fix, WP7) ning sof qismi — `rewriteFix` — ham SHU
 * yerda: `lib/server/article-rewrite.ts` uni import qiladi (ikkita nusxa
 * yo'q). Xatolar `RewriteError` (status/code) — server `ApiError` ga
 * o'giradi.
 */
import type { AcademicDoc, DocSection } from "../types";
import type { ArticleReview, ReviewCheck, UserNeed } from "./types";
import { ARTICLE_TYPES } from "./types-registry";
import { PUBLICATION_PROFILES } from "./profiles";
import { articleLabels } from "./labels";
import { normalizeArticlePages, type ArticleInput } from "./input";
import { articleWordPlan } from "./plan";
import { abstractFromLlm, blocksFromLlm, clipWords } from "./parse";
import { abstractPrompt, abstractSystemPrompt, articleSystemPrompt, highlightsPrompt, sectionPrompt, type ArticleContext, type SectionPlan } from "./prompts";
import { guardSection, wordsOf } from "./guard";
import { verifyCitations, type Unresolved } from "../research/verify";
import { applyArticleOps, langKeyOf, type ArticleLang, type ArticleOp } from "./edit";
import {
  JUDGE_CRITERIA,
  JUDGE_NO_ANSWER,
  judgeChecks,
  neutralJudge,
  reviewArticle,
  scoreReview,
  visualCoverage,
  type CompleteFn,
  type JudgeResult,
  type ReviewGuardInput,
} from "./review";
import type { ResearchStats } from "../research/pipeline";
import type { LlmUsage } from "../llm-roles";
import { parseLlmObject } from "../json";
import { cleanText, remainingMs } from "../quality";
/*
 * SAYQAL YADROSI NEYTRAL (AUDIT-19 R0-A) — `lib/generation/report/
 * polish-core.ts`: Q-2 (`needsUserData`, `HONESTY_LIMIT`), Q-3 qabul
 * chegarasi, parallel qo'llash va jurnal kurs ishi/insho bilan umumiy.
 * Bu fayl MAQOLAGA XOS qismni saqlaydi — reja (`planPolish`), qayta
 * yozish promptlari (`rewriteFix`) va o'zgarmagan imzolar (X-7).
 */
import {
  HONESTY_LIMIT,
  POLISH_JUDGE_NOTE,
  POLISH_JUDGE_RESERVE_MS,
  POLISH_MAX_FIXES,
  POLISH_SKIP,
  REWRITE_REVIEW_NOTE,
  REWRITE_TIMEOUT_MS,
  RewriteError,
  applyPolishWith,
  isVisualBlock,
  keepVisuals,
  needsUserData,
  runPolishWith,
  type ApplyPolishResultOf,
  type Fix,
  type PolishPlan,
  type PolishSkip,
  type RunPolishResult,
} from "../report/polish-core";

/* ────────────────────────── tiplar va konstantalar ────────────────────────── */

export type ArticleFix = Fix;

export { HONESTY_LIMIT, POLISH_JUDGE_NOTE, POLISH_JUDGE_RESERVE_MS, POLISH_MAX_FIXES, POLISH_SKIP, REWRITE_REVIEW_NOTE, REWRITE_TIMEOUT_MS, RewriteError, keepVisuals, needsUserData };
export type { PolishPlan, PolishSkip };

/** Bo'lim so'zi rejadagi ulushidan shu nisbatdan kam bo'lsa «kengaytir». */
const SHORT_BELOW = 0.75;
/** Butun tana maqsaddan shu nisbatdan ko'p bo'lsa eng uzun bo'lim «qisqartir». */
const LONG_ABOVE = 1.2;

const RETRY_MSG = "Model javob bermadi — qayta urinib ko‘ring";

export type RewriteDeps = {
  complete: CompleteFn;
  /** `Date.now()` ms — chaqiruvga qolgan vaqt shundan hisoblanadi. */
  deadline?: number;
};

export type RewriteOut = { ops: ArticleOp[]; unresolved: Unresolved[]; unsourcedNumbers: string[] };

/* ────────────────────────── reja ────────────────────────── */

/** Skelet id → bo'lim (erkin `body-N` ham `body` ga mos). */
const skeletonIdOf = (id: string) => id.replace(/-\d+$/, "");

/** Har bo'limning so'z mo'ljali — skelet ulushi (erkin bo'limlar teng). */
function sectionTargets(doc: AcademicDoc, wordTarget: number): Map<string, number> {
  const type = ARTICLE_TYPES[doc.article?.type ?? "imrad_oak"];
  const share = new Map(type.skeleton.map((s) => [s.id, s.sharePct]));
  const sections = doc.sections.filter((s) => s.blocks.length);
  const counts = new Map<string, number>();
  for (const s of sections) counts.set(skeletonIdOf(s.id), (counts.get(skeletonIdOf(s.id)) ?? 0) + 1);
  const out = new Map<string, number>();
  for (const s of sections) {
    const sk = skeletonIdOf(s.id);
    const pct = share.get(sk) ?? 100 / Math.max(1, sections.length);
    out.set(s.id, Math.max(60, Math.round((wordTarget * pct) / 100 / (counts.get(sk) ?? 1))));
  }
  return out;
}

const rewrite = (target: string, instruction: string): ArticleFix => ({ op: "rewrite", target, instruction });

/**
 * Hisobot → fix rejasi. Qoidalar: bandning o'z `fix` i (abstracts, keywords,
 * highlights, filler, repetition, limitations, unsourcedNumbers, userFacts)
 * + sintez qilinadiganlar: `length` (qisqa bo'limlarni kengaytirish /
 * uzunini qisqartirish), `visuals` (`[fig:id]`/`[tab:id]` havolasi).
 * Baholovchi tavsiyalari (`judge:fix:N`) — Q-2 filtr bilan. `udk`/`authors`
 * doim `user`. Bitta nishonga ko'rsatmalar birlashtiriladi; ≤6 nishon.
 */
/** Skelet roli bo'yicha bo'lim topish (id yoki `skeletonId` prefiksi). */
function sectionByRole(doc: AcademicDoc, roles: string[]): string | null {
  const sections = doc.sections.filter((s) => s.blocks.length);
  for (const role of roles) {
    const hit = sections.find((s) => s.id === role || s.id.startsWith(`${role}-`) || s.id.includes(role));
    if (hit) return hit.id;
  }
  return null;
}

/**
 * Past baholangan mezon → halol ko'rsatma (mavjud matn va manbalar bilan
 * bajariladigan; tajriba tafsiloti so'ralmaydi). `methods` faqat faktlar
 * bo'lsa — «faqat USER FACTS bilan, yo'g'ini keltirilmagan deb ayt».
 */
export function criterionFixes(review: ArticleReview, doc: AcademicDoc, hasFacts: boolean): ArticleFix[] {
  const level = (id: string) => review.checks.find((c) => c.id === `judge:${id}`)?.level;
  const low = (id: string) => level(id) === "red" || level(id) === "yellow";
  const first = doc.sections.find((s) => s.blocks.length)?.id ?? null;
  const last = [...doc.sections].reverse().find((s) => s.blocks.length)?.id ?? null;
  const intro = sectionByRole(doc, ["intro", "introduction"]) ?? first;
  const conclusion = sectionByRole(doc, ["conclusion", "conclusions", "future"]) ?? last;
  const discussion = sectionByRole(doc, ["discussion", "synthesis", "analysis", "solutions", "evaluation", "perspective"]) ?? conclusion;
  const methods = sectionByRole(doc, ["litreview_methods", "methods", "results_methods", "procedure", "protocol", "object", "search"]);
  const out: ArticleFix[] = [];
  const push = (target: string | null, instruction: string) => {
    if (target && !out.some((f) => f.target === target)) out.push({ op: "rewrite", target, instruction });
  };
  if (low("novelty")) push(intro, "State the specific contribution of this article explicitly (what it adds beyond the cited studies) using ONLY what the manuscript already does; end the introduction with a clear aim. Do not add new results.");
  if (low("overclaim") || low("chain")) push(conclusion, "Make the conclusion answer the stated aim point by point and keep every claim within what the results/USER FACTS show — remove generalisations that the results do not support.");
  if (low("comparison")) push(discussion, "Compare the findings explicitly with at least three cited SOURCES (agreement, contrast, gap) — use only sources already in the list; no new claims.");
  if (low("methods") && hasFacts) push(methods, "Describe the procedure using ONLY the details in USER FACTS and the current text; where a detail (tool, statistical test, parameter) was not reported by the author, say so explicitly instead of inventing it.");
  return out;
}

export function planPolish(review: ArticleReview, doc: AcademicDoc): PolishPlan {
  const skipped: PolishSkip[] = [];
  const candidates: ArticleFix[] = [];
  const model = doc.article;
  if (!model) return { fixes: [], skipped: [{ id: "legacy", reason: "manual" }] };
  const hasFacts = Boolean(model.userFacts?.trim());
  const sections = doc.sections.filter((s) => s.blocks.length);
  const byId = new Map(sections.map((s) => [s.id, s]));
  const type = ARTICLE_TYPES[model.type] ?? ARTICLE_TYPES.imrad_oak;
  const profile = PUBLICATION_PROFILES[model.profile] ?? PUBLICATION_PROFILES[type.defaultProfile];

  const rules = review.checks.filter((c) => !c.id.startsWith("judge:") && c.level !== "green");
  // Qizil avval — 60 % ulushda har qizil band butun yashilcha yo'qotadi.
  rules.sort((a, b) => (a.level === "red" ? 0 : 1) - (b.level === "red" ? 0 : 1));

  for (const c of rules) {
    if (c.id === "udk" || c.id === "authors") {
      skipped.push({ id: c.id, reason: "user" });
      continue;
    }
    if (c.id === "length" && !type.wordRange) {
      const wordTarget = articleWordPlan(doc.meta, type, profile).body;
      const targets = sectionTargets(doc, wordTarget);
      const body = sections.reduce((n, s) => n + wordsOf(s.blocks), 0);
      if (body < wordTarget) {
        const short = sections
          .map((s) => ({ s, have: wordsOf(s.blocks), want: targets.get(s.id) ?? 0 }))
          .filter((x) => x.have < x.want * SHORT_BELOW)
          .sort((a, b) => b.want - b.have - (a.want - a.have))
          .slice(0, 2);
        for (const x of short) {
          candidates.push(
            rewrite(
              x.s.id,
              `Expand this section to about ${x.want} words (it has ${x.have}): add about ${x.want - x.have} words of NEW specific content (a mechanism, a comparison with a cited source, an implication, a limitation) — keep every existing sentence, citation ID and user fact; no new numbers without a cited source.`,
            ),
          );
        }
        if (!short.length) skipped.push({ id: c.id, reason: "manual" });
      } else if (body > wordTarget * LONG_ABOVE) {
        const long = sections.map((s) => ({ s, have: wordsOf(s.blocks), want: targets.get(s.id) ?? 0 })).sort((a, b) => b.have - b.want - (a.have - a.want))[0];
        if (long) candidates.push(rewrite(long.s.id, `Condense this section to about ${long.want} words (it has ${long.have}): remove repetition and generic sentences, keep every citation ID, user fact and specific claim.`));
      } else skipped.push({ id: c.id, reason: "manual" });
      continue;
    }
    if (c.id === "visuals") {
      const { unreferenced } = visualCoverage(doc);
      if (!unreferenced.length) {
        skipped.push({ id: c.id, reason: "manual" });
        continue;
      }
      const bySection = new Map<string, string[]>();
      for (const u of unreferenced) {
        const tok = u.kind === "figure" ? `[fig:${u.id}]` : `[tab:${u.id}]`;
        bySection.set(u.sectionId, [...(bySection.get(u.sectionId) ?? []), `${u.label} — write the token ${tok}`]);
      }
      for (const [sectionId, items] of bySection) {
        candidates.push(
          rewrite(
            sectionId,
            `Refer to the visual(s) in this section's text: ${items.join("; ")} — put each token inside a sentence that introduces the visual (e.g. "… ko‘rsatilgan ([fig:f1])"); keep the visual block and all other content unchanged.`,
          ),
        );
      }
      continue;
    }
    if (!c.fix) {
      skipped.push({ id: c.id, reason: "manual" });
      continue;
    }
    candidates.push({ op: "rewrite", target: c.fix.target, instruction: c.fix.instruction });
  }

  /*
   * Baholovchi tavsiyalari — Q-2 filtr, FAKTLAR BOR BO'LSA HAM: jonli
   * sinovda (article-oak, faktlar bilan) «statistik testlar, p-qiymatlar,
   * platforma nomini ko'rsating» tavsiyasi bajarilib, model Moodle, t-test,
   * ANOVA, stratified randomization ni O'YLAB TOPDI (faktlarda yo'q) va
   * baholovchi buni 78 → 92 deb mukofotladi. Fakt bo'lsa ham u allaqachon
   * matnda — qo'shimcha tajriba tafsiloti so'rash = yo'q ma'lumotni so'rash.
   */
  for (const c of review.checks) {
    if (!c.id.startsWith("judge:fix:") || !c.fix) continue;
    if (needsUserData(c.fix.instruction)) {
      skipped.push({ id: c.id, reason: hasFacts ? "unreported" : "user" });
      continue;
    }
    candidates.push({ op: "rewrite", target: c.fix.target, instruction: c.fix.instruction });
  }

  /*
   * Baholovchi MEZONLARIDAN halol tuzatishlar (baholovchi `fixes` bermasa
   * yoki hammasi Q-2 bilan tushib qolsa): jonli sinovda tavsiya chegarasi
   * qo'yilgach Claude 0 fix qaytardi — sayqal faqat jadval havolasini
   * tuzatib, yangilik/xulosa/taqqoslash qizil qoldi. Har mezon o'z
   * bo'limiga, faqat mavjud mazmun/manbalar bilan bajariladigan ko'rsatma.
   */
  const judgeTargets = new Set(candidates.map((f) => f.target));
  for (const f of criterionFixes(review, doc, hasFacts)) {
    if (judgeTargets.has(f.target)) continue;
    candidates.push(f);
  }

  // Nishon mavjudligi: bo'lim id | abstract:xx | keywords | highlights.
  const valid = (t: string) => byId.has(t) || /^abstract:[a-z]{2}$/i.test(t) || t === "keywords" || t === "highlights";
  // Bitta nishon → bitta fix (ko'rsatmalar birlashadi), tartib — birinchi uchrash.
  const merged = new Map<string, string[]>();
  for (const f of candidates) {
    if (!valid(f.target)) continue;
    const list = merged.get(f.target) ?? [];
    if (!list.includes(f.instruction)) list.push(f.instruction);
    merged.set(f.target, list);
  }
  const fixes: ArticleFix[] = [];
  for (const [target, list] of merged) {
    if (fixes.length >= POLISH_MAX_FIXES) {
      skipped.push({ id: target, reason: "limit" });
      continue;
    }
    fixes.push(rewrite(target, list.length === 1 ? list[0] : list.map((s, i) => `(${i + 1}) ${s}`).join(" ")));
  }
  return { fixes, skipped };
}

/* ────────────────────────── «Sizdan kutiladi» ────────────────────────── */

/**
 * AI o'ylab topmaydigan narsalar (Q-2): UDK (profil talab qilsa), email/
 * ORCID, va — `userFacts` bo'sh bo'lganda — metodlar/taqqoslash mezoni
 * qizil yoki natija talab qiladigan baholovchi tavsiyasi bo'lsa «Natijalarim».
 */
export function userNeeds(review: ArticleReview, doc: AcademicDoc): UserNeed[] {
  const out: UserNeed[] = [];
  const find = (id: string) => review.checks.find((c) => c.id === id);
  const udk = find("udk");
  if (udk && udk.level !== "green") out.push({ id: "udk", label: "UDK", hint: "Formadagi «Taklif» tugmasi bilan oling yoki jurnal talabiga ko‘ra kiriting" });
  const authors = find("authors");
  if (authors && authors.level !== "green") out.push({ id: "authors", label: "Mualliflar", hint: authors.detail ?? "Email va ORCID ni to‘ldiring" });
  if (!doc.article?.userFacts?.trim()) {
    const red = (id: string) => find(`judge:${id}`)?.level === "red";
    const dataFix = review.checks.some((c) => c.id.startsWith("judge:fix:") && c.fix && needsUserData(c.fix.instruction));
    if (red("methods") || red("comparison") || dataFix) {
      out.push({ id: "results", label: "Natijalarim", hint: "Tajriba/kuzatuv natijalaringizni (raqamlar, tanlanma, uskuna, sharoit) formadagi «Natijalarim» maydoniga kiriting — AI ularni o‘ylab topmaydi" });
    }
  }
  return out;
}

/* ────────────────────────── kontekst (rewrite) ────────────────────────── */

/**
 * Dvigatel konteksti HUJJATDAN — forma qiymatlari (`FormValues`) endi yo'q,
 * lekin promptlarga kerak bo'lgan hamma narsa `meta` va `doc.article` da.
 */
function contextOf(doc: AcademicDoc): ArticleContext {
  const model = doc.article!;
  const type = ARTICLE_TYPES[model.type] ?? ARTICLE_TYPES.imrad_oak;
  const profile = PUBLICATION_PROFILES[model.profile] ?? PUBLICATION_PROFILES[type.defaultProfile];
  const language = langKeyOf(model.language || doc.meta.language);
  const input: ArticleInput = {
    topic: doc.meta.topic,
    articleType: type.id,
    pubProfile: profile.id,
    citeStyle: model.cite,
    language,
    pages: normalizeArticlePages(type, doc.meta.pagesLabel),
    authors: model.authors,
    udk: model.udk ?? "",
    keywords: model.keywords[language] ?? [],
    userFacts: model.userFacts ?? "",
    userRefs: [],
    figureCount: doc.meta.figureCount ?? 0,
    figureKinds: doc.meta.figureKinds ?? [],
    research: Boolean(doc.meta.research),
    extra: doc.meta.extra ?? "",
    sourceText: doc.meta.sourceText ?? "",
  };
  const plan = articleWordPlan(doc.meta, type, profile);
  return { input, meta: doc.meta, type, profile, labels: articleLabels(language), wordTarget: plan.body, plan, refs: model.references };
}

/** Bo'lim qisqacha — annotatsiya/highlights uchun (dvigatel `summaryOf` bilan bir xil shakl). */
function summaries(doc: AcademicDoc): string {
  return doc.sections
    .filter((s) => s.blocks.length)
    .map((s) => {
      const text = s.blocks
        .filter((b) => b.kind === "p" || b.kind === "li")
        .map((b) => b.text)
        .join(" ");
      return `• ${s.title}: ${text.slice(0, 380)}${text.length > 380 ? "…" : ""}`;
    })
    .join("\n");
}

/* ────────────────────────── LLM chaqiruvi ────────────────────────── */

/** Bitta chaqiruv — vaqt tugasa yoki javob bo'sh bo'lsa 422 (hujjat o'zgarmaydi). */
async function ask(deps: RewriteDeps, role: "writer", system: string, user: string, maxTokens: number): Promise<string> {
  const timeoutMs = Math.max(1, Math.min(REWRITE_TIMEOUT_MS, remainingMs(deps.deadline)));
  let timer: ReturnType<typeof setTimeout> | null = null;
  const bomb = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    const r = await Promise.race([deps.complete(role, system, user, { json: true, maxTokens, timeoutMs }).catch(() => null), bomb]);
    if (!r?.text) throw new RewriteError(RETRY_MSG, 422, "llm");
    return r.text;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/* ────────────────────────── nishonlar ────────────────────────── */

async function rewriteSection(doc: AcademicDoc, section: DocSection, fix: ArticleFix, deps: RewriteDeps): Promise<RewriteOut> {
  const ctx = contextOf(doc);
  const model = doc.article!;
  const words = Math.max(120, wordsOf(section.blocks));
  const skel = ctx.type.skeleton.find((s) => section.id === s.id || section.id.startsWith(`${s.id}-`));
  const plan: SectionPlan = {
    id: section.id,
    skeletonId: skel?.id ?? section.id,
    title: section.title,
    brief: `Rewrite the existing section according to the editor's instruction: ${fix.instruction}`,
    words,
    hard: Boolean(skel?.hard),
  };
  const existing = section.blocks
    .filter((b) => !isVisualBlock(b.kind))
    .map((b) => b.text)
    .join("\n\n")
    .slice(0, 12_000);
  const user = [
    sectionPrompt(ctx, { plan, wantTable: false, wantFigure: false, wantChart: false }),
    `CURRENT TEXT of the section — rewrite it: keep its scope and every USER FACT verbatim, keep the citation IDs that still support a sentence, do not add new claims without a SOURCE:`,
    existing || "(empty)",
    `EDITOR INSTRUCTION (highest priority): ${fix.instruction}`,
    HONESTY_LIMIT,
  ].join("\n");
  const maxTokens = Math.min(8000, Math.max(1200, Math.round(words * 2.4) + 700));
  const raw = await ask(deps, "writer", articleSystemPrompt(ctx), user, maxTokens);
  const blocks = blocksFromLlm(parseLlmObject<{ blocks?: unknown }>(raw)?.blocks, raw);
  if (!blocks.length) throw new RewriteError(RETRY_MSG, 422, "llm");

  /*
   * Iqtiboslar REYESTR bilan: model «yangi» id o'ylab topsa
   * (`[W99999]`) u o'chadi — `verifyCitations` generatsiyadagi bilan
   * bir xil qoida. `guardSection` — hisob (suv, manbasiz foizlar) va
   * bo'sh natija tekshiruvi.
   */
  const verified = verifyCitations([{ id: section.id, title: section.title, blocks }], model.references);
  const clean = verified.sections[0].blocks;
  const guard = guardSection(clean, { refs: model.references, userFacts: model.userFacts });
  if (!guard.report.words) throw new RewriteError(RETRY_MSG, 422, "llm");
  if (verified.unresolved.length) console.warn(`[article] tuzatish «${section.id}»: reyestrda yo'q iqtibos o'chirildi: ${verified.unresolved.map((u) => u.id).join(", ")}`);
  if (guard.report.unsourcedNumbers.length) console.warn(`[article] tuzatish «${section.id}»: manbasiz foizlar: ${guard.report.unsourcedNumbers.join(", ")}`);

  return {
    ops: [{ op: "setSection", sectionId: section.id, blocks: keepVisuals(section.blocks, clean) }],
    unresolved: verified.unresolved,
    unsourcedNumbers: guard.report.unsourcedNumbers,
  };
}

async function rewriteAbstract(doc: AcademicDoc, lang: ArticleLang, fix: ArticleFix, deps: RewriteDeps): Promise<ArticleOp[]> {
  const ctx = contextOf(doc);
  const cur = (doc.abstracts ?? []).find((a) => langKeyOf(a.lang) === lang);
  const user = [
    abstractPrompt(ctx, lang, summaries(doc)),
    cur ? `CURRENT ABSTRACT (rewrite it according to the instruction):\n${cur.text.slice(0, 4000)}` : "",
    `EDITOR INSTRUCTION (highest priority): ${fix.instruction}`,
    HONESTY_LIMIT,
  ]
    .filter(Boolean)
    .join("\n");
  const raw = await ask(deps, "writer", abstractSystemPrompt(ctx, lang), user, 1400);
  const r = abstractFromLlm(raw, ctx, lang);
  if (!r) throw new RewriteError(RETRY_MSG, 422, "llm");
  const ops: ArticleOp[] = [{ op: "abstract", lang, text: r.text }];
  // Kalit so'zlar shu tilda bo'lmasa — bir chaqiruvdan chiqqanini olamiz (bor bo'lsa foydalanuvchiniki qoladi).
  if (!doc.article!.keywords[lang]?.length && r.keywords.length >= ctx.profile.keywords[0]) ops.push({ op: "keywords", lang, items: r.keywords });
  return ops;
}

async function rewriteKeywords(doc: AcademicDoc, fix: ArticleFix, deps: RewriteDeps): Promise<ArticleOp[]> {
  const ctx = contextOf(doc);
  const [minK, maxK] = ctx.profile.keywords;
  const user = [
    `Provide ${minK}–${maxK} keywords for this article in EACH of the three languages (uz, ru, en): lowercase unless proper nouns, 1–3 words each, no duplicates, specific to the topic and content.`,
    `Section summaries:`,
    summaries(doc),
    `Current keywords: ${JSON.stringify(doc.article!.keywords)}`,
    `EDITOR INSTRUCTION (highest priority): ${fix.instruction}`,
    `Return JSON: {"uz":["…"],"ru":["…"],"en":["…"]}`,
  ].join("\n");
  const raw = await ask(deps, "writer", articleSystemPrompt(ctx), user, 600);
  const j = parseLlmObject<Record<string, unknown>>(raw);
  const ops: ArticleOp[] = [];
  for (const lang of ["uz", "ru", "en"] as const) {
    const list = Array.isArray(j?.[lang]) ? (j![lang] as unknown[]).map((k) => cleanText(String(k ?? "")).replace(/[.;]+$/, "")).filter(Boolean) : [];
    if (list.length >= minK) ops.push({ op: "keywords", lang, items: list.slice(0, maxK) });
  }
  if (!ops.length) throw new RewriteError(RETRY_MSG, 422, "llm");
  return ops;
}

async function rewriteHighlights(doc: AcademicDoc, fix: ArticleFix, deps: RewriteDeps): Promise<ArticleOp[]> {
  const ctx = contextOf(doc);
  const h = ctx.type.highlights ?? { min: 3, max: 5, maxChars: 85 };
  const user = [highlightsPrompt(ctx, summaries(doc)), `EDITOR INSTRUCTION (highest priority): ${fix.instruction}`].join("\n");
  const raw = await ask(deps, "writer", articleSystemPrompt(ctx), user, 500);
  const list = parseLlmObject<{ highlights?: unknown }>(raw)?.highlights;
  const items = (Array.isArray(list) ? list : [])
    .map((x) => cleanText(String(x ?? "")))
    .filter(Boolean)
    .map((x) => clipWords(x, h.maxChars))
    .slice(0, h.max);
  if (items.length < h.min) throw new RewriteError(RETRY_MSG, 422, "llm");
  return [{ op: "highlights", items }];
}

/**
 * `fix` → tahrir oplari (hujjat O'ZGARMAYDI, faqat op lar qaytadi) +
 * qo'riqchi hisobi (o'chirilgan noma'lum iqtiboslar, manbasiz foizlar).
 * Nishon: bo'lim id | `abstract:<lang>` | `keywords` | `highlights`.
 */
export async function rewriteFix(doc: AcademicDoc, fix: ArticleFix, deps: RewriteDeps): Promise<RewriteOut> {
  if (!doc.article) throw new RewriteError("Eski maqolada «Tuzatish» yo'q — qaytadan yarating", 409, "legacy");
  const m = /^abstract:([a-z]{2})$/i.exec(fix.target);
  const plain = (ops: ArticleOp[]): RewriteOut => ({ ops, unresolved: [], unsourcedNumbers: [] });
  if (m) return plain(await rewriteAbstract(doc, langKeyOf(m[1]), fix, deps));
  if (fix.target === "keywords") return plain(await rewriteKeywords(doc, fix, deps));
  if (fix.target === "highlights") return plain(await rewriteHighlights(doc, fix, deps));
  const section = doc.sections.find((s) => s.id === fix.target);
  if (!section) throw new RewriteError(`Bo'lim topilmadi: ${fix.target}`, 422, "target");
  return rewriteSection(doc, section, fix, deps);
}

/* ────────────────────────── baholovchi ballarini ko'chirish ────────────────────────── */

/** Avvalgi hisobotdan baholovchi natijasi — `judge:*` bandlaridan (bajarilgan fix chiqariladi). */
export function judgeFromReview(prev: ArticleReview | undefined, applied?: ArticleFix): JudgeResult | null {
  if (!prev) return null;
  const j = neutralJudge();
  let any = false;
  for (const c of JUDGE_CRITERIA) {
    const m = /^(\d)\/3$/.exec(prev.checks.find((x) => x.id === `judge:${c}`)?.detail ?? "");
    if (!m) continue;
    j[c] = Math.max(0, Math.min(3, Number(m[1])));
    any = true;
  }
  if (!any) return null;
  // Hisobotda bo'lmagan mezonlar — tur uchun o'tkazib yuborilgan (`ArticleType.judge.skip`, AUDIT-18 Q-7); ballga kirmaydi.
  const skipped = JUDGE_CRITERIA.filter((c) => !prev.checks.some((x) => x.id === `judge:${c}`));
  if (skipped.length) j.skipped = skipped;
  j.notes = prev.judgeNotes.filter((n) => n !== REWRITE_REVIEW_NOTE && n !== POLISH_JUDGE_NOTE && n !== JUDGE_NO_ANSWER);
  j.fixes = prev.checks
    .filter((c): c is ReviewCheck & { fix: NonNullable<ReviewCheck["fix"]> } => c.id.startsWith("judge:fix:") && Boolean(c.fix))
    .map((c) => ({ target: c.fix.target, instruction: c.fix.instruction }))
    .filter((f) => !(applied && f.target === applied.target && f.instruction === applied.instruction));
  return j;
}

/* ────────────────────────── apply ────────────────────────── */

export type ApplyPolishDeps = RewriteDeps & { concurrency?: number };
/** `unresolved` — qayta yozilgan bo'limlarning qo'riqchi hisobi (hisobot `guard` uchun). */
export type ApplyPolishResult = ApplyPolishResultOf<ArticleOp>;

/** `rewriteFix` → neytral yadro kutadigan shakl (op lar + qo'riqchi + qayta yozilgan bo'limlar). */
const rewriteForCore = async (doc: AcademicDoc, fix: ArticleFix, deps: RewriteDeps) => {
  const r = await rewriteFix(doc, fix, deps);
  return { ops: r.ops, unresolved: r.unresolved, rewrittenSections: r.ops.flatMap((op) => (op.op === "setSection" ? [op.sectionId] : [])) };
};

/**
 * Fix lar PARALLEL (`mapPool`, standart 3) — hammasi ASL hujjat ustida
 * (nishonlar farqli, `planPolish` birlashtirgan). Bitta fix xatosi
 * boshqalarini to'xtatmaydi — `failed` ga tushadi.
 */
export async function applyPolish(doc: AcademicDoc, fixes: ArticleFix[], deps: ApplyPolishDeps): Promise<ApplyPolishResult> {
  return applyPolishWith<ArticleOp>(doc, fixes, { concurrency: deps.concurrency, rewrite: (d, fix) => rewriteForCore(d, fix, deps) });
}

/* ────────────────────────── run ────────────────────────── */

export type PolishDeps = {
  complete: CompleteFn;
  deadline: number;
  now?: Date;
  /** `false` — baholovchi chaqirilmaydi (testlar); standart `true`. */
  judge?: boolean;
  /** Dvigateldan: qidiruv statistikasi va qo'riqchi hisobi (hisobotda saqlanadi). */
  research?: ResearchStats;
  guard?: ReviewGuardInput;
  onUsage?: (u: LlmUsage) => void;
  concurrency?: number;
  genId?: string;
};

export type PolishResult = RunPolishResult<ArticleOp>;

/**
 * Plan → apply → `applyArticleOps` → `reviewArticle` (judge) → Q-3.
 * Mantiq NEYTRAL yadroda (`report/polish-core.ts runPolishWith`); bu yerda
 * faqat maqolaga xos dependensiyalar. Baholovchi javob bermasa ballari
 * ESKI hisobotdan ko'chiriladi (izoh bilan) — neytral 2/3 bilan taqqoslash
 * adolatsiz bo'lardi (eski qattiq baho neytralga «o'sib» soxta qabulga
 * olib kelardi).
 */
export async function runPolish(doc: AcademicDoc, review: ArticleReview, deps: PolishDeps): Promise<PolishResult> {
  const judge = deps.judge !== false;
  const now = deps.now ?? new Date();
  const complete: CompleteFn = async (role, system, user, o) => {
    const r = await deps.complete(role, system, user, o);
    if (r?.usage) deps.onUsage?.(r.usage);
    return r;
  };
  return runPolishWith<ArticleOp, JudgeResult>(doc, review, {
    deadline: deps.deadline,
    judge,
    now,
    guard: deps.guard,
    concurrency: deps.concurrency,
    plan: planPolish,
    userNeeds,
    rewrite: (d, fix, deadline) => rewriteForCore(d, fix, { complete, deadline }),
    apply: (d, ops) => applyArticleOps(d, ops, { genId: deps.genId ?? "polish" }),
    // `onUsage` bu yerda EMAS — `complete` o'rami har chaqiruvni allaqachon hisoblaydi (baholovchi ikki marta sanalmasin).
    review: (d, guard) => {
      const type = ARTICLE_TYPES[doc.article?.type ?? "imrad_oak"];
      const profile = PUBLICATION_PROFILES[doc.article?.profile ?? type.defaultProfile];
      const wordTarget = articleWordPlan(doc.meta, type, profile).body;
      return reviewArticle(d, { complete, deadline: deps.deadline, wordTarget, judge, now, research: deps.research, guard });
    },
    judgeFromReview: (prev) => judgeFromReview(prev),
    rescore: (fresh, j) => {
      const rules = fresh.checks.filter((c) => !c.id.startsWith("judge:"));
      return { ...fresh, score: scoreReview(rules, j), checks: [...rules, ...judgeChecks(j)], judgeNotes: [...j.notes, POLISH_JUDGE_NOTE] };
    },
  });
}
