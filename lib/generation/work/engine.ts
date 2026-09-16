/**
 * TALABA ISHI DVIGATELI (AUDIT-19 WP-A) — `buildWorkDoc`.
 *
 * Bosqichlar (`onStage` foizlari reja bo'yicha):
 *   1 research     0→10   manba yig'ish (WP-B `collectReferencesFor`)
 *   2 outline     10→18   bob/paragraf rejasi — `tocText` bo'lsa UNDAN
 *   3 intro       18→24   kirish: MAJBURIY elementlar, yo'qolgani 1 marta qayta so'raladi
 *   4 paragraphs  24→60   `mapPool(3)`, har paragraf alohida, `guardSection`
 *   5 visuals     60→70   jadval (`DocTable` + `tableRef`) va sxema (`buildFigures`)
 *   6 conclusion  70→76   kirish VAZIFALARIGA javob
 *   7 refs        76→80   `verifyCitations` → `citedOnly` → `orderUzReferences`
 *   8 review      80→88   `review.ts` qoidalar + baholovchi
 *   9 polish      88→94   `runWorkPolish` (Q-1…Q-3, `acceptDelta: 2`)
 *   (10 render 94→100 — lead/WP-C.)
 *
 * Yagona manba qarori: matn `doc.sections` da TEKIS (bob = `ch1`
 * sarlavha bo'limi, paragraf = `ch1.1` alohida bo'lim), metama'lumot
 * `doc.work` da. Bu fayl RAQAM QO'YMAYDI (`1-BOB`, `1.1-jadval`) —
 * uni `work/layout.ts planWork` (WP-C) beradi.
 *
 * `null` — LLM yo'q (kalitsiz muhit): chaqiruvchi eski shablon yo'liga
 * o'tadi, aynan `buildArticleDoc` kabi.
 */
import type { FormValues } from "../../types";
import type { AcademicDoc, Block, DocMeta, DocSection, DocTable } from "../types";
import type { TranslationSource } from "../source-types";
import { llmEnabled } from "../llm";
import { CostMeter, complete as completeRole, type LlmUsage } from "../llm-roles";
import { parseLlmObject } from "../json";
import { mapPool, remainingMs, unverifiedReferenceNote } from "../quality";
import { blocksFromLlm, str } from "../article/parse";
import type { Figure, FigureSpec, Reference } from "../article/types";
import type { ArticleUserRef } from "../article/input";
import type { ResearchStats } from "../research/pipeline";
import { citedOnly, referenceIndex, verifyCitations, verifyCitationsInText, type Unresolved } from "../research/verify";
import { formatRefLine } from "../article/prompts";
import type { CompleteFn } from "../research/pipeline";
import { WORK_LIMITS, isChapterHeadId, workGenreOfTool, type WorkChapter, type WorkGenreId, type WorkIntroPartId, type WorkModel } from "./types";
import { pagesMid, workKindOf, type WorkKind } from "./registry";
import { SUBJECT_PROFILES } from "./subjects";
import { workLabels } from "./labels";
import { workInputFromValues } from "./input";
import { chapterWords, paragraphWords, workWordPlan } from "./plan";
import { guardSection, intakeCheck, missingFactNumbers, type SectionGuardReport } from "./guard";
import {
  workConclusionPrompt,
  workIntroPrompt,
  workOutlinePrompt,
  workParagraphPrompt,
  workResearchKeywords,
  workSystemPrompt,
  type WorkContext,
  type WorkOutlinePlan,
  type WorkSectionAsk,
  type WorkSectionPlan,
} from "./prompts";
import { reviewWork } from "./review";
import { runWorkPolish, workUserNeeds } from "./polish";

/* ────────────────────────── WP-B shartnomasi ────────────────────────── */

/**
 * Manba so'rovi — `research/pipeline.ts collectReferencesFor(ask, opts)`
 * ning kirishi (WP-B umumlashtiryapti). Dvigatel MAQOLA o'ramini
 * (`collectReferences(input, meta)`) chaqirmaydi: u `ArticleInput` ni
 * talab qiladi va talaba ishining janr/fan kvotasini bilmaydi.
 */
export type WorkResearchAsk = {
  topic: string;
  keywords: string[];
  language: "uz" | "ru" | "en";
  userRefs: ArticleUserRef[];
  research: boolean;
  want: { min: number; max: number };
  kinds: ("article" | "book" | "law" | "web" | "user")[];
  quota?: Partial<Record<"article" | "book" | "law" | "web" | "user", number>>;
  fromYear?: number;
  tiny?: boolean;
  userFacts?: string;
  typeLabel?: string;
};

export type WorkCollectResult = { refs: Reference[]; stats: ResearchStats };

export const EMPTY_RESEARCH_STATS: ResearchStats = { user: 0, userVerified: 0, queries: [], found: 0, candidates: 0, selected: 0, failedQueries: 0 };

/* ────────────────────────── opts / natija ────────────────────────── */

export type WorkStage = { progress: number; step: string };

export type WorkBuildOpts = {
  deadline: number;
  /** Janr; berilmasa `meta.toolId` dan (`coursework`/`referat`/`mustaqil-ish`). */
  genre?: WorkGenreId;
  source?: TranslationSource;
  onStage?: (ev: WorkStage) => void;
  /** Test seam — rol bo'yicha LLM. */
  complete?: CompleteFn;
  /** Test seam — tarmoq (WP-B quvurига uzatiladi). */
  fetchImpl?: typeof fetch;
  retryBaseMs?: number;
  /**
   * Manba yig'ish DEPENDENSIYASI. Berilmasa dvigatel
   * `collectReferencesFor` ni DINAMIK import bilan qidiradi (WP-B hali
   * birlashmagan bo'lsa — manbasiz davom etadi, hisobotda qizil).
   */
  research?: (ask: WorkResearchAsk) => Promise<WorkCollectResult>;
  /** Test seam — sxema chizish (standart: `../figures` dinamik import). */
  buildFigures?: (figures: Figure[], o: { lang: string }) => Promise<Figure[]>;
  /** Avto-sayqal; standart `true` (`WORK_POLISH=0` bilan o'chadi). */
  polish?: boolean;
  onUsage?: (u: LlmUsage) => void;
  now?: Date;
};

export type WorkCost = ReturnType<CostMeter["toJson"]>;

export type WorkGuardSummary = {
  removedCitations: number;
  unresolved: Unresolved[];
  unsourcedNumbers: string[];
  missingFactNumbers: string[];
  filler: string[];
  emptySections: string[];
  /** Kirishda topilmagan majburiy elementlar (qayta so'rovdan KEYIN). */
  missingIntroParts: WorkIntroPartId[];
  /** Kirish qayta so'ralganmi. */
  introRetried: boolean;
};

export type WorkBuildResult = { doc: AcademicDoc; cost: WorkCost; research: ResearchStats; guard: WorkGuardSummary };

/* ────────────────────────── byudjet ────────────────────────── */

const OUTLINE_TIMEOUT_MS = 30_000;
const INTRO_TIMEOUT_MS = 45_000;
const CONCLUSION_TIMEOUT_MS = 45_000;
const MIN_CALL_MS = 8_000;
const paragraphTimeout = (words: number, deadline: number) => Math.min(Math.max(35_000, 20_000 + words * 40), 90_000, remainingMs(deadline));

/** Avto-sayqal: ball shundan past bo'lsa (AUDIT-18 Q-1 «≥ 90 → to'xtaydi»). */
export const WORK_POLISH_BELOW = 90;
/** Sayqal uchun byudjetdan kamida shuncha qolishi kerak. */
export const WORK_POLISH_MIN_MS = 90_000;
/** Shu betdan katta paketda avto-sayqal O'TKAZIB YUBORILADI (X-3: 40–45 bet 660 s ga sig'maydi). */
export const WORK_POLISH_MAX_PAGES = 38;
/** Q-3 qabul chegarasi — X-5 (baholovchi ballari ±5 tebranadi). */
export const WORK_ACCEPT_DELTA = 2;

/** Rasm uchun taxminiy piksel o'lchami (160 mm × 300 dpi). */
const FIGURE_W = 1890;
const FIGURE_H = 1100;

/* ────────────────────────── reja parseri ────────────────────────── */

type RawOutline = {
  chapters?: { title?: unknown; paragraphs?: { title?: unknown; brief?: unknown }[] }[];
  intro?: Record<string, unknown>;
};

/** Deterministik reja — model javob bermasa yoki rejani buzsa. */
export function fallbackWorkOutline(ctx: WorkContext): WorkOutlinePlan {
  const { kind, input } = ctx;
  const n = input.outline.length ? clamp(input.outline.length, kind.chapters.min, kind.chapters.max) : kind.chapters.min;
  const perChapter = chapterWords(ctx.plan.chapters, n);
  const chapters: WorkOutlinePlan["chapters"] = [];
  for (let i = 0; i < n; i++) {
    const src = input.outline[i];
    const title = src?.title || `${input.topic} — ${i + 1}`;
    const pCount = clamp(src?.paragraphs.length || kind.paragraphsPerChapter.min, kind.paragraphsPerChapter.min, kind.paragraphsPerChapter.max);
    const words = paragraphWords(perChapter[i], pCount);
    const paragraphs: WorkSectionPlan[] = [];
    for (let j = 0; j < pCount; j++) {
      paragraphs.push({
        id: `ch${i + 1}.${j + 1}`,
        title: src?.paragraphs[j] || `${title} — ${j + 1}`,
        chapterTitle: title,
        brief: `${title} — «${input.topic}»`,
        words: words[j],
      });
    }
    chapters.push({ id: `ch${i + 1}`, title, paragraphs });
  }
  return { chapters };
}

/**
 * Model rejasini SKELETGA moslaydi: bob/paragraf soni turning
 * chegarasiga siqiladi, so'zlar rejaga qarab qayta taqsimlanadi,
 * id lar doim `ch<N>.<M>` (model bergan id ga ishonilmaydi).
 *
 * FOYDALANUVCHI REJASI USTUN: `input.outline` bo'lsa sarlavhalar undan
 * olinadi (model faqat `brief` qo'shadi) — «bezak maydon yo'q» qoidasi.
 */
export function workOutlineFromLlm(raw: string | undefined, ctx: WorkContext): WorkOutlinePlan {
  const { kind, input } = ctx;
  const parsed = parseLlmObject<RawOutline>(raw ?? "");
  const list = Array.isArray(parsed?.chapters) ? parsed!.chapters : [];
  if (!list.length) return fallbackWorkOutline(ctx);

  const want = input.outline.length ? clamp(input.outline.length, kind.chapters.min, kind.chapters.max) : clamp(list.length, kind.chapters.min, kind.chapters.max);
  const perChapter = chapterWords(ctx.plan.chapters, want);
  const chapters: WorkOutlinePlan["chapters"] = [];
  for (let i = 0; i < want; i++) {
    const src = list[i];
    const own = input.outline[i];
    const title = own?.title || str(src?.title, 200) || `${input.topic} — ${i + 1}`;
    const rawParas = Array.isArray(src?.paragraphs) ? src!.paragraphs : [];
    const count = clamp(own?.paragraphs.length || rawParas.length || kind.paragraphsPerChapter.min, kind.paragraphsPerChapter.min, kind.paragraphsPerChapter.max);
    const words = paragraphWords(perChapter[i], count);
    const paragraphs: WorkSectionPlan[] = [];
    for (let j = 0; j < count; j++) {
      const p = rawParas[j];
      paragraphs.push({
        id: `ch${i + 1}.${j + 1}`,
        title: own?.paragraphs[j] || str(p?.title, 200) || `${title} — ${j + 1}`,
        chapterTitle: title,
        brief: str(p?.brief, 400) || `${title} — «${input.topic}»`,
        words: words[j],
      });
    }
    chapters.push({ id: `ch${i + 1}`, title, paragraphs });
  }
  return { chapters };
}

/** Reja JSON dagi kirish bandlari (`{aim: "…"}`) — matn bo'lsa saqlanadi. */
export function introPartsFromLlm(raw: string | undefined): Partial<Record<WorkIntroPartId, string>> {
  const j = parseLlmObject<RawOutline>(raw ?? "");
  const src = (j?.intro ?? {}) as Record<string, unknown>;
  const out: Partial<Record<WorkIntroPartId, string>> = {};
  for (const [k, v] of Object.entries(src)) {
    const t = String(v ?? "").trim();
    if (t) out[k as WorkIntroPartId] = t.slice(0, 2000);
  }
  return out;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/* ────────────────────────── vizual reja ────────────────────────── */

export type WorkVisualPlan = Map<string, { table: boolean; figure: boolean }>;

/**
 * Qaysi paragrafda jadval/sxema so'raladi — DETERMINISTIK: eng katta
 * paragraflarga, kirish/xulosaga emas, bitta paragrafga bittadan.
 * Jadval avval o'rtadagi (tahliliy) boblarga, sxema esa birinchi
 * boblarga tushadi — hisobot `visualRef` bandi ikkalasini ham ko'radi.
 */
export function planWorkVisuals(ctx: WorkContext, outline: WorkOutlinePlan): WorkVisualPlan {
  const all = outline.chapters.flatMap((c) => c.paragraphs);
  const out: WorkVisualPlan = new Map(all.map((p) => [p.id, { table: false, figure: false }]));
  if (!ctx.input.includeVisuals || !all.length) return out;
  const bySize = [...all].sort((a, b) => b.words - a.words || a.id.localeCompare(b.id));
  let tables = Math.min(ctx.plan.tables, all.length);
  let figures = Math.min(ctx.plan.figures, all.length);
  // Jadval — oxirgi boblardan (tahlil/natija), sxema — birinchilardan (nazariya).
  for (const p of [...bySize].reverse()) {
    if (tables <= 0) break;
    out.get(p.id)!.table = true;
    tables--;
  }
  for (const p of bySize) {
    if (figures <= 0) break;
    const v = out.get(p.id)!;
    if (v.figure) continue;
    v.figure = true;
    figures--;
  }
  return out;
}

/* ────────────────────────── asosiy ────────────────────────── */

type ParagraphOut = {
  plan: WorkSectionPlan;
  blocks: Block[];
  table?: { table: Omit<DocTable, "id" | "anchor">; after: number; source?: string };
  figure?: { caption: string; spec: FigureSpec; after: number };
  report: SectionGuardReport;
};

type SectionJson = { blocks?: unknown; table?: unknown; figure?: { caption?: unknown; spec?: unknown; anchorAfterBlock?: unknown } };

export async function buildWorkDoc(meta: DocMeta, values: FormValues, opts: WorkBuildOpts): Promise<WorkBuildResult | null> {
  const complete = opts.complete ?? completeRole;
  if (!opts.complete && !llmEnabled()) return null;
  const { deadline } = opts;
  const now = opts.now ?? new Date();
  const meter = new CostMeter();

  const genre = opts.genre ?? workGenreOfTool(meta.toolId) ?? "coursework";
  const input = workInputFromValues({ ...values, sourceText: meta.sourceText || values.sourceText || "" }, genre);
  if (!input.sourceText && opts.source) input.sourceText = await sourceTextOf(opts.source);
  const kind = workKindOf(genre, input.kind);
  const subject = SUBJECT_PROFILES[input.subject];
  const labels = workLabels(input.language);

  const docMeta: DocMeta = {
    ...meta,
    language: input.language,
    topic: input.topic || meta.topic,
    pagesLabel: input.pages,
    targetPages: pagesMid(input.pages),
    figureCount: input.figureCount,
    includeVisuals: input.includeVisuals,
  };
  const plan = workWordPlan(docMeta, kind, subject, { refs: input.refsMin, figures: input.figureCount, tables: input.tableCount, pages: input.pages });
  const ctx: WorkContext = { input, meta: docMeta, kind, subject, labels, plan, refs: [] };

  const stage = (progress: number, step: string) => opts.onStage?.({ progress, step });
  const ask = async (role: Parameters<CompleteFn>[0], system: string, user: string, o: { maxTokens: number; timeoutMs: number }) => {
    if (o.timeoutMs < MIN_CALL_MS) return null;
    const r = await complete(role, system, user, { json: true, ...o });
    if (r?.usage) {
      meter.add(r.usage);
      opts.onUsage?.(r.usage);
    }
    return r?.text ?? null;
  };
  const guard: WorkGuardSummary = {
    removedCitations: 0,
    unresolved: [],
    unsourcedNumbers: [],
    missingFactNumbers: [],
    filler: [],
    emptySections: [],
    missingIntroParts: [],
    introRetried: false,
  };

  /* ── 1. research (0→10) ── */
  stage(0, "Manbalar qidirilmoqda");
  const research = await collectWorkReferences(ctx, opts, meter);
  ctx.refs = research.refs;
  stage(10, `Manbalar: ${research.refs.length} ta`);

  /* ── 2. outline (10→18) ── */
  const system = workSystemPrompt(ctx);
  stage(10, "Reja tuzilmoqda");
  const outlineRaw = await ask("writer", system, workOutlinePrompt(ctx), { maxTokens: 1600, timeoutMs: Math.min(OUTLINE_TIMEOUT_MS, remainingMs(deadline)) });
  const outline = workOutlineFromLlm(outlineRaw ?? undefined, ctx);
  const introDraft = introPartsFromLlm(outlineRaw ?? undefined);
  const paragraphPlans = outline.chapters.flatMap((c) => c.paragraphs).slice(0, WORK_LIMITS.sections);
  stage(18, `Reja: ${outline.chapters.length} bob, ${paragraphPlans.length} paragraf`);

  /* ── 3. intro (18→24) ── */
  stage(18, "Kirish yozilmoqda");
  const intro = await writeIntro(ctx, outline, introDraft, system, ask, deadline, guard);
  stage(24, "Kirish tayyor");

  /* ── 4. paragraphs (24→60) ── */
  const visuals = planWorkVisuals(ctx, outline);
  const figureSpecOf = await loadFigureSpec();
  let done = 0;
  const written = await mapPool(paragraphPlans, 3, async (p): Promise<ParagraphOut> => {
    const v = visuals.get(p.id) ?? { table: false, figure: false };
    const out = await writeParagraph(ctx, { plan: p, wantTable: v.table, wantFigure: v.figure }, system, ask, deadline, figureSpecOf);
    done++;
    stage(24 + Math.round((36 * done) / Math.max(1, paragraphPlans.length)), `Paragraflar · ${done}/${paragraphPlans.length}`);
    return out;
  });

  /* ── 5. visuals (60→70) — id lar, langarlar, bloklar ── */
  stage(60, "Jadval va sxemalar");
  const sections: DocSection[] = [];
  const tables: DocTable[] = [];
  const figures: Figure[] = [];
  const chapters: WorkChapter[] = [];

  sections.push({ id: "intro", title: labels.intro, blocks: intro.blocks });
  if (!intro.blocks.length) guard.emptySections.push("intro");

  const byId = new Map(written.map((w) => [w.plan.id, w]));
  for (const c of outline.chapters) {
    const model: WorkChapter = { id: c.id, title: c.title, paragraphs: [] };
    // Bob sarlavhasi — MATNSIZ bo'lim; raqamni (`1-BOB.`) WP-C maketi qo'yadi.
    sections.push({ id: c.id, title: c.title, blocks: [] });
    for (const p of c.paragraphs) {
      const w = byId.get(p.id);
      if (!w) continue;
      const blocks = [...w.blocks];
      if (!blocks.length) guard.emptySections.push(p.id);
      const inserts: { at: number; block: Block }[] = [];
      if (w.figure && figures.length < WORK_LIMITS.figures) {
        const id = `f${figures.length + 1}`;
        figures.push({ id, kind: "scheme", caption: w.figure.caption, spec: w.figure.spec, w: FIGURE_W, h: FIGURE_H, source: labels.byAuthor });
        inserts.push({ at: w.figure.after, block: { kind: "figure", text: w.figure.caption, figureId: id } });
      }
      if (w.table && tables.length < WORK_LIMITS.tables) {
        const id = `t${tables.length + 1}`;
        tables.push({ id, ...w.table.table, anchor: p.id });
        inserts.push({ at: w.table.after, block: { kind: "tableRef", text: w.table.table.caption ?? "", tableId: id } });
      }
      for (const ins of inserts.sort((a, b) => b.at - a.at)) {
        const at = Math.max(0, Math.min(blocks.length - 1, ins.at));
        blocks.splice(blocks.length ? at + 1 : 0, 0, ins.block);
      }
      sections.push({ id: p.id, title: p.title, blocks });
      model.paragraphs.push({ id: p.id, title: p.title, sectionId: p.id });
      guard.removedCitations += w.report.removedCitations.length;
      guard.unsourcedNumbers.push(...w.report.unsourcedNumbers);
      guard.filler.push(...w.report.filler);
    }
    chapters.push(model);
  }
  stage(70, `Vizuallar: ${figures.length} sxema, ${tables.length} jadval`);

  /* ── 6. conclusion (70→76) ── */
  stage(70, "Xulosa yozilmoqda");
  const tasks = taskList(introDraft.tasks ?? "", intro.blocks);
  const summaries = sections
    .filter((s) => s.blocks.length && !isChapterHeadId(s.id) && s.id !== "intro")
    .map((s) => summaryOf(s))
    .join("\n");
  const conclusion = await writeConclusion(ctx, tasks, summaries, system, ask, deadline);
  sections.push({ id: "conclusion", title: labels.conclusion, blocks: conclusion.blocks });
  if (!conclusion.blocks.length) guard.emptySections.push("conclusion");
  guard.unsourcedNumbers.push(...conclusion.report.unsourcedNumbers);
  guard.filler.push(...conclusion.report.filler);
  stage(76, "Xulosa tayyor");

  /* ── 7. references (76→80) ── */
  stage(76, "Adabiyotlar tekshirilmoqda");
  const verified = verifyCitations(sections, ctx.refs);
  guard.unresolved = verified.unresolved;
  guard.removedCitations += verified.removed;
  const citedIds = new Set(verified.refs.filter((r) => r.cited).map((r) => r.id));
  const index = new Map(verified.refs.map((r) => [r.id, r]));
  const refIndex = referenceIndex(verified.refs);
  for (const t of tables) {
    const keep = (id: string) => {
      citedIds.add(id);
      const r = index.get(id);
      if (r) r.cited = true;
    };
    if (t.caption) t.caption = verifyCitationsInText(t.caption, refIndex, { onKeep: keep });
    t.rows = t.rows.map((row) => row.map((c) => verifyCitationsInText(c, refIndex, { onKeep: keep })));
  }
  // Rasm sarlavhasi blok matni bilan bir xil qolsin.
  for (const s of verified.sections) for (const b of s.blocks) if (b.kind === "figure") {
    const f = figures.find((x) => x.id === b.figureId);
    if (f) f.caption = b.text;
  }
  const cited = citedOnly(verified.refs.map((r) => ({ ...r, cited: r.cited || citedIds.has(r.id) })));
  const refs = await orderReferences(cited);
  guard.missingFactNumbers = missingFactNumbers(verified.sections, input.userFacts);

  /* Sxemalarni CHIZISH — maket buzilsa `fallbackBlocks` (raqamlangan ro'yxat). */
  if (figures.length) {
    const draw = opts.buildFigures ?? (await defaultBuildFigures());
    if (draw) {
      const built = await draw(figures, { lang: input.language });
      figures.splice(0, figures.length, ...built);
      const drawn = built.filter((f) => f.url).length;
      if (drawn < built.length) console.warn(`[work] ${built.length - drawn} ta sxema maketlanmadi — ro'yxat sifatida qoldi`);
    }
  }
  if (guard.unresolved.length) console.warn(`[work] reyestrda yo'q iqtibos o'chirildi: ${guard.unresolved.map((u) => u.id).join(", ")}`);
  if (guard.unsourcedNumbers.length) console.warn(`[work] manbasiz foizlar: ${guard.unsourcedNumbers.join(", ")}`);
  if (guard.missingIntroParts.length) console.warn(`[work] kirishda yo'q elementlar: ${guard.missingIntroParts.join(", ")}`);
  stage(80, `Adabiyotlar: ${refs.length} ta`);

  /* ── hujjat ── */
  const introReport = intakeCheck(kind.introParts, verified.sections.find((s) => s.id === "intro")?.blocks ?? [], introDraft);
  const work: WorkModel = {
    v: 1,
    genre,
    kind: kind.id,
    subject: subject.id,
    language: input.language,
    ...(input.topic ? { title: input.topic } : {}),
    university: input.university,
    faculty: input.faculty,
    department: input.department,
    subjectName: input.subjectName,
    group: input.group,
    course: input.course,
    author: input.author,
    teacher: input.teacher,
    ...(input.teacherDegree ? { teacherDegree: input.teacherDegree } : {}),
    city: input.city,
    ministry: input.ministry,
    ...(input.ministryCustom ? { ministryCustom: input.ministryCustom } : {}),
    chapters,
    intro: { parts: introReport.parts },
    references: refs,
    figures,
    ...(input.userFacts ? { userFacts: input.userFacts } : {}),
    refsMin: input.refsMin,
    polishAccept: WORK_ACCEPT_DELTA,
  };
  const anyUnverified = refs.some((r) => r.verified === "unverified");
  let doc: AcademicDoc = {
    meta: docMeta,
    titlePage: true,
    toc: true,
    sections: verified.sections,
    ...(tables.length ? { tables } : {}),
    ...(refs.length ? { references: refs.map((r) => formatRefLine(r).replace(/^\[[^\]]+\]\s*/, "")) } : {}),
    ...(anyUnverified ? { referencesNote: unverifiedReferenceNote(input.language) } : {}),
    work,
  };

  /* ── 8. review (80→88) ── */
  stage(80, "Tayyorlik hisoboti");
  try {
    const review = await reviewWork(doc, {
      research: research.stats,
      guard: { unresolved: guard.unresolved, emptySections: guard.emptySections },
      complete,
      deadline,
      now,
      onUsage: (u) => {
        meter.add(u);
        opts.onUsage?.(u);
      },
    });
    review.userNeeds = workUserNeeds(review, doc);
    work.review = review;
    stage(88, `Hisobot: ${review.score} ball`);
  } catch (e) {
    console.warn("[work] tayyorlik hisoboti tuzilmadi:", e instanceof Error ? e.message : e);
    stage(88, "Hisobotsiz davom etildi");
  }

  /* ── 9. polish (88→94) ── */
  const wantPolish = opts.polish ?? process.env.WORK_POLISH !== "0";
  if (wantPolish && work.review) {
    const review = work.review;
    const left = remainingMs(deadline);
    const bigPackage = pagesMid(input.pages) > WORK_POLISH_MAX_PAGES;
    if (review.score >= WORK_POLISH_BELOW) {
      // Yetarli — sayqal kerak emas.
    } else if (bigPackage || left < WORK_POLISH_MIN_MS) {
      review.polish = { before: review.score, after: review.score, applied: [], skipped: [{ id: "budget", reason: "budget" }], accepted: false, at: now.toISOString() };
      console.warn(`[work] avto-sayqal o'tkazib yuborildi: ${bigPackage ? `${input.pages} paketi` : `byudjetdan ${Math.round(left / 1000)} s qoldi`}`);
    } else {
      stage(88, "Avto-sayqal");
      try {
        const r = await runWorkPolish(doc, review, {
          complete,
          deadline,
          judge: true,
          now,
          research: research.stats,
          guard: { unresolved: guard.unresolved, emptySections: guard.emptySections },
          onUsage: (u) => {
            meter.add(u);
            opts.onUsage?.(u);
          },
        });
        doc = r.doc;
        if (doc.work) doc.work.review = r.review;
        if (r.accepted) {
          guard.unresolved = guard.unresolved.filter((u) => !r.applied.some((f) => f.target === u.sectionId));
          stage(94, `Sayqal: ${r.log.before} → ${r.log.after} ball`);
        } else stage(94, r.log.applied.length ? `Sayqal ballni oshirmadi (${r.log.before})` : `Hisobot: ${r.log.before} ball`);
      } catch (e) {
        console.warn("[work] avto-sayqal yiqildi:", e instanceof Error ? e.message : e);
        stage(94, "Sayqalsiz davom etildi");
      }
    }
  }
  return { doc, cost: meter.toJson(), research: research.stats, guard };
}

/* ────────────────────────── manbalar ────────────────────────── */

async function collectWorkReferences(ctx: WorkContext, opts: WorkBuildOpts, meter: CostMeter): Promise<WorkCollectResult> {
  const { input, kind, subject } = ctx;
  const ask: WorkResearchAsk = {
    topic: input.topic,
    keywords: workResearchKeywords(ctx),
    language: input.language,
    userRefs: input.userRefs,
    research: true,
    want: { min: input.refsMin, max: Math.min(WORK_LIMITS.refs, Math.max(input.refsMin, input.refsMin * 2)) },
    kinds: subject.research.kinds,
    ...(subject.research.quota ? { quota: subject.research.quota } : {}),
    ...(input.userFacts ? { userFacts: input.userFacts } : {}),
    typeLabel: kind.label.en,
  };
  if (opts.research) return opts.research(ask);
  /*
   * WP-B (`collectReferencesFor`) — DINAMIK import: u hali birlashmagan
   * bo'lsa dvigatel manbasiz davom etadi (hisobotda `refsCount` qizil va
   * «Sizdan kutiladi» bandi), ya'ni ish yiqilmaydi va uydirma manba ham
   * chiqmaydi.
   */
  try {
    const mod = (await import("../research/pipeline")) as unknown as {
      collectReferencesFor?: (a: WorkResearchAsk, o: Record<string, unknown>) => Promise<WorkCollectResult>;
    };
    if (typeof mod.collectReferencesFor === "function") {
      return await mod.collectReferencesFor(ask, {
        deadline: opts.deadline,
        complete: opts.complete ?? completeRole,
        fetchImpl: opts.fetchImpl,
        retryBaseMs: opts.retryBaseMs,
        onUsage: (u: LlmUsage | undefined) => {
          meter.add(u);
          if (u) opts.onUsage?.(u);
        },
      });
    }
    console.warn("[work] research/pipeline.collectReferencesFor hali yo'q (WP-B) — manbasiz davom etildi");
  } catch (e) {
    console.warn("[work] manba quvuri yuklanmadi:", e instanceof Error ? e.message : e);
  }
  return { refs: [], stats: { ...EMPTY_RESEARCH_STATS, user: ctx.input.userRefs.length } };
}

/**
 * Ro'yxat tartibi — O'zbekiston qoidasi (`cite/order.ts orderUzReferences`,
 * WP-B): qonun → VM/vazirlik → kitob → maqola → statistika → internet.
 * Funksiya hali yo'q bo'lsa MAVJUD tartib qoladi (hisobot `refsOrder`
 * bandida sariq bo'lmaydi — u ham shu funksiyaga qaraydi).
 */
async function orderReferences(refs: Reference[]): Promise<Reference[]> {
  try {
    const mod = (await import("../cite/index")) as unknown as { orderUzReferences?: (r: Reference[]) => Reference[] };
    if (typeof mod.orderUzReferences === "function") return mod.orderUzReferences(refs);
  } catch {
    /* WP-B hali birlashmagan — mavjud tartib */
  }
  return refs;
}

/* ────────────────────────── kirish ────────────────────────── */

type Ask = (role: Parameters<CompleteFn>[0], system: string, user: string, o: { maxTokens: number; timeoutMs: number }) => Promise<string | null>;

type IntroOut = { blocks: Block[]; report: SectionGuardReport; parts: Partial<Record<WorkIntroPartId, string>> };

const EMPTY_REPORT: SectionGuardReport = { removedCitations: [], citations: 0, unsourcedNumbers: [], factNumbersFound: [], filler: [], words: 0, wordRangeOk: true };

/**
 * Kirish: model har MAJBURIY element uchun alohida matn beradi. Element
 * yo'qolsa BIR MARTA qayta so'raladi (faqat yo'qolganlari) — shundan
 * keyin ham topilmasa hisobot `introParts` bandi qizil bo'ladi va
 * «Sizdan kutiladi» ga tushmaydi (AI o'zi yozadigan narsa).
 */
async function writeIntro(
  ctx: WorkContext,
  outline: WorkOutlinePlan,
  draft: Partial<Record<WorkIntroPartId, string>>,
  system: string,
  call: Ask,
  deadline: number,
  guard: WorkGuardSummary,
): Promise<IntroOut> {
  const gopts = { refs: ctx.refs, userFacts: ctx.input.userFacts };
  const parts: Partial<Record<WorkIntroPartId, string>> = { ...draft };
  const maxTokens = Math.min(6000, Math.max(1200, Math.round(ctx.plan.intro * 2.4) + 600));

  const fetchParts = async (missing?: WorkIntroPartId[]) => {
    const raw = await call("writer", system, workIntroPrompt(ctx, outline, missing), { maxTokens, timeoutMs: Math.min(INTRO_TIMEOUT_MS, remainingMs(deadline)) });
    if (!raw) return;
    const j = parseLlmObject<{ parts?: Record<string, unknown>; blocks?: unknown }>(raw);
    const got = (j?.parts ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(got)) {
      const t = String(v ?? "").trim();
      if (t) parts[k as WorkIntroPartId] = t.slice(0, 4000);
    }
    // Model `parts` o'rniga `blocks` bergan bo'lsa ham matn yo'qolmasin.
    if (!Object.keys(got).length) {
      const blocks = blocksFromLlm(j?.blocks, raw);
      if (blocks.length) parts.relevance = [parts.relevance, blocks.map((b) => b.text).join("\n\n")].filter(Boolean).join("\n\n");
    }
  };

  await fetchParts();
  let check = intakeCheck(ctx.kind.introParts, partsToBlocks(ctx, parts), parts);
  if (check.missing.length && remainingMs(deadline) > 20_000) {
    guard.introRetried = true;
    console.warn(`[work] kirishda yo'q elementlar — qayta so'rov: ${check.missing.join(", ")}`);
    await fetchParts(check.missing);
    check = intakeCheck(ctx.kind.introParts, partsToBlocks(ctx, parts), parts);
  }
  guard.missingIntroParts = check.missing;

  const guarded = guardSection(partsToBlocks(ctx, parts), gopts);
  return { blocks: guarded.blocks, report: guarded.report, parts };
}

/** Kirish elementlari → bloklar (tur tartibida; noma'lum elementlar oxirida). */
function partsToBlocks(ctx: WorkContext, parts: Partial<Record<WorkIntroPartId, string>>): Block[] {
  const order = [...ctx.kind.introParts, ...(Object.keys(parts) as WorkIntroPartId[]).filter((p) => !ctx.kind.introParts.includes(p))];
  const seen = new Set<string>();
  const out: Block[] = [];
  for (const p of order) {
    if (seen.has(p)) continue;
    seen.add(p);
    const t = String(parts[p] ?? "").trim();
    if (!t) continue;
    for (const piece of t.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean)) out.push({ kind: "p", text: piece });
  }
  return out;
}

/** Kirishdagi vazifalar ro'yxati — xulosa promptiga (har vazifaga javob). */
export function taskList(tasksText: string, introBlocks: Block[]): string[] {
  const src = tasksText.trim() || introBlocks.map((b) => b.text).join("\n");
  const out: string[] = [];
  for (const raw of src.split(/\n|;|(?<=[a-zа-яo‘’'])\s*[-–—]\s+/u)) {
    const t = raw.replace(/^\s*[\d)\].•-]+\s*/, "").replace(/\s+/g, " ").trim();
    if (t.length >= 15 && t.length <= 300) out.push(t);
    if (out.length >= 6) break;
  }
  return out;
}

/* ────────────────────────── paragraf ────────────────────────── */

async function writeParagraph(ctx: WorkContext, ask: WorkSectionAsk, system: string, call: Ask, deadline: number, figureSpecOf: FigureSpecFn): Promise<ParagraphOut> {
  const gopts = { refs: ctx.refs, userFacts: ctx.input.userFacts };
  const maxTokens = Math.min(8000, Math.max(1200, Math.round(ask.plan.words * 2.4) + 700));
  const empty: ParagraphOut = { plan: ask.plan, blocks: [], report: { ...EMPTY_REPORT } };

  const parseOne = (raw: string | null) => {
    if (!raw) return null;
    const j = parseLlmObject<SectionJson>(raw);
    const blocks = blocksFromLlm(j?.blocks, raw);
    if (!blocks.length) return null;
    const table = ask.wantTable ? tableFromLlm(j?.table) ?? undefined : undefined;
    let figure: ParagraphOut["figure"];
    if (ask.wantFigure && j?.figure && typeof j.figure === "object") {
      const spec = figureSpecOf(j.figure.spec, ctx.input.figureKinds);
      const caption = str(j.figure.caption, 200);
      if (spec && caption && spec.kind !== "chart") {
        figure = { caption, spec, after: Number.isInteger(Number(j.figure.anchorAfterBlock)) ? Number(j.figure.anchorAfterBlock) : 0 };
      }
    }
    return { blocks, table, figure };
  };

  let first = parseOne(await call("writer", system, workParagraphPrompt(ctx, ask), { maxTokens, timeoutMs: paragraphTimeout(ask.plan.words, deadline) }));
  if (!first && remainingMs(deadline) > 20_000) {
    console.warn(`[work] «${ask.plan.id}»: javob yaroqsiz — qayta so'rov`);
    first = parseOne(await call("writer", system, workParagraphPrompt(ctx, ask), { maxTokens, timeoutMs: paragraphTimeout(ask.plan.words, deadline) }));
  }
  if (!first) return empty;
  const guarded = guardSection(first.blocks, gopts);
  return { plan: ask.plan, blocks: guarded.blocks, table: first.table, figure: first.figure, report: guarded.report };
}

type RawTable = { caption?: unknown; headers?: unknown; rows?: unknown; anchorAfterBlock?: unknown; source?: unknown };

/** Jadval JSON → `DocTable` (id/langar dvigatel qo'yadi); yaroqsiz → null. */
export function tableFromLlm(raw: unknown): { table: Omit<DocTable, "id" | "anchor">; after: number; source?: string } | null {
  const t = raw as RawTable | null;
  if (!t || typeof t !== "object") return null;
  const headers = (Array.isArray(t.headers) ? t.headers : []).map((h) => str(h, 80)).filter(Boolean).slice(0, 6);
  if (headers.length < 2) return null;
  const rows = (Array.isArray(t.rows) ? t.rows : [])
    .filter((r): r is unknown[] => Array.isArray(r))
    .map((r) => headers.map((_, i) => str(r[i], 220)))
    .filter((r) => r.some(Boolean))
    .slice(0, 12);
  if (rows.length < 1) return null;
  const caption = str(t.caption, 200);
  const after = Number.isInteger(Number(t.anchorAfterBlock)) ? Number(t.anchorAfterBlock) : 0;
  const source = str(t.source, 200);
  return { table: { caption: caption || undefined, headers, rows }, after, ...(source ? { source } : {}) };
}

/* ────────────────────────── xulosa ────────────────────────── */

async function writeConclusion(ctx: WorkContext, tasks: string[], summaries: string, system: string, call: Ask, deadline: number) {
  const gopts = { refs: ctx.refs, userFacts: ctx.input.userFacts };
  const maxTokens = Math.min(6000, Math.max(1200, Math.round(ctx.plan.conclusion * 2.4) + 600));
  const raw = await call("writer", system, workConclusionPrompt(ctx, tasks, summaries), { maxTokens, timeoutMs: Math.min(CONCLUSION_TIMEOUT_MS, remainingMs(deadline)) });
  const blocks = raw ? blocksFromLlm(parseLlmObject<SectionJson>(raw)?.blocks, raw) : [];
  if (!blocks.length) return { blocks: [] as Block[], report: { ...EMPTY_REPORT } };
  const guarded = guardSection(blocks, gopts);
  return { blocks: guarded.blocks, report: guarded.report };
}

/* ────────────────────────── kichik yordamchilar ────────────────────────── */

function summaryOf(s: DocSection, max = 380): string {
  const text = s.blocks
    .filter((b) => b.kind === "p" || b.kind === "li")
    .map((b) => b.text)
    .join(" ");
  return `• ${s.title}: ${text.slice(0, max)}${text.length > max ? "…" : ""}`;
}

/**
 * Sxema SPETSIFIKATSIYASI tekshiruvi — maqola dvigatelidagi
 * `figureSpecFromLlm` (10 tur chegarasi, `figureKinds` oq ro'yxati)
 * QAYTA ishlatiladi, ikkinchi nusxa yozilmaydi. Nega DINAMIK:
 * `article/engine.ts` `figures/` (sharp) ni statik tortadi, `work/**`
 * esa izomorf qolishi kerak. Yuklanmasa sxema tushib qoladi — hisobot
 * `visualRef` bandi buni ko'rsatadi, ish yiqilmaydi.
 */
type FigureSpecFn = (raw: unknown, kinds: readonly string[]) => FigureSpec | null;

async function loadFigureSpec(): Promise<FigureSpecFn> {
  try {
    const mod = await import("../article/engine");
    return (raw, kinds) => mod.figureSpecFromLlm(raw, { figureKinds: kinds as never });
  } catch (e) {
    console.warn("[work] sxema tekshiruvi yuklanmadi:", e instanceof Error ? e.message : e);
    return () => null;
  }
}

/**
 * Sxema chizuvchisi — DINAMIK import: `figures/png.ts` `sharp` ni
 * tortadi (server-only), dvigatelning o'zi esa izomorf qoladi va
 * testlar uni stub bilan almashtiradi.
 */
async function defaultBuildFigures(): Promise<((f: Figure[], o: { lang: string }) => Promise<Figure[]>) | null> {
  try {
    const mod = await import("../figures");
    return mod.buildFigures;
  } catch (e) {
    console.warn("[work] sxema generatori yuklanmadi:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Yuklangan fayldan matn — tarjima ekstraktori orqali (bo'sh bo'lsa ""). */
async function sourceTextOf(source: TranslationSource): Promise<string> {
  try {
    const { extractSegments } = await import("../translate/index");
    const ex = await extractSegments(source.kind, source.bytes);
    return ex.segments.map((s) => s.text).join("\n\n").slice(0, WORK_LIMITS.sourceTextChars);
  } catch (e) {
    console.warn("[work] manba fayl o'qilmadi:", e instanceof Error ? e.message : e);
    return "";
  }
}

export { workWordPlan } from "./plan";
export type { WorkKind };
