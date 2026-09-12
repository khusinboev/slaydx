/**
 * Maqola DVIGATELI (Maqola 2, AUDIT-17) — `buildArticleDoc`.
 *
 * Bosqichlar (`onStage` foizlari reja bo'yicha):
 *   1 research    0→12   `collectReferences` — foydalanuvchi manbalari + OpenAlex/Crossref
 *   2 outline    12→18   tur skeleti → bo'lim rejasi JSON
 *   3 sections   18→62   `mapPool(3)`, har bo'lim manbalar ro'yxatini ko'radi, `[W…]` iqtibos
 *   4 visuals    62→74   jadval (langar) + sxema SPEC (PNG ni WP3 chizadi)
 *   5 abstracts  74→82   uz + ru + en MUSTAQIL, kalit so'zlar; highlights (Elsevier)
 *   6 references 82→86   `verifyCitations` → cited-only; PRISMA (sistematik sharh)
 *   7 review     88→94   `review.ts` qoidalar + `judge` → `doc.article.review` (xatoda hisobotsiz)
 *   (8 render — `index.ts`/`render-docx`.)
 *
 * Yagona manba qarori (D-1): matn `sections` da, metama'lumot `doc.article`
 * da; tartib/raqamlash `layout.ts planArticle` (WP2). Bu fayl raqam
 * QO'YMAYDI (1-rasm, [1]) — faqat id lar (`f1`, `t1`, `W…`).
 *
 * `null` — LLM yo'q (kalitsiz muhit): `index.ts` shablon yo'liga o'tadi.
 * Bo'sh bo'lim/annotatsiya XATO EMAS: hujjat qaytadi, `structure.ts`
 * darvozasi (`hard` bo'limlar, annotatsiya, PRISMA) uni yiqitadi va
 * kredit qaytadi — «yarim maqola» `COMPLETED` bo'lmaydi.
 */
import type { FormValues } from "../../types";
import { buildFigures } from "../figures";
import type { AcademicDoc, Block, DocMeta, DocSection, DocTable } from "../types";
import type { TranslationSource } from "../source-types";
import { llmEnabled } from "../llm";
import { CostMeter, complete as completeRole } from "../llm-roles";
import { parseLlmObject } from "../json";
import { mapPool, remainingMs, unverifiedReferenceNote } from "../quality";
import { abstractFromLlm, blocksFromLlm, clipWords, str } from "./parse";
import { articleWordPlan } from "./plan";
import { ARTICLE_LIMITS, type ArticleModel, type ArticleWordPlan, type Figure, type FigureSpec, type TreeNode } from "./types";
import { ARTICLE_TYPES } from "./types-registry";
import { PUBLICATION_PROFILES } from "./profiles";
import { articleLabels } from "./labels";
import { articleInputFromValues, type ArticleInput } from "./input";
import {
  abstractPrompt,
  abstractSystemPrompt,
  articleSystemPrompt,
  expandPrompt,
  formatRefLine,
  highlightsPrompt,
  outlinePrompt,
  sectionPrompt,
  wordRangePrompt,
  type ArticleContext,
  type SectionAsk,
  type SectionPlan,
} from "./prompts";
import { guardSection, missingFactNumbers, skeletonCoverage, type SectionGuardReport } from "./guard";
import { reviewArticle } from "./review";
import { collectReferences, type CompleteFn, type ResearchStats } from "../research/pipeline";
import { citedOnly, referenceIndex, verifyCitations, verifyCitationsInText, type Unresolved } from "../research/verify";

export type ArticleStage = { progress: number; step: string };

export type ArticleBuildOpts = {
  deadline: number;
  /** Yuklangan fayl (worker `sourceForJob`); `meta.sourceText` bo'sh bo'lsa shundan olinadi. */
  source?: TranslationSource;
  onStage?: (ev: ArticleStage) => void;
  /** Test seam — rol bo'yicha LLM. */
  complete?: CompleteFn;
  /** Test seam — OpenAlex/Crossref. */
  fetchImpl?: typeof fetch;
  retryBaseMs?: number;
};

export type ArticleCost = ReturnType<CostMeter["toJson"]>;

/** Hisobot (WP5) va jonli sinov uchun jamlanma. */
export type ArticleGuardSummary = {
  removedCitations: number;
  unresolved: Unresolved[];
  unsourcedNumbers: string[];
  missingFactNumbers: string[];
  filler: string[];
  expanded: string[];
  rewrittenForRange: string[];
  emptySections: string[];
};

export type ArticleBuildResult = { doc: AcademicDoc; cost: ArticleCost; research: ResearchStats; guard: ArticleGuardSummary };

/* ────────────────────────── vaqt va hajm byudjeti ────────────────────────── */

/** Bo'lim chaqiruvi: 20 s + so'z boshiga 40 ms, 35–90 s oralig'ida. */
const sectionTimeout = (words: number, deadline: number) => Math.min(Math.max(35_000, 20_000 + words * 40), 90_000, remainingMs(deadline));
const OUTLINE_TIMEOUT_MS = 30_000;
const ABSTRACT_TIMEOUT_MS = 30_000;
/** Chaqiruvga shundan kam vaqt qolsa umuman urinilmaydi. */
const MIN_CALL_MS = 8_000;
/** Bo'lim so'zi rejaning shu ulushidan kam bo'lsa bir marta «kengaytir». */
const EXPAND_BELOW = 0.7;
/** Rasm uchun taxminiy piksel o'lchami (160 mm × 300 dpi); WP3 haqiqiy o'lchamni qo'yadi. */
const FIGURE_W = 1890;
const FIGURE_H = 1100;

export { articleWordPlan, articleWordsPerPage } from "./plan";
export type { ArticleWordPlan };

/* ────────────────────────── yordamchilar ────────────────────────── */

// Model javobi parserlari — `parse.ts` (izomorf); eski importlar shu yerdan ishlaydi.
export { abstractFromLlm, blocksFromLlm } from "./parse";

type RawTable = { caption?: unknown; headers?: unknown; rows?: unknown; anchorAfterBlock?: unknown };

/** Jadval JSON → `DocTable` (id/langar dvigatel qo'yadi); yaroqsiz → null. */
export function tableFromLlm(raw: unknown): { table: Omit<DocTable, "id" | "anchor">; after: number } | null {
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
  return { table: { caption: caption || undefined, headers, rows }, after };
}

function treeOf(raw: unknown, depth: number, budget: { n: number }): TreeNode | null {
  if (!raw || typeof raw !== "object" || depth > 3 || budget.n <= 0) return null;
  const label = str((raw as { label?: unknown }).label, 60);
  if (!label) return null;
  budget.n--;
  const node: TreeNode = { label };
  const kids = (raw as { children?: unknown }).children;
  if (Array.isArray(kids)) {
    const children = kids.map((k) => treeOf(k, depth + 1, budget)).filter((k): k is TreeNode => Boolean(k));
    if (children.length) node.children = children;
  }
  return node;
}

/**
 * Sxema spetsifikatsiyasini tekshiradi/tozalaydi. Chegaralar
 * `ARTICLE_LIMITS` (14 tugun / 24 qirra). `chart` faqat foydalanuvchi
 * ma'lumoti bilan — ma'lumot VERBATIM foydalanuvchidan ko'chiriladi,
 * model raqami e'tiborsiz. `prisma` bu yerda qabul qilinmaydi (dvigatel
 * uni statistikadan o'zi quradi).
 */
export function figureSpecFromLlm(raw: unknown, input: Pick<ArticleInput, "userData">): FigureSpec | null {
  const s = raw as Record<string, unknown> | null;
  if (!s || typeof s !== "object") return null;
  const kind = String(s.kind ?? "");
  if (kind === "flow") {
    const nodes = (Array.isArray(s.nodes) ? s.nodes : [])
      .map((n) => {
        const o = n as Record<string, unknown>;
        const id = str(o?.id, 24);
        const label = str(o?.label, 70);
        if (!id || !label) return null;
        const k = String(o.kind ?? "");
        return { id, label, ...(k === "start" || k === "end" || k === "decision" || k === "data" || k === "step" ? { kind: k as "start" } : {}) };
      })
      .filter((n): n is NonNullable<typeof n> => Boolean(n))
      .slice(0, ARTICLE_LIMITS.figureNodes);
    if (nodes.length < 2) return null;
    const ids = new Set(nodes.map((n) => n.id));
    const edges = (Array.isArray(s.edges) ? s.edges : [])
      .map((e) => {
        const o = e as Record<string, unknown>;
        const from = str(o?.from, 24);
        const to = str(o?.to, 24);
        if (!ids.has(from) || !ids.has(to) || from === to) return null;
        const label = str(o.label, 40);
        return { from, to, ...(label ? { label } : {}) };
      })
      .filter((e): e is NonNullable<typeof e> => Boolean(e))
      .slice(0, ARTICLE_LIMITS.figureEdges);
    if (!edges.length) return null;
    return { kind: "flow", direction: s.direction === "LR" ? "LR" : "TB", nodes, edges };
  }
  if (kind === "process") {
    const steps = (Array.isArray(s.steps) ? s.steps : []).map((x) => str(x, 80)).filter(Boolean).slice(0, ARTICLE_LIMITS.figureNodes);
    return steps.length >= 2 ? { kind: "process", steps } : null;
  }
  if (kind === "tree") {
    const root = str(s.root, 70);
    const budget = { n: ARTICLE_LIMITS.figureNodes };
    const children = (Array.isArray(s.children) ? s.children : []).map((c) => treeOf(c, 1, budget)).filter((c): c is TreeNode => Boolean(c));
    return root && children.length ? { kind: "tree", root, children } : null;
  }
  if (kind === "chart") {
    const d = input.userData;
    if (!d) return null;
    const chart = s.chart === "line" ? "line" : s.chart === "pie" ? "pie" : "bar";
    const spec: FigureSpec = { kind: "chart", chart, dataSource: "user", categories: [...d.categories], series: d.series.map((x) => ({ name: x.name, values: [...x.values] })) };
    if (d.unit) spec.unit = d.unit;
    return spec;
  }
  return null;
}

/** Bo'lim matnining qisqa ko'rinishi (annotatsiya/highlights prompti uchun). */
function summaryOf(s: DocSection, max = 380): string {
  const text = s.blocks
    .filter((b) => b.kind === "p" || b.kind === "li")
    .map((b) => b.text)
    .join(" ");
  return `• ${s.title}: ${text.slice(0, max)}${text.length > max ? "…" : ""}`;
}

/* ────────────────────────── reja (outline) ────────────────────────── */

type RawOutline = { sections?: { id?: unknown; title?: unknown; brief?: unknown; words?: unknown }[] };

/** Deterministik reja — model javob bermasa yoki rejani buzsa. */
export function fallbackOutline(ctx: ArticleContext): SectionPlan[] {
  const { type, labels: L, input } = ctx;
  const out: SectionPlan[] = [];
  for (const s of type.skeleton) {
    const words = Math.max(60, Math.round((ctx.wordTarget * s.sharePct) / 100));
    if (s.id === "body" && type.freeSections) {
      const n = type.freeSections.min;
      for (let i = 1; i <= n; i++) {
        out.push({ id: `body-${i}`, skeletonId: "body", title: `${L.section.body} ${i}`, brief: `${input.topic} — ${i}-jihat`, words: Math.round(words / n), hard: Boolean(s.hard) });
      }
      continue;
    }
    if (!s.required) continue;
    out.push({ id: s.id, skeletonId: s.id, title: L.section[s.titleKey], brief: `${L.section[s.titleKey]} — «${input.topic}»`, words, hard: Boolean(s.hard) });
  }
  return out;
}

/**
 * Model rejasini skeletga MOSLAYDI: skelet id lari (va `body-N`)
 * dan boshqasi tashlanadi, `hard`/`required` yo'qolgan bo'lsa qo'shiladi,
 * sarlavha skeletdagi (kod yozadi; erkin bo'limlarda modelniki),
 * so'zlar ulushga qarab qayta taqsimlanadi.
 */
export function outlineFromLlm(raw: string | undefined, ctx: ArticleContext): SectionPlan[] {
  const { type, labels: L } = ctx;
  const parsed = parseLlmObject<RawOutline>(raw ?? "");
  const list = Array.isArray(parsed?.sections) ? parsed!.sections : [];
  const bySkeleton = new Map(type.skeleton.map((s) => [s.id, s]));
  const plans: SectionPlan[] = [];
  let freeN = 0;
  for (const item of list) {
    const id = str(item?.id, 32).toLowerCase().replace(/\s+/g, "");
    const brief = str(item?.brief, 400);
    const title = str(item?.title, 120);
    const free = type.freeSections && (id === "body" || /^body-\d+$/.test(id));
    if (free) {
      if (freeN >= type.freeSections!.max) continue;
      freeN++;
      plans.push({ id: `body-${freeN}`, skeletonId: "body", title: title || `${L.section.body} ${freeN}`, brief, words: 0, hard: Boolean(bySkeleton.get("body")?.hard) });
      continue;
    }
    const sk = bySkeleton.get(id);
    if (!sk || plans.some((p) => p.id === id)) continue;
    plans.push({ id, skeletonId: id, title: L.section[sk.titleKey], brief, words: 0, hard: Boolean(sk.hard) });
  }
  // Yo'qolgan majburiy bo'limlar — skelet tartibida qo'shiladi.
  const fallback = fallbackOutline(ctx);
  for (const f of fallback) {
    const present = plans.some((p) => p.skeletonId === f.skeletonId);
    if (!present) plans.push(f);
  }
  if (type.freeSections && freeN && freeN < type.freeSections.min) {
    for (let i = freeN + 1; i <= type.freeSections.min; i++) {
      plans.push({ id: `body-${i}`, skeletonId: "body", title: `${L.section.body} ${i}`, brief: `${ctx.input.topic} — ${i}-jihat`, words: 0, hard: Boolean(bySkeleton.get("body")?.hard) });
    }
  }
  // Skelet tartibi (erkin bo'limlar `body` o'rnida).
  const order = new Map(type.skeleton.map((s, i) => [s.id, i]));
  plans.sort((a, b) => (order.get(a.skeletonId) ?? 99) - (order.get(b.skeletonId) ?? 99) || a.id.localeCompare(b.id, undefined, { numeric: true }));
  // So'z taqsimoti — skelet ulushi (erkin bo'limlar orasida teng).
  const bodyCount = plans.filter((p) => p.skeletonId === "body").length || 1;
  for (const p of plans) {
    const share = bySkeleton.get(p.skeletonId)?.sharePct ?? 10;
    const words = Math.round((ctx.wordTarget * share) / 100);
    p.words = Math.max(60, p.skeletonId === "body" && type.freeSections ? Math.round(words / bodyCount) : words);
    if (!p.brief) p.brief = `${p.title} — «${ctx.input.topic}»`;
  }
  return plans;
}

/* ────────────────────────── vizual reja ────────────────────────── */

export type VisualPlan = Map<string, { table: boolean; figure: boolean; chart: boolean }>;

/**
 * Qaysi bo'limda jadval/sxema so'raladi. Deterministik: sxemalar eng
 * katta ulushli o'rta bo'limlarga (kirish/xulosa emas), jadval — natija/
 * tahlil/metod bo'limiga; tezisda vizual yo'q; CARE da Timeline jadvali
 * majburiy. PRISMA bu yerda EMAS — dvigatel statistikadan quradi.
 */
export function planVisuals(ctx: ArticleContext, plans: SectionPlan[]): VisualPlan {
  const out: VisualPlan = new Map(plans.map((p) => [p.id, { table: false, figure: false, chart: false }]));
  const { type, input } = ctx;
  const tiny = Boolean(type.wordRange && type.wordRange[1] <= 300) || input.pages === "1-2";
  const middle = plans.filter((p) => p.skeletonId !== "intro" && p.skeletonId !== "conclusion" && p.skeletonId !== "consent" && p.skeletonId !== "perspective");
  const bySize = [...middle].sort((a, b) => b.words - a.words);
  // Jadval: Timeline (CARE) majburiy; aks holda 1 ta — natija/tahlil, tezisda yo'q.
  if (type.requiresTimeline) {
    const t = plans.find((p) => p.skeletonId === "timeline");
    if (t) out.get(t.id)!.table = true;
  } else if (!tiny) {
    const prefer = ["results", "analysis", "results_methods", "evaluation", "example", "findings", "methods", "litreview_methods", "body"];
    const pick = prefer.map((k) => middle.find((p) => p.skeletonId === k)).find(Boolean) ?? bySize[0];
    if (pick) out.get(pick.id)!.table = true;
  }
  // Sxemalar: `figureCount` ta; grafik (foydalanuvchi ma'lumoti) shulardan biri.
  let left = tiny ? 0 : input.figureCount;
  if (left > 0 && input.userData) {
    const prefer = ["results", "analysis", "findings", "results_methods", "evaluation", "body"];
    const pick = prefer.map((k) => middle.find((p) => p.skeletonId === k)).find(Boolean) ?? bySize[0];
    if (pick) {
      out.get(pick.id)!.chart = true;
      left--;
    }
  }
  for (const p of bySize) {
    if (left <= 0) break;
    const v = out.get(p.id)!;
    if (v.chart || v.figure) continue;
    v.figure = true;
    left--;
  }
  return out;
}

/* ────────────────────────── PRISMA ────────────────────────── */

const PRISMA_CAPTION: Record<string, string> = {
  uz: "PRISMA oqim diagrammasi: manbalarni aniqlash, saralash va tanlash jarayoni",
  ru: "Блок-схема PRISMA: идентификация, скрининг и отбор источников",
  en: "PRISMA flow diagram of the identification, screening and inclusion of sources",
};

/** Sistematik sharh: PRISMA raqamlari QIDIRUV STATISTIKASIDAN — haqiqiy, uydirma emas. */
export function prismaSpec(stats: ResearchStats, cited: number): FigureSpec {
  const identified = Math.max(stats.found + stats.user, stats.candidates, cited);
  const screened = Math.max(stats.candidates + stats.user, cited);
  const eligible = Math.max(stats.selected + stats.user, cited);
  return {
    kind: "prisma",
    identified,
    screened,
    excludedScreen: Math.max(0, screened - eligible),
    eligible,
    excludedElig: Math.max(0, eligible - cited),
    included: cited,
    sources: stats.queries.length ? `OpenAlex (${stats.queries.length} queries), Crossref` : "Author sources",
  };
}

/* ────────────────────────── bo'lim yozish ────────────────────────── */

type SectionOut = {
  plan: SectionPlan;
  blocks: Block[];
  table?: { table: Omit<DocTable, "id" | "anchor">; after: number };
  figure?: { caption: string; spec: FigureSpec; after: number };
  report: SectionGuardReport;
  expanded: boolean;
  rewritten: boolean;
};

type SectionJson = { blocks?: unknown; table?: unknown; figure?: { caption?: unknown; spec?: unknown; anchorAfterBlock?: unknown } };

/* ────────────────────────── asosiy ────────────────────────── */

export async function buildArticleDoc(meta: DocMeta, values: FormValues, opts: ArticleBuildOpts): Promise<ArticleBuildResult | null> {
  const complete = opts.complete ?? completeRole;
  if (!opts.complete && !llmEnabled()) return null;
  const { deadline } = opts;
  const meter = new CostMeter();
  const input = articleInputFromValues({ ...values, sourceText: meta.sourceText || values.sourceText || "" });
  if (!input.sourceText && opts.source) input.sourceText = await sourceTextOf(opts.source);
  const type = ARTICLE_TYPES[input.articleType];
  const profile = PUBLICATION_PROFILES[input.pubProfile];
  const labels = articleLabels(input.language);
  const docMeta: DocMeta = { ...meta, language: input.language, topic: input.topic || meta.topic, articleType: type.id, pubProfile: profile.id, citeStyle: input.citeStyle ?? profile.cite, udk: input.udk, figureCount: input.figureCount, research: input.research };
  const plan = articleWordPlan(docMeta, type, profile);
  const ctx: ArticleContext = { input, meta: docMeta, type, profile, labels, wordTarget: plan.body, plan, refs: [] };
  const stage = (progress: number, step: string) => opts.onStage?.({ progress, step });
  const ask = async (role: Parameters<CompleteFn>[0], system: string, user: string, o: { maxTokens: number; timeoutMs: number }) => {
    if (o.timeoutMs < MIN_CALL_MS) return null;
    const r = await complete(role, system, user, { json: true, ...o });
    meter.add(r?.usage);
    return r?.text ?? null;
  };
  const guard: ArticleGuardSummary = { removedCitations: 0, unresolved: [], unsourcedNumbers: [], missingFactNumbers: [], filler: [], expanded: [], rewrittenForRange: [], emptySections: [] };

  // ── 1. research
  stage(0, "Manbalar qidirilmoqda");
  const research = await collectReferences(input, docMeta, {
    deadline,
    complete,
    fetchImpl: opts.fetchImpl,
    retryBaseMs: opts.retryBaseMs,
    onUsage: (u) => meter.add(u),
  });
  ctx.refs = research.refs;
  stage(12, `Manbalar: ${research.refs.length} ta`);

  // ── 2. outline
  const system = articleSystemPrompt(ctx);
  stage(12, "Reja tuzilmoqda");
  const outlineRaw = await ask("writer", system, outlinePrompt(ctx), { maxTokens: 1200, timeoutMs: Math.min(OUTLINE_TIMEOUT_MS, remainingMs(deadline)) });
  const plans = outlineRaw ? outlineFromLlm(outlineRaw, ctx) : fallbackOutline(ctx);
  const visuals = planVisuals(ctx, plans);
  stage(18, `Reja: ${plans.length} bo‘lim`);

  // ── 3. sections
  let done = 0;
  const written = await mapPool(plans, 3, async (p): Promise<SectionOut> => {
    const v = visuals.get(p.id) ?? { table: false, figure: false, chart: false };
    const out = await writeSection(ctx, p, { plan: p, wantTable: v.table, wantFigure: v.figure, wantChart: v.chart }, system, ask, deadline);
    done++;
    stage(18 + Math.round((44 * done) / plans.length), `Bo‘limlar yozilmoqda · ${done}/${plans.length}`);
    return out;
  });

  // Majburiy bo'lim bo'sh qolsa — bir marta qayta (vaqt bo'lsa).
  for (const w of written) {
    if (w.blocks.length || !w.plan.hard || remainingMs(deadline) < 25_000) continue;
    console.warn(`[article] «${w.plan.id}» bo'sh — qayta so'rov`);
    const again = await writeSection(ctx, w.plan, { plan: w.plan, wantTable: false, wantFigure: false, wantChart: false }, system, ask, deadline);
    if (again.blocks.length) Object.assign(w, again);
  }

  // ── 4. visuals — id lar, langarlar, bloklar
  stage(62, "Jadval va sxemalar");
  const sections: DocSection[] = [];
  const tables: DocTable[] = [];
  const figures: Figure[] = [];
  for (const w of written) {
    const blocks = [...w.blocks];
    if (!blocks.length) guard.emptySections.push(w.plan.id);
    // Avval sxema, keyin jadval — indekslar siljimasin deb oxiridan boshiga.
    const inserts: { at: number; block: Block }[] = [];
    if (w.figure && figures.length < ARTICLE_LIMITS.figures) {
      const id = `f${figures.length + 1}`;
      const isChart = w.figure.spec.kind === "chart";
      figures.push({ id, kind: isChart ? "chart" : "scheme", caption: w.figure.caption, spec: w.figure.spec, w: FIGURE_W, h: FIGURE_H, source: isChart ? sourceLabel(input.language, "user") : sourceLabel(input.language, "author") });
      inserts.push({ at: w.figure.after, block: { kind: "figure", text: w.figure.caption, figureId: id } });
    }
    if (w.table) {
      const id = `t${tables.length + 1}`;
      tables.push({ id, ...w.table.table, anchor: w.plan.id });
      inserts.push({ at: w.table.after, block: { kind: "tableRef", text: w.table.table.caption ?? "", tableId: id } });
    }
    for (const ins of inserts.sort((a, b) => b.at - a.at)) {
      const at = Math.max(0, Math.min(blocks.length - 1, ins.at));
      blocks.splice(blocks.length ? at + 1 : 0, 0, ins.block);
    }
    sections.push({ id: w.plan.id, title: w.plan.title, blocks });
    guard.removedCitations += w.report.removedCitations.length;
    guard.unsourcedNumbers.push(...w.report.unsourcedNumbers);
    guard.filler.push(...w.report.filler);
    if (w.expanded) guard.expanded.push(w.plan.id);
    if (w.rewritten) guard.rewrittenForRange.push(w.plan.id);
  }
  stage(74, "Jadval va sxemalar tayyor");

  // ── 5. abstracts + keywords (+ highlights)
  const summaries = sections.filter((s) => s.blocks.length).map((s) => summaryOf(s)).join("\n");
  const langs = [input.language, ...(["uz", "ru", "en"] as const).filter((l) => l !== input.language)];
  const keywords: ArticleModel["keywords"] = {};
  const abstracts: NonNullable<AcademicDoc["abstracts"]> = [];
  let absDone = 0;
  const absResults = await mapPool(langs, 3, async (lang) => {
    const r = await writeAbstract(ctx, lang, summaries, ask, deadline);
    absDone++;
    stage(74 + Math.round((8 * absDone) / langs.length), `Annotatsiya · ${lang}`);
    return { lang, r };
  });
  for (const { lang, r } of absResults) {
    if (!r) continue;
    abstracts.push({ lang, label: articleLabels(lang).abstract, text: r.text, keywords: r.keywords.join(", ") });
    keywords[lang] = r.keywords;
  }
  // Hujjat tilidagi annotatsiya BIRINCHI (ko'ruvchi/DOCX tartibi shu).
  abstracts.sort((a, b) => langs.indexOf(a.lang as (typeof langs)[number]) - langs.indexOf(b.lang as (typeof langs)[number]));
  let highlights: string[] | undefined;
  if (type.highlights && remainingMs(deadline) > MIN_CALL_MS) {
    const raw = await ask("writer", system, highlightsPrompt(ctx, summaries), { maxTokens: 500, timeoutMs: Math.min(20_000, remainingMs(deadline)) });
    const list = parseLlmObject<{ highlights?: unknown }>(raw ?? "")?.highlights;
    const h = (Array.isArray(list) ? list : []).map((x) => str(x, type.highlights!.maxChars + 40)).filter(Boolean);
    highlights = h.map((x) => (x.length <= type.highlights!.maxChars ? x : clipWords(x, type.highlights!.maxChars))).slice(0, type.highlights.max);
    if (highlights.length < type.highlights.min) highlights = highlights.length ? highlights : undefined;
  }
  stage(82, "Adabiyotlar tekshirilmoqda");

  // ── 6. references — iqtiboslar reyestr bilan, faqat cited
  const verified = verifyCitations(sections, ctx.refs);
  guard.unresolved = verified.unresolved;
  guard.removedCitations += verified.removed;
  const index = new Map(verified.refs.map((r) => [r.id, r]));
  const citedIds = new Set(verified.refs.filter((r) => r.cited).map((r) => r.id));
  // Jadval sarlavhasi/kataklaridagi iqtiboslar ham reyestr bilan.
  const refIndex = referenceIndex(verified.refs);
  for (const t of tables) {
    const keep = (id: string) => {
      citedIds.add(id);
      index.get(id)!.cited = true;
    };
    if (t.caption) t.caption = verifyCitationsInText(t.caption, refIndex, { onKeep: keep });
    t.rows = t.rows.map((r) => r.map((c) => verifyCitationsInText(c, refIndex, { onKeep: keep })));
  }
  // Annotatsiyada iqtibos bo'lmaydi — barcha id guruhlari olib tashlanadi.
  for (const a of abstracts) a.text = verifyCitationsInText(a.text, new Map());
  // Rasm sarlavhasi blok matni bilan bir xil qolsin (ko'ruvchi ikkalasini ko'rsatadi).
  for (const s of verified.sections) for (const b of s.blocks) if (b.kind === "figure") {
    const f = figures.find((x) => x.id === b.figureId);
    if (f) f.caption = b.text;
  }
  const refs = citedOnly(verified.refs.map((r) => ({ ...r, cited: r.cited || citedIds.has(r.id) })));
  guard.missingFactNumbers = missingFactNumbers(verified.sections, input.userFacts);

  // PRISMA — sistematik sharh: raqamlar qidiruv statistikasidan.
  if (type.requiresPrisma) {
    const id = `f${figures.length + 1}`;
    const caption = PRISMA_CAPTION[input.language] ?? PRISMA_CAPTION.en;
    figures.push({ id, kind: "scheme", caption, spec: prismaSpec(research.stats, refs.length), w: FIGURE_W, h: FIGURE_H, source: sourceLabel(input.language, "author") });
    const target = verified.sections.find((s) => s.id === "results" || s.id.startsWith("results")) ?? verified.sections.find((s) => s.blocks.length);
    if (target) target.blocks.splice(Math.min(1, target.blocks.length), 0, { kind: "figure", text: caption, figureId: id });
  }

  /*
   * Sxemalarni CHIZISH (WP3 `figures/`): spec → maket → SVG → PNG 300 dpi
   * (`url = data:image/png…`, worker `extractAssets` bilan aktivga
   * chiqaradi). Maket buzilsa (sikl, chegara, ma'lumotsiz grafik) —
   * `fallbackBlocks` raqamlangan ro'yxat: rasm o'rniga matn, uydirma
   * raqam yo'q. Renderer ikkala holatni biladi.
   */
  if (figures.length) {
    stage(72, `Sxemalar: ${figures.length} ta`);
    const built = await buildFigures(figures, { lang: input.language });
    figures.splice(0, figures.length, ...built);
    const drawn = built.filter((f) => f.url).length;
    if (drawn < built.length) console.warn(`[article] ${built.length - drawn} ta sxema maketlanmadi — ro'yxat sifatida qoldi`);
  }

  const coverage = skeletonCoverage(type, verified.sections);
  if (coverage.hardMissing.length) console.warn(`[article] majburiy bo'limlar bo'sh: ${coverage.hardMissing.join(", ")}`);
  if (guard.unresolved.length) console.warn(`[article] reyestrda yo'q iqtibos o'chirildi: ${guard.unresolved.map((u) => u.id).join(", ")}`);
  if (guard.unsourcedNumbers.length) console.warn(`[article] manbasiz foizlar: ${guard.unsourcedNumbers.join(", ")}`);
  if (guard.missingFactNumbers.length) console.warn(`[article] foydalanuvchi raqamlari matnda yo'q: ${guard.missingFactNumbers.join(", ")}`);
  stage(86, `Adabiyotlar: ${refs.length} ta`);

  const article: ArticleModel = {
    v: 1,
    type: type.id,
    profile: profile.id,
    cite: input.citeStyle ?? profile.cite,
    ...(profile.udk && input.udk ? { udk: input.udk } : {}),
    authors: input.authors,
    keywords,
    ...(highlights ? { highlights } : {}),
    references: refs,
    figures,
    ...(input.userFacts ? { userFacts: input.userFacts } : {}),
    language: input.language,
  };
  const anyUnverified = refs.some((r) => r.verified === "unverified");
  const doc: AcademicDoc = {
    meta: docMeta,
    titlePage: false,
    toc: false,
    sections: verified.sections,
    ...(tables.length ? { tables } : {}),
    ...(abstracts.length ? { abstracts } : {}),
    // Eski maydon — `cited` manbalarning matn ko'rinishi (eski kod, karta, qidiruv).
    ...(refs.length ? { references: refs.map((r) => formatRefLine(r).replace(/^\[[^\]]+\]\s*/, "")) } : {}),
    ...(anyUnverified ? { referencesNote: unverifiedReferenceNote(input.language) } : {}),
    article,
  };

  /*
   * ── 7. review (WP5) — qoidalar + `judge` roli → `doc.article.review`.
   * Hisobot XATO EMAS: baholovchi/qoida yiqilsa maqola hisobotsiz chiqadi
   * (jurnalga yoziladi), kredit yechilgan ish yo'qolmaydi. Baholovchi
   * `usage` i sarfga qo'shiladi (`cost_json`).
   */
  stage(88, "Tayyorlik hisoboti");
  try {
    const review = await reviewArticle(doc, {
      research: research.stats,
      guard: { unresolved: guard.unresolved, emptySections: guard.emptySections },
      complete,
      deadline,
      wordTarget: plan.body,
      onUsage: (u) => meter.add(u),
    });
    article.review = review;
    stage(94, `Hisobot: ${review.score} ball`);
  } catch (e) {
    console.warn("[article] tayyorlik hisoboti tuzilmadi:", e instanceof Error ? e.message : e);
    stage(94, "Hisobotsiz davom etildi");
  }
  return { doc, cost: meter.toJson(), research: research.stats, guard };
}

/* ────────────────────────── bo'lim ────────────────────────── */

type Ask = (role: Parameters<CompleteFn>[0], system: string, user: string, o: { maxTokens: number; timeoutMs: number }) => Promise<string | null>;

async function writeSection(ctx: ArticleContext, plan: SectionPlan, ask: SectionAsk, system: string, call: Ask, deadline: number): Promise<SectionOut> {
  const wordRange = ctx.type.wordRange && ctx.type.skeleton.length === 1 ? ctx.type.wordRange : undefined;
  const gopts = { refs: ctx.refs, userFacts: ctx.input.userFacts, wordRange };
  const maxTokens = Math.min(8000, Math.max(1200, Math.round(plan.words * 2.4) + 700));
  const empty: SectionOut = { plan, blocks: [], report: { removedCitations: [], citations: 0, unsourcedNumbers: [], factNumbersFound: [], filler: [], words: 0, wordRangeOk: false }, expanded: false, rewritten: false };

  const parseOne = (raw: string | null) => {
    if (!raw) return null;
    const j = parseLlmObject<SectionJson>(raw);
    const blocks = blocksFromLlm(j?.blocks, raw);
    if (!blocks.length) return null;
    const table = ask.wantTable ? tableFromLlm(j?.table) ?? undefined : undefined;
    let figure: SectionOut["figure"];
    if ((ask.wantFigure || ask.wantChart) && j?.figure && typeof j.figure === "object") {
      const spec = figureSpecFromLlm(j.figure.spec, ctx.input);
      const caption = str(j.figure.caption, 200);
      if (spec && caption && (spec.kind === "chart") === ask.wantChart) {
        figure = { caption, spec, after: Number.isInteger(Number(j.figure.anchorAfterBlock)) ? Number(j.figure.anchorAfterBlock) : 0 };
      }
    }
    return { blocks, table, figure };
  };

  let first = parseOne(await call("writer", system, sectionPrompt(ctx, ask), { maxTokens, timeoutMs: sectionTimeout(plan.words, deadline) }));
  if (!first && remainingMs(deadline) > 20_000) {
    console.warn(`[article] «${plan.id}»: javob yaroqsiz — qayta so'rov`);
    first = parseOne(await call("writer", system, sectionPrompt(ctx, ask), { maxTokens, timeoutMs: sectionTimeout(plan.words, deadline) }));
  }
  if (!first) return empty;

  let guarded = guardSection(first.blocks, gopts);
  const out: SectionOut = { plan, blocks: guarded.blocks, table: first.table, figure: first.figure, report: guarded.report, expanded: false, rewritten: false };

  /*
   * Tezis/qisqa xabar: so'z oralig'idan tashqarida — qayta yoziladi (ko'pi
   * bilan 2 urinish; jonli sinovda birinchi urinish 157 → hali ham qisqa
   * chiqqan holat bo'ldi). Yaqinroq natija olinadi, yomonroq tashlanadi.
   */
  if (wordRange) {
    const dist = (w: number) => (w < wordRange[0] ? wordRange[0] - w : w > wordRange[1] ? w - wordRange[1] : 0);
    for (let attempt = 0; attempt < 2 && !guarded.report.wordRangeOk && remainingMs(deadline) > 20_000; attempt++) {
      const raw = await call("writer", system, wordRangePrompt(ctx, plan, guarded.report.words, wordRange), { maxTokens, timeoutMs: sectionTimeout(plan.words, deadline) });
      const again = raw ? blocksFromLlm(parseLlmObject<SectionJson>(raw)?.blocks, raw) : [];
      if (!again.length) break;
      const g2 = guardSection(again, gopts);
      if (dist(g2.report.words) < dist(guarded.report.words)) {
        guarded = g2;
        out.blocks = g2.blocks;
        out.report = g2.report;
        out.rewritten = true;
      }
    }
    return out;
  }

  // Hajm yetmasa — bir marta «kengaytir» (faqat bet bilan o'lchanadigan turlar).
  if (!wordRange && guarded.report.words < plan.words * EXPAND_BELOW && remainingMs(deadline) > 25_000) {
    const need = plan.words - guarded.report.words;
    const existing = out.blocks.map((b) => b.text).join("\n\n");
    const raw = await call("writer", system, expandPrompt(ctx, plan, guarded.report.words, need, existing), { maxTokens: Math.min(6000, Math.round(need * 2.4) + 500), timeoutMs: sectionTimeout(need, deadline) });
    const extra = raw ? blocksFromLlm(parseLlmObject<SectionJson>(raw)?.blocks, raw) : [];
    if (extra.length) {
      const g2 = guardSection(extra, gopts);
      out.blocks = [...out.blocks, ...g2.blocks];
      out.report = {
        ...out.report,
        removedCitations: [...out.report.removedCitations, ...g2.report.removedCitations],
        citations: out.report.citations + g2.report.citations,
        unsourcedNumbers: [...out.report.unsourcedNumbers, ...g2.report.unsourcedNumbers],
        filler: [...out.report.filler, ...g2.report.filler],
        words: out.report.words + g2.report.words,
      };
      out.expanded = true;
    }
  }
  return out;
}

/* ────────────────────────── annotatsiya ────────────────────────── */

async function writeAbstract(ctx: ArticleContext, lang: string, summaries: string, call: Ask, deadline: number) {
  const system = abstractSystemPrompt(ctx, lang);
  const [minW, maxW] = ctx.profile.abstractWords;
  const aim = ctx.plan.abstractAim;
  const run = () => call("writer", system, abstractPrompt(ctx, lang, summaries), { maxTokens: 1400, timeoutMs: Math.min(ABSTRACT_TIMEOUT_MS, remainingMs(deadline)) });
  let best = abstractFromLlm(await run(), ctx, lang);
  const bad = (r: typeof best) => !r || r.words < minW * 0.7 || r.words > maxW * 1.4 || r.keywords.length < ctx.profile.keywords[0];
  if (bad(best) && remainingMs(deadline) > 15_000) {
    const retry = abstractFromLlm(await run(), ctx, lang);
    if (retry && (!best || !bad(retry) || Math.abs(retry.words - aim) < Math.abs(best.words - aim))) best = retry;
  }
  if (!best) console.warn(`[article] annotatsiya (${lang}) chiqmadi`);
  return best;
}

/* ────────────────────────── kichik yordamchilar ────────────────────────── */

/**
 * Rasm manbasi MATNI — «Manba:» prefiksisiz: prefiksni `planArticle`
 * (`layout.ts` `FIG_WORDS.source`) qo'yadi. Jonli IEEE sinovida
 * «Source: Source: compiled by the author» chiqqan edi — ikki joyda yozilgani.
 */
function sourceLabel(lang: string, who: "author" | "user"): string {
  const m: Record<string, [string, string]> = {
    uz: ["muallif tomonidan tuzilgan", "muallif ma’lumotlari"],
    ru: ["составлено автором", "данные автора"],
    en: ["compiled by the author", "author's data"],
  };
  return (m[lang] ?? m.en)[who === "author" ? 0 : 1];
}

/** Yuklangan fayldan matn — tarjima ekstraktori orqali (bo'sh bo'lsa ""). */
async function sourceTextOf(source: TranslationSource): Promise<string> {
  try {
    const { extractSegments } = await import("../translate/index");
    const ex = await extractSegments(source.kind, source.bytes);
    return ex.segments.map((s) => s.text).join("\n\n").slice(0, 24_000);
  } catch (e) {
    console.warn("[article] manba fayl o'qilmadi:", e instanceof Error ? e.message : e);
    return "";
  }
}
