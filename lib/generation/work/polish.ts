/**
 * AVTO-SAYQAL — TALABA ISHI (AUDIT-19 WP-A) — SOF, IZOMORF: sharp/DB
 * importi yo'q, `complete` tashqaridan keladi (dvigatel 9-bosqichda,
 * server «Hammasini tuzatish» da).
 *
 *   planWorkPolish(review, doc) → hisobotdagi tuzatiladigan bandlar → ≤6 fix
 *   runWorkPolish(doc, review)  → plan → apply → hujjatga qo'llash →
 *                                 qayta hisobot → ball `acceptDelta` dan
 *                                 ko'p OSHSA qabul (Q-3 + X-5)
 *   workUserNeeds(review, doc)  → «Sizdan kutiladi» (manbalar, natijalar, titul)
 *
 * Mantiq NEYTRAL yadroda (`report/polish-core.ts runPolishWith`) — bu
 * yerda faqat TALABA ISHIGA XOS dependensiyalar: reja, qayta yozish
 * promptlari, ball ko'chirish va op larni qo'llash.
 *
 * Qarorlar:
 *   • Q-2 HALOLLIK CHEGARASI — `needsUserData` filtri: tajriba/o'lchov/
 *     platforma talab qiladigan baholovchi tavsiyalari BAJARILMAYDI
 *     (`skipped.reason: "user"`), chunki model ularni O'YLAB TOPADI.
 *   • Q-3 + X-5 — natija faqat ball `WORK_ACCEPT_DELTA` (+2) dan ko'p
 *     oshsa qabul qilinadi: Claude ballari bir xil matnda ±5 tebranadi.
 *   • Bitta nishon = bitta fix (bo'lim ikki marta parallel yozilmasin).
 *
 * `apply` VAQTINCHA shu faylda (`applyWorkSectionOps`): `work/edit.ts`
 * `WorkOp` — WP-C niki. U kelganda lead `deps.apply` ni almashtiradi,
 * bu yerdagi sodda yo'l esa zaxira bo'lib qoladi.
 */
import type { AcademicDoc, Block, DocSection } from "../types";
import { applyWorkOps } from "./edit";
import type { DocReview, ReviewCheck, ReviewGuardInput, UserNeed } from "../report/types";
import {
  HONESTY_LIMIT,
  POLISH_JUDGE_NOTE,
  POLISH_MAX_FIXES,
  POLISH_SKIP,
  RewriteError,
  REWRITE_TIMEOUT_MS,
  applyPolishWith,
  isVisualBlock,
  keepVisuals,
  needsUserData,
  runPolishWith,
  type ApplyOpsResult,
  type ApplyPolishResultOf,
  type Fix,
  type PolishPlan,
  type PolishSkip,
  type RunPolishResult,
} from "../report/polish-core";
import { parseLlmObject } from "../json";
import { remainingMs } from "../quality";
import { blocksFromLlm } from "../article/parse";
import { verifyCitations, type Unresolved } from "../research/verify";
import type { LlmUsage } from "../llm-roles";
import type { CompleteFn, ResearchStats } from "../research/pipeline";
import { workKindOf } from "./registry";
import { WORK_JUDGE_CRITERIA } from "./registry";
import { SUBJECT_PROFILES } from "./subjects";
import { workLabels } from "./labels";
import { guardSection, wordsOf } from "./guard";
import { workWordPlan } from "./plan";
import { isChapterHeadId, type WorkModel } from "./types";
import {
  workConclusionRewritePrompt,
  workIntroRewritePrompt,
  workRewritePrompt,
  workSystemPrompt,
  type WorkContext,
  type WorkOutlinePlan,
  type WorkSectionPlan,
} from "./prompts";
import { neutralWorkJudge, reviewWork, scoreWorkReview, textSections, workJudgeChecks, type WorkJudgeResult } from "./review";

export { HONESTY_LIMIT, POLISH_SKIP, RewriteError };
export type { PolishPlan, PolishSkip };

export type WorkFix = Fix;

/** Q-3 qabul chegarasi — X-5 (baholovchi shovqini). */
export const WORK_ACCEPT_DELTA = 2;

const RETRY_MSG = "Model javob bermadi — qayta urinib ko‘ring";

/**
 * VAQTINCHA op tipi. WP-C `work/edit.ts` da to'liq `WorkOp` (matn,
 * sarlavha, katak, blok, manba) beradi; sayqalga esa bitta amal yetadi —
 * bo'lim bloklarini ALMASHTIRISH.
 */
export type WorkSectionOp = { op: "setSection"; sectionId: string; blocks: Block[] };

export type WorkRewriteDeps = {
  complete: CompleteFn;
  deadline?: number;
};

export type WorkRewriteOut = { ops: WorkSectionOp[]; unresolved: Unresolved[]; unsourcedNumbers: string[] };

/* ────────────────────────── kontekst ────────────────────────── */

/** Dvigatel konteksti HUJJATDAN (forma qiymatlari endi yo'q). */
export function workContextOf(doc: AcademicDoc): WorkContext {
  const model = doc.work!;
  const kind = workKindOf(model.genre, model.kind);
  const subject = SUBJECT_PROFILES[model.subject] ?? SUBJECT_PROFILES.humanities;
  const language = (model.language || doc.meta.language || "uz").toLowerCase() as "uz" | "ru" | "en";
  const plan = workWordPlan(doc.meta, kind, subject, { refs: model.refsMin, figures: model.figures.length, tables: doc.tables?.length ?? 0 });
  return {
    input: {
      topic: model.title ?? doc.meta.topic,
      genre: model.genre,
      kind: model.kind,
      subject: model.subject,
      language: language === "ru" || language === "en" ? language : "uz",
      pages: doc.meta.pagesLabel ?? "",
      university: model.university,
      faculty: model.faculty,
      department: model.department,
      subjectName: model.subjectName,
      group: model.group,
      course: model.course,
      author: model.author,
      teacher: model.teacher,
      teacherDegree: model.teacherDegree ?? "",
      city: model.city,
      ministry: model.ministry,
      ministryCustom: model.ministryCustom ?? "",
      tocMethod: "ai",
      tocText: "",
      outline: model.chapters.map((c) => ({ title: c.title, paragraphs: c.paragraphs.map((p) => p.title) })),
      includeVisuals: Boolean(doc.meta.includeVisuals),
      figureCount: model.figures.length,
      figureKinds: [],
      tableCount: doc.tables?.length ?? 0,
      userFacts: model.userFacts ?? "",
      sourceText: doc.meta.sourceText ?? "",
      userRefs: [],
      refsMin: model.refsMin,
      extra: doc.meta.extra ?? "",
    },
    meta: doc.meta,
    kind,
    subject,
    labels: workLabels(model.language || doc.meta.language),
    plan,
    refs: model.references,
  };
}

function outlineOf(model: WorkModel): WorkOutlinePlan {
  return {
    chapters: model.chapters.map((c) => ({
      id: c.id,
      title: c.title,
      paragraphs: c.paragraphs.map((p) => ({ id: p.id, title: p.title, chapterTitle: c.title, brief: p.title, words: 300 })),
    })),
  };
}

/* ────────────────────────── reja ────────────────────────── */

const rewriteFix = (target: string, instruction: string): WorkFix => ({ op: "rewrite", target, instruction });

/**
 * Past baholangan mezon → HALOL ko'rsatma (mavjud matn va manbalar
 * bilan bajariladigan). `criterionFixes` naqshi (AUDIT-18 jonli saboqi):
 * baholovchi `fixes` bermasa yoki hammasi Q-2 filtridan tushsa, sayqal
 * bo'sh qolmasin.
 */
export function workCriterionFixes(review: DocReview, doc: AcademicDoc): WorkFix[] {
  const level = (id: string) => review.checks.find((c) => c.id === `judge:${id}`)?.level;
  const low = (id: string) => level(id) === "red" || level(id) === "yellow";
  const sections = textSections(doc);
  const intro = sections.find((s) => s.id === "intro")?.id ?? null;
  const conclusion = sections.find((s) => s.id === "conclusion")?.id ?? null;
  const body = sections.filter((s) => /^ch\d+\.\d+$/.test(s.id));
  const shortest = [...body].sort((a, b) => wordsOf(a.blocks) - wordsOf(b.blocks))[0]?.id ?? null;
  const fillerHeavy = [...body].sort((a, b) => fillerCount(b) - fillerCount(a))[0]?.id ?? shortest;
  const out: WorkFix[] = [];
  const push = (target: string | null, instruction: string) => {
    if (target && !out.some((f) => f.target === target)) out.push(rewriteFix(target, instruction));
  };
  if (low("logic")) push(intro, "Make the introduction state the problem, the aim and the tasks in a single logical chain, so that each task clearly corresponds to one part of the work. Do not add new facts.");
  if (low("aimMatch")) push(conclusion, "Rewrite the conclusion so that it answers EACH task from the introduction in its own item, in the same order, and claims nothing that the body does not establish.");
  if (low("depth")) push(shortest, "Develop this paragraph: for each claim add the mechanism, an example or a comparison with a cited SOURCE already in the list; keep every existing citation and user fact; add no new numbers without a source.");
  if (low("originality")) push(fillerHeavy, "Rewrite this paragraph in the author's own analytical voice: state what follows from the cited sources rather than retelling them, and remove filler sentences.");
  return out;
}

function fillerCount(s: DocSection): number {
  return guardSection(s.blocks, { refs: [] }).report.filler.length;
}

/**
 * Hisobot → fix rejasi. Qoidalarning O'Z `fix` i + baholovchi
 * tavsiyalari (Q-2 filtri bilan) + mezon tuzatishlari. `refsCount`
 * tuzatilmaydi (manba qo'shish = foydalanuvchi ishi), `tocMatch` va
 * `refsOrder` avtomatik emas.
 */
export function planWorkPolish(review: DocReview, doc: AcademicDoc): PolishPlan {
  const skipped: PolishSkip[] = [];
  const candidates: WorkFix[] = [];
  const model = doc.work;
  if (!model) return { fixes: [], skipped: [{ id: "legacy", reason: "manual" }] };
  const hasFacts = Boolean(model.userFacts?.trim());
  const byId = new Map(textSections(doc).map((s) => [s.id, s]));

  const rules = review.checks.filter((c) => !c.id.startsWith("judge:") && c.level !== "green");
  // Qizil avval — 60 % ulushda har qizil band butun yashilcha yo'qotadi.
  rules.sort((a, b) => (a.level === "red" ? 0 : 1) - (b.level === "red" ? 0 : 1));
  for (const c of rules) {
    // Foydalanuvchi ma'lumoti kerak bo'ladigan bandlar — avtomatik tuzatilmaydi.
    if (c.id === "refsCount" || c.id === "refsVerified") {
      skipped.push({ id: c.id, reason: "user" });
      continue;
    }
    if (c.id === "refsOrder" || c.id === "tocMatch") {
      skipped.push({ id: c.id, reason: "manual" });
      continue;
    }
    if (!c.fix) {
      skipped.push({ id: c.id, reason: "manual" });
      continue;
    }
    candidates.push(rewriteFix(c.fix.target, c.fix.instruction));
  }

  /*
   * Baholovchi tavsiyalari — Q-2 filtr FAKTLAR BOR BO'LSA HAM (AUDIT-18
   * jonli saboqi: model so'ralgan tajriba tafsilotini o'ylab topdi va
   * baholovchi buni mukofotladi).
   */
  for (const c of review.checks) {
    if (!c.id.startsWith("judge:fix:") || !c.fix) continue;
    if (needsUserData(c.fix.instruction)) {
      skipped.push({ id: c.id, reason: hasFacts ? "unreported" : "user" });
      continue;
    }
    candidates.push(rewriteFix(c.fix.target, c.fix.instruction));
  }
  const targets = new Set(candidates.map((f) => f.target));
  for (const f of workCriterionFixes(review, doc)) if (!targets.has(f.target)) candidates.push(f);

  // Nishon mavjudligi + bitta nishon = bitta fix (ko'rsatmalar birlashadi).
  const merged = new Map<string, string[]>();
  for (const f of candidates) {
    if (!byId.has(f.target)) continue;
    const list = merged.get(f.target) ?? [];
    if (!list.includes(f.instruction)) list.push(f.instruction);
    merged.set(f.target, list);
  }
  const fixes: WorkFix[] = [];
  for (const [target, instructions] of merged) {
    if (fixes.length >= POLISH_MAX_FIXES) {
      skipped.push({ id: target, reason: "limit" });
      continue;
    }
    fixes.push(rewriteFix(target, instructions.length === 1 ? instructions[0] : instructions.map((s, i) => `(${i + 1}) ${s}`).join(" ")));
  }
  return { fixes, skipped };
}

/* ────────────────────────── «Sizdan kutiladi» ────────────────────────── */

/**
 * AI O'YLAB TOPMAYDIGAN narsalar (Q-2): yetishmayotgan manbalar, o'z
 * natijalari va titulning bo'sh maydonlari.
 */
export function workUserNeeds(review: DocReview, doc: AcademicDoc): UserNeed[] {
  const out: UserNeed[] = [];
  const model = doc.work;
  if (!model) return out;
  const find = (id: string) => review.checks.find((c) => c.id === id);

  const refsCount = find("refsCount");
  if (refsCount && refsCount.level !== "green") {
    const have = model.references.filter((r) => r.cited).length;
    const need = Math.max(0, model.refsMin - have);
    out.push({ id: "refs", label: "Manbalar", hint: `${need} ta manba yetishmayapti — DOI/ISBN yoki matn bilan o‘zingiz qo‘shing (AI manba o‘ylab topmaydi)` });
  }
  if (!model.userFacts?.trim()) {
    const red = (id: string) => find(`judge:${id}`)?.level === "red";
    const dataFix = review.checks.some((c) => c.id.startsWith("judge:fix:") && c.fix && needsUserData(c.fix.instruction));
    if (red("depth") || red("originality") || dataFix) {
      out.push({ id: "results", label: "Materiallaringiz", hint: "Amaliy qism uchun o‘z ma’lumotlaringizni (hisob, kuzatuv, tajriba, muassasa raqamlari) formadagi «Materiallarim» maydoniga kiriting — AI ularni o‘ylab topmaydi" });
    }
  }
  const titleFields: [string, string][] = [
    [model.university, "oliy ta’lim muassasasi"],
    [model.faculty, "fakultet"],
    [model.department, "kafedra"],
    [model.subjectName, "fan nomi"],
    [model.author, "muallif F.I.Sh."],
    [model.teacher, "rahbar F.I.Sh."],
  ];
  const empty = titleFields.filter(([v]) => !String(v ?? "").trim()).map(([, label]) => label);
  if (empty.length) out.push({ id: "title", label: "Titul sahifasi", hint: `To‘ldirilmagan: ${empty.join(", ")} — titul sahifasida bo‘sh qoladi` });
  return out;
}

/* ────────────────────────── qayta yozish ────────────────────────── */

async function ask(deps: WorkRewriteDeps, system: string, user: string, maxTokens: number): Promise<string> {
  const timeoutMs = Math.max(1, Math.min(REWRITE_TIMEOUT_MS, remainingMs(deps.deadline)));
  let timer: ReturnType<typeof setTimeout> | null = null;
  const bomb = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    const r = await Promise.race([deps.complete("writer", system, user, { json: true, deadline: deps.deadline, maxTokens, timeoutMs }).catch(() => null), bomb]);
    if (!r?.text) throw new RewriteError(RETRY_MSG, 422, "llm");
    return r.text;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Bitta fix → op lar (hujjat O'ZGARMAYDI) + qo'riqchi hisobi.
 * Nishon: `intro` | `conclusion` | paragraf id (`ch1.2`).
 */
export async function rewriteWorkFix(doc: AcademicDoc, fix: WorkFix, deps: WorkRewriteDeps): Promise<WorkRewriteOut> {
  const model = doc.work;
  if (!model) throw new RewriteError("Eski hujjatda «Tuzatish» yo'q — qaytadan yarating", 409, "legacy");
  const section = doc.sections.find((s) => s.id === fix.target && !isChapterHeadId(s.id));
  if (!section) throw new RewriteError(`Bo'lim topilmadi: ${fix.target}`, 422, "target");

  const ctx = workContextOf(doc);
  const system = workSystemPrompt(ctx);
  const current = section.blocks
    .filter((b) => !isVisualBlock(b.kind))
    .map((b) => b.text)
    .join("\n\n")
    .slice(0, 12_000);
  const words = Math.max(120, wordsOf(section.blocks));

  let user: string;
  if (section.id === "intro") {
    user = workIntroRewritePrompt(ctx, outlineOf(model), current, fix.instruction);
  } else if (section.id === "conclusion") {
    const summaries = textSections(doc)
      .filter((s) => s.id !== "conclusion")
      .map((s) => `• ${s.title}: ${s.blocks.filter((b) => b.kind === "p" || b.kind === "li").map((b) => b.text).join(" ").slice(0, 380)}`)
      .join("\n");
    user = workConclusionRewritePrompt(ctx, [], summaries, current, fix.instruction);
  } else {
    const chapter = model.chapters.find((c) => c.paragraphs.some((p) => p.sectionId === section.id));
    const plan: WorkSectionPlan = {
      id: section.id,
      title: section.title,
      ...(chapter ? { chapterTitle: chapter.title } : {}),
      brief: `Rewrite the existing paragraph according to the supervisor's instruction: ${fix.instruction}`,
      words,
    };
    user = workRewritePrompt(ctx, { plan, wantTable: false, wantFigure: false }, current, fix.instruction);
  }

  // Pol 2 000: kirish `parts` JSON i 1 350 da kesilib qolgan edi (AUDIT-19 smoke).
  const maxTokens = Math.min(8000, Math.max(2000, Math.round(words * 2.4) + 700));
  const raw = await ask(deps, system, user, maxTokens);
  const parsed = parseLlmObject<{ blocks?: unknown; parts?: Record<string, unknown> }>(raw);
  /*
   * Kirish `parts` shaklida ham qaytishi mumkin (`workIntroPrompt` sxemasi)
   * — `parts` AVVAL tekshiriladi: ilgari `blocksFromLlm(parsed.blocks, raw)`
   * `blocks` yo'qligi uchun xom JSON ni matnga aylantirib qo'ygan («parts :
   * relevance : Mavzuning dolzarbligi…» — AUDIT-19 smoke, sayqaldan keyin
   * kirish buzilgan).
   */
  let blocks: Block[] = [];
  if (parsed?.parts && typeof parsed.parts === "object" && !Array.isArray(parsed.blocks)) {
    blocks = Object.values(parsed.parts)
      .map((v) => String(v ?? "").trim())
      .filter((t) => t.length >= 20)
      .map((text): Block => ({ kind: "p", text }));
  }
  if (!blocks.length) blocks = blocksFromLlm(parsed?.blocks, raw);
  if (!blocks.length) throw new RewriteError(RETRY_MSG, 422, "llm");

  const verified = verifyCitations([{ id: section.id, title: section.title, blocks }], model.references);
  const clean = verified.sections[0].blocks;
  const guard = guardSection(clean, { refs: model.references, userFacts: model.userFacts });
  if (!guard.report.words) throw new RewriteError(RETRY_MSG, 422, "llm");
  if (verified.unresolved.length) console.warn(`[work] tuzatish «${section.id}»: reyestrda yo'q iqtibos o'chirildi: ${verified.unresolved.map((u) => u.id).join(", ")}`);

  return {
    ops: [{ op: "setSection", sectionId: section.id, blocks: keepVisuals(section.blocks, clean) }],
    unresolved: verified.unresolved,
    unsourcedNumbers: guard.report.unsourcedNumbers,
  };
}

/* ────────────────────────── op larni qo'llash ────────────────────────── */

/**
 * VAQTINCHA `apply` — faqat `setSection`. WP-C `work/edit.ts applyWorkOps`
 * ni berganda lead `deps.apply` ni almashtiradi (`runWorkPolish` uni
 * parametr sifatida oladi). Hujjat CHUQUR nusxada o'zgaradi.
 */
export function applyWorkSectionOps(doc: AcademicDoc, ops: WorkSectionOp[]): ApplyOpsResult {
  const next: AcademicDoc = { ...doc, sections: doc.sections.map((s) => ({ ...s, blocks: [...s.blocks] })) };
  for (const op of ops) {
    if (op.op !== "setSection") return { ok: false, error: `noma'lum op: ${String((op as { op?: unknown }).op)}` };
    const target = next.sections.find((s) => s.id === op.sectionId);
    if (!target) return { ok: false, error: `bo'lim topilmadi: ${op.sectionId}` };
    if (!op.blocks.length) return { ok: false, error: `bo'sh matn: ${op.sectionId}` };
    target.blocks = op.blocks.map((b) => ({ ...b }));
  }
  return { ok: true, doc: next };
}

/* ────────────────────────── ball ko'chirish ────────────────────────── */

/** Avvalgi hisobotdan baholovchi ballari — `judge:*` bandlaridan. */
export function workJudgeFromReview(prev: DocReview | undefined, kind = workKindOf("coursework", "theory")): WorkJudgeResult | null {
  if (!prev) return null;
  const j = neutralWorkJudge(kind);
  let any = false;
  for (const c of WORK_JUDGE_CRITERIA) {
    const m = /^(\d)\/3$/.exec(prev.checks.find((x) => x.id === `judge:${c}`)?.detail ?? "");
    if (!m) continue;
    j[c] = Math.max(0, Math.min(3, Number(m[1])));
    any = true;
  }
  if (!any) return null;
  const skipped = WORK_JUDGE_CRITERIA.filter((c) => !prev.checks.some((x) => x.id === `judge:${c}`));
  if (skipped.length) j.skipped = [...skipped];
  j.notes = prev.judgeNotes.filter((n) => n !== POLISH_JUDGE_NOTE);
  j.fixes = prev.checks
    .filter((c): c is ReviewCheck & { fix: NonNullable<ReviewCheck["fix"]> } => c.id.startsWith("judge:fix:") && Boolean(c.fix))
    .map((c) => ({ target: c.fix.target, instruction: c.fix.instruction }));
  return j;
}

/* ────────────────────────── apply / run ────────────────────────── */

export type WorkApplyPolishResult = ApplyPolishResultOf<WorkSectionOp>;

const rewriteForCore = async (doc: AcademicDoc, fix: WorkFix, deps: WorkRewriteDeps) => {
  const r = await rewriteWorkFix(doc, fix, deps);
  return { ops: r.ops, unresolved: r.unresolved, rewrittenSections: r.ops.map((op) => op.sectionId) };
};

export async function applyWorkPolish(doc: AcademicDoc, fixes: WorkFix[], deps: WorkRewriteDeps & { concurrency?: number }): Promise<WorkApplyPolishResult> {
  return applyPolishWith<WorkSectionOp>(doc, fixes, { concurrency: deps.concurrency, rewrite: (d, fix) => rewriteForCore(d, fix, deps) });
}

export type WorkPolishDeps = {
  complete: CompleteFn;
  deadline: number;
  now?: Date;
  judge?: boolean;
  research?: ResearchStats;
  guard?: ReviewGuardInput;
  onUsage?: (u: LlmUsage) => void;
  concurrency?: number;
  /** WP-C `work/edit.ts applyWorkOps` — berilmasa vaqtinchalik `setSection`. */
  apply?: (doc: AcademicDoc, ops: WorkSectionOp[]) => ApplyOpsResult;
  /** Q-3 chegarasi; standart `WORK_ACCEPT_DELTA` (+2, X-5). */
  acceptDelta?: number;
};

export type WorkPolishResult = RunPolishResult<WorkSectionOp>;

/**
 * Plan → apply → hujjatga qo'llash → qayta hisobot → Q-3 (+2).
 * Mantiq NEYTRAL yadroda (`runPolishWith`); bu yerda faqat talaba
 * ishiga xos dependensiyalar. Baholovchi javob bermasa ballari ESKI
 * hisobotdan ko'chiriladi (izoh bilan).
 */
export async function runWorkPolish(doc: AcademicDoc, review: DocReview, deps: WorkPolishDeps): Promise<WorkPolishResult> {
  const judge = deps.judge !== false;
  const now = deps.now ?? new Date();
  const model = doc.work;
  const kind = model ? workKindOf(model.genre, model.kind) : workKindOf("coursework", "theory");
  const complete: CompleteFn = async (role, system, user, o) => {
    const r = await deps.complete(role, system, user, o);
    if (r?.usage) deps.onUsage?.(r.usage);
    return r;
  };
  return runPolishWith<WorkSectionOp, WorkJudgeResult>(doc, review, {
    deadline: deps.deadline,
    judge,
    now,
    guard: deps.guard,
    concurrency: deps.concurrency,
    acceptDelta: deps.acceptDelta ?? model?.polishAccept ?? WORK_ACCEPT_DELTA,
    plan: planWorkPolish,
    userNeeds: workUserNeeds,
    rewrite: (d, fix, deadline) => rewriteForCore(d, fix, { complete, deadline }),
    /*
     * WP-C: `work/edit.ts applyWorkOps` — endi sayqal ham TAHRIR bilan
     * BITTA yo'ldan o'tadi: `setSection` dan keyin `cited` bayroqlari,
     * bob daraxti va rasm/jadval sarlavhalari MATNGA qarab tenglashadi
     * (`settle`). Ilgari bu yerdagi vaqtinchalik `applyWorkSectionOps`
     * faqat bloklarni almashtirardi va qayta yozilgan bo'limdan chiqib
     * ketgan manba ro'yxatda qolib ketardi.
     *
     * `deps.apply` ustun — testlar «apply yiqildi» holatini shu bilan
     * sinaydi; eski `applyWorkSectionOps` esa chaqiruvchilar uchun
     * eksport bo'lib qoladi.
     */
    apply: (d, ops) => (deps.apply ? deps.apply(d, ops) : applyWorkOps(d, ops, { genId: "" })),
    review: (d, guard) => reviewWork(d, { complete, deadline: deps.deadline, judge, now, research: deps.research, guard }),
    judgeFromReview: (prev) => workJudgeFromReview(prev, kind),
    rescore: (fresh, j) => {
      const rules = fresh.checks.filter((c) => !c.id.startsWith("judge:"));
      return { ...fresh, score: scoreWorkReview(rules, j), checks: [...rules, ...workJudgeChecks(kind, j)], judgeNotes: [...j.notes, POLISH_JUDGE_NOTE] };
    },
  });
}
