import "server-only";
import { ApiError } from "./api";
import { commitDocOps, loadDocForEdit } from "./slide-commit";
import { ARTICLE_EDIT_LIMITS, applyArticleOps, langKeyOf, type ArticleLang, type ArticleOp } from "../generation/article/edit";
import { abstractFromLlm, articleWordPlan, blocksFromLlm } from "../generation/article/engine";
import {
  abstractPrompt,
  abstractSystemPrompt,
  articleSystemPrompt,
  highlightsPrompt,
  sectionPrompt,
  type ArticleContext,
  type SectionPlan,
} from "../generation/article/prompts";
import { guardSection, wordsOf } from "../generation/article/guard";
import { verifyCitations } from "../generation/research/verify";
import { JUDGE_CRITERIA, judgeChecks, neutralJudge, reviewArticle, scoreReview, type JudgeResult } from "../generation/article/review";
import { ARTICLE_TYPES } from "../generation/article/types-registry";
import { PUBLICATION_PROFILES } from "../generation/article/profiles";
import { articleLabels } from "../generation/article/labels";
import { normalizeArticlePages, type ArticleInput } from "../generation/article/input";
import type { ArticleReview, ReviewCheck } from "../generation/article/types";
import { complete as completeRole } from "../generation/llm-roles";
import { parseLlmObject } from "../generation/json";
import { cleanText, remainingMs } from "../generation/quality";
import type { AcademicDoc, Block, DocSection } from "../generation/types";
import type { DocOp } from "../generation/slide-edit";

/**
 * «TUZATISH» — tayyorlik hisobotidagi `fix` ni bajarish (Maqola 2, WP7).
 *
 * Hisobot (`article/review.ts`) har bandga `{op:"rewrite", target,
 * instruction}` shartnomasini beradi; bu modul uni `writer` roli bilan
 * bajaradi va natijani ODDIY TAHRIR OPLARIGA (`setSection` / `abstract` /
 * `keywords` / `highlights`) aylantirib `commitDocOps` orqali yozadi —
 * ya'ni versiya qulfi (409), egalik (SQL), atomarlik va `doc_prev`
 * qoidalari `PATCH …/doc` bilan AYNAN bir xil.
 *
 * Qoidalar:
 *   • KREDIT YECHILMAYDI — tahrir bepul (mahsulot egasi qarori);
 *     `chargeInTx` bu modulda umuman chaqirilmaydi (test qulflaydi).
 *   • Model javobi generatsiyadagi kabi ISHONCHSIZ: iqtiboslar
 *     `verifyCitations` bilan reyestrga solishtiriladi (noma'lum id
 *     o'chadi), `guardSection` hisobot beradi; bo'sh javob → 422.
 *   • Bo'limdagi rasm/jadval/formula bloklari SAQLANADI — model faqat
 *     matn qaytaradi, vizuallar eski o'rniga (indeks bo'yicha) qaytariladi.
 *   • 30 s: javob bo'lmasa 422 «Qayta urinib ko'ring» — foydalanuvchi
 *     tugmani yana bosadi, hujjat o'zgarmaydi.
 *   • Hisobot qayta hisoblanadi — QOIDALAR (tez, deterministik);
 *     baholovchi (`judge`, Claude) QAYTA CHAQIRILMAYDI: uning ballari
 *     avvalgi hisobotdan ko'chiriladi va izohda aytiladi. Sabab — narx
 *     (~1 150 so'm/chaqiruv) va vaqt (35 s); to'liq qayta baholash —
 *     maqolani qaytadan yaratish.
 */

export type ArticleFix = { op: "rewrite"; target: string; instruction: string };

export type RewriteDeps = {
  /** Test seam — rol bo'yicha LLM (`engine.ts` bilan bir xil). */
  complete?: typeof completeRole;
  /** `Date.now()` ms — chaqiruvga qolgan vaqt shundan hisoblanadi. */
  deadline?: number;
  now?: Date;
};

export const REWRITE_TIMEOUT_MS = 30_000;
/** Hisobot izohi — baholovchi qayta chaqirilmaganini aytadi. */
export const REWRITE_REVIEW_NOTE =
  "Tuzatishdan keyin qoidalar qayta tekshirildi; baholovchi ballari avvalgi baholashdan — to‘liq qayta baholash uchun maqolani qaytadan yarating.";

const RETRY_MSG = "Model javob bermadi — qayta urinib ko‘ring";

/* ────────────────────────── kirish ────────────────────────── */

/** HTTP tanasidagi `fix` — hisobot shartnomasi bilan bir xil shakl (400 bu yerda). */
export function parseArticleFix(raw: unknown): ArticleFix {
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || Array.isArray(o)) throw new ApiError("«fix» obyekt bo'lishi kerak", 400);
  if (o.op !== "rewrite") throw new ApiError("«fix.op» faqat «rewrite» bo'ladi", 400);
  const target = typeof o.target === "string" ? o.target.trim() : "";
  if (!target || target.length > ARTICLE_EDIT_LIMITS.id || !/^[\w:.\-]+$/.test(target)) throw new ApiError("«fix.target» yaroqsiz", 400);
  const instruction = typeof o.instruction === "string" ? o.instruction.replace(/\s+/g, " ").trim() : "";
  if (!instruction || instruction.length > ARTICLE_EDIT_LIMITS.instruction) throw new ApiError("«fix.instruction» yaroqsiz", 400);
  return { op: "rewrite", target, instruction };
}

/* ────────────────────────── kontekst ────────────────────────── */

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
  const complete = deps.complete ?? completeRole;
  const timeoutMs = Math.max(1, Math.min(REWRITE_TIMEOUT_MS, remainingMs(deps.deadline)));
  let timer: ReturnType<typeof setTimeout> | null = null;
  const bomb = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    const r = await Promise.race([complete(role, system, user, { json: true, maxTokens, timeoutMs }).catch(() => null), bomb]);
    if (!r?.text) throw new ApiError(RETRY_MSG, 422, { code: "llm" });
    return r.text;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/* ────────────────────────── nishonlar ────────────────────────── */

const VISUAL = new Set<Block["kind"]>(["figure", "tableRef", "formula"]);

/** Eski vizual bloklarni yangi matn ichiga (eski indeks bo'yicha) qaytaradi. */
export function keepVisuals(oldBlocks: Block[], text: Block[]): Block[] {
  const out = text.slice();
  oldBlocks.forEach((b, i) => {
    if (VISUAL.has(b.kind)) out.splice(Math.min(i, out.length), 0, { ...b });
  });
  return out;
}

async function rewriteSection(doc: AcademicDoc, section: DocSection, fix: ArticleFix, deps: RewriteDeps): Promise<ArticleOp[]> {
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
    .filter((b) => !VISUAL.has(b.kind))
    .map((b) => b.text)
    .join("\n\n")
    .slice(0, 12_000);
  const user = [
    sectionPrompt(ctx, { plan, wantTable: false, wantFigure: false, wantChart: false }),
    `CURRENT TEXT of the section — rewrite it: keep its scope and every USER FACT verbatim, keep the citation IDs that still support a sentence, do not add new claims without a SOURCE:`,
    existing || "(empty)",
    `EDITOR INSTRUCTION (highest priority): ${fix.instruction}`,
  ].join("\n");
  const maxTokens = Math.min(8000, Math.max(1200, Math.round(words * 2.4) + 700));
  const raw = await ask(deps, "writer", articleSystemPrompt(ctx), user, maxTokens);
  const blocks = blocksFromLlm(parseLlmObject<{ blocks?: unknown }>(raw)?.blocks, raw);
  if (!blocks.length) throw new ApiError(RETRY_MSG, 422, { code: "llm" });

  /*
   * Iqtiboslar REYESTR bilan: model «yangi» id o'ylab topsa
   * (`[W99999]`) u o'chadi — `verifyCitations` generatsiyadagi bilan
   * bir xil qoida. `guardSection` — hisob (suv, manbasiz foizlar) va
   * bo'sh natija tekshiruvi.
   */
  const verified = verifyCitations([{ id: section.id, title: section.title, blocks }], model.references);
  const clean = verified.sections[0].blocks;
  const guard = guardSection(clean, { refs: model.references, userFacts: model.userFacts });
  if (!guard.report.words) throw new ApiError(RETRY_MSG, 422, { code: "llm" });
  if (verified.unresolved.length) console.warn(`[article] tuzatish «${section.id}»: reyestrda yo'q iqtibos o'chirildi: ${verified.unresolved.map((u) => u.id).join(", ")}`);
  if (guard.report.unsourcedNumbers.length) console.warn(`[article] tuzatish «${section.id}»: manbasiz foizlar: ${guard.report.unsourcedNumbers.join(", ")}`);

  return [{ op: "setSection", sectionId: section.id, blocks: keepVisuals(section.blocks, clean) }];
}

async function rewriteAbstract(doc: AcademicDoc, lang: ArticleLang, fix: ArticleFix, deps: RewriteDeps): Promise<ArticleOp[]> {
  const ctx = contextOf(doc);
  const cur = (doc.abstracts ?? []).find((a) => langKeyOf(a.lang) === lang);
  const user = [
    abstractPrompt(ctx, lang, summaries(doc)),
    cur ? `CURRENT ABSTRACT (rewrite it according to the instruction):\n${cur.text.slice(0, 4000)}` : "",
    `EDITOR INSTRUCTION (highest priority): ${fix.instruction}`,
  ]
    .filter(Boolean)
    .join("\n");
  const raw = await ask(deps, "writer", abstractSystemPrompt(ctx, lang), user, 1400);
  const r = abstractFromLlm(raw, ctx, lang);
  if (!r) throw new ApiError(RETRY_MSG, 422, { code: "llm" });
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
  if (!ops.length) throw new ApiError(RETRY_MSG, 422, { code: "llm" });
  return ops;
}

/** So'z chegarasida kesish (dvigatel `clipWords` bilan bir xil). */
function clipWords(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const i = cut.lastIndexOf(" ");
  return (i > max * 0.6 ? cut.slice(0, i) : cut).replace(/[,;:\s]+$/, "");
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
  if (items.length < h.min) throw new ApiError(RETRY_MSG, 422, { code: "llm" });
  return [{ op: "highlights", items }];
}

/**
 * `fix` → tahrir oplari (hujjat O'ZGARMAYDI, faqat op lar qaytadi).
 * Nishon: bo'lim id | `abstract:<lang>` | `keywords` | `highlights`.
 */
export async function rewriteArticleSection(doc: AcademicDoc, fix: ArticleFix, deps: RewriteDeps = {}): Promise<ArticleOp[]> {
  if (!doc.article) throw new ApiError("Eski maqolada «Tuzatish» yo'q — qaytadan yarating", 409, { code: "legacy" });
  const m = /^abstract:([a-z]{2})$/i.exec(fix.target);
  if (m) return rewriteAbstract(doc, langKeyOf(m[1]), fix, deps);
  if (fix.target === "keywords") return rewriteKeywords(doc, fix, deps);
  if (fix.target === "highlights") return rewriteHighlights(doc, fix, deps);
  const section = doc.sections.find((s) => s.id === fix.target);
  if (!section) throw new ApiError(`Bo'lim topilmadi: ${fix.target}`, 422);
  return rewriteSection(doc, section, fix, deps);
}

/* ────────────────────────── hisobot ────────────────────────── */

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
  j.notes = prev.judgeNotes.filter((n) => n !== REWRITE_REVIEW_NOTE && n !== "Baholovchi javob bermadi");
  j.fixes = prev.checks
    .filter((c): c is ReviewCheck & { fix: NonNullable<ReviewCheck["fix"]> } => c.id.startsWith("judge:fix:") && Boolean(c.fix))
    .map((c) => ({ target: c.fix.target, instruction: c.fix.instruction }))
    .filter((f) => !(applied && f.target === applied.target && f.instruction === applied.instruction));
  return j;
}

/**
 * Tahrirdan keyingi hisobot: qoidalar QAYTA (`reviewArticle`, `judge:false`),
 * baholovchi ballari avvalgi hisobotdan (`judgeFromReview`), izoh bilan.
 */
export async function recomputeReview(doc: AcademicDoc, prev: ArticleReview | undefined, applied?: ArticleFix, now = new Date()): Promise<ArticleReview> {
  const type = ARTICLE_TYPES[doc.article?.type ?? "imrad_oak"];
  const profile = PUBLICATION_PROFILES[doc.article?.profile ?? type.defaultProfile];
  // Dvigatel bilan bir xil: «Hajm» qoidasi BO'LIM matniga qaraydi (`plan.body`), annotatsiya qo'shilmaydi.
  const wordTarget = articleWordPlan(doc.meta, type, profile).body;
  const fresh = await reviewArticle(doc, { judge: false, wordTarget, now });
  const rules = fresh.checks.filter((c) => !c.id.startsWith("judge:"));
  const judge = judgeFromReview(prev, applied) ?? neutralJudge();
  return {
    ...fresh,
    score: scoreReview(rules, judge),
    checks: [...rules, ...judgeChecks(judge)],
    judgeNotes: [...judge.notes, REWRITE_REVIEW_NOTE],
  };
}

/* ────────────────────────── yozish ────────────────────────── */

export type RewriteResult = { generation: Awaited<ReturnType<typeof commitDocOps>>; ops: ArticleOp[] };

/**
 * `POST …/rewrite` yadrosi: egalik/holat (`loadDocForEdit`), versiya
 * (409 — LLM chaqirilmasdan OLDIN ham tekshiriladi: eskirgan tab 30 s
 * kutib keyin 409 olmasin), LLM → op lar → hisobot → `commitDocOps`
 * (asl qulf SQL predikatida).
 */
export async function rewriteArticle(id: string, userId: string, baseVersion: number, fix: ArticleFix, deps: RewriteDeps = {}): Promise<RewriteResult> {
  const cur = await loadDocForEdit(id, userId);
  if (cur.adapter.id !== "article") throw new ApiError("Bu hujjat maqola emas", 409, { code: "legacy" });
  if (baseVersion !== cur.docVersion) {
    throw new ApiError("Hujjat boshqa joyda o'zgargan — yangilab qayta urinib ko'ring", 409, { code: "version", docVersion: cur.docVersion });
  }
  const deadline = deps.deadline ?? Date.now() + REWRITE_TIMEOUT_MS;
  const ops = await rewriteArticleSection(cur.doc, fix, { ...deps, deadline });

  // Hisobot YANGI hujjat ustida — avval op lar mahalliy qo'llanadi (yozilmaydi).
  const applied = applyArticleOps(cur.doc, ops, { genId: id });
  if (!applied.ok) throw new ApiError(applied.error, 422, { at: applied.at });
  const review = await recomputeReview(applied.doc, cur.doc.article?.review, fix, deps.now);
  const all: ArticleOp[] = [...ops, { op: "review", review }];

  const generation = await commitDocOps(id, userId, baseVersion, all as unknown as DocOp[]);
  return { generation, ops: all };
}
