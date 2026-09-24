/**
 * INSHO DVIGATELI (AUDIT-19 WP-D) — `buildEssayDoc`.
 *
 * Bosqichlar (`onStage` foizlari reja bo'yicha):
 *   1 outline   0→15   reja: sarlavha, thesis statement, bandlar (rol + topic sentence)
 *   2 write    15→60   butun insho BITTA chaqiruvda (≤1 200 so'z); kattasi
 *                      ikki qismda (kirish+tana / tana+xulosa)
 *   3 guard    60→65   `guardSection` — klişe, manbasiz raqam, iqtibos yo'q,
 *                      hajm oralig'i (kam bo'lsa BIR marta qayta so'rov)
 *   4 review   65→82   `review.ts` qoidalar + `judge` → `doc.essay.review`
 *   5 polish   82→94   `polish.ts runEssayPolish` — ball < 90 bo'lsa (Q-3, `acceptDelta: 1`)
 *   6 done     94→100
 *
 * Yagona manba qarori: MATN `doc.sections` da BITTA bo'lim (`id: "essay"`)
 * — render (`render-docx.ts` `design` ramkasi) va ko'ruvchi (`WordViewer`)
 * o'zgarmaydi; metama'lumot `doc.essay` (`EssayModel`).
 *
 * `null` — LLM yo'q (kalitsiz muhit): `index.ts` eski/shablon yo'liga
 * o'tadi. Bo'sh matn XATO EMAS: hujjat qaytadi, hajm darvozasi
 * (`index.ts LENGTH_GATED`) uni yiqitadi va kredit qaytadi.
 */
import type { FormValues } from "../../types";
import type { AcademicDoc, Block, DocMeta, DocSection } from "../types";
import { llmEnabled } from "../llm";
import { CostMeter, complete as completeRole, type LlmRole, type LlmUsage, type RoleOpts } from "../llm-roles";
import { assertJobTime } from "../deadline";
import { parseLlmObject } from "../json";
import { cleanText, remainingMs } from "../quality";
import { guardSection } from "../report/guard";
import type { DocReview } from "../report/types";
import { essayInputFromValues, type EssayInput } from "./input";
import { essayBlocksFromLlm } from "./parse";
import {
  essayCtx,
  essayNeedsTwoParts,
  essayPrompt,
  essaySystemPrompt,
  outlinePrompt,
  wordRangePrompt,
  type EssayCtx,
  type EssayParagraphPlan,
} from "./prompts";
import { ESSAY_POLISH_BELOW, ESSAY_POLISH_MIN_MS, runEssayPolish } from "./polish";
import { reviewEssay, type CompleteFn } from "./review";
import { ESSAY_LIMITS, type EssayModel, type EssayParagraph } from "./types";

export type EssayStage = { progress: number; step: string };

export type EssayBuildOpts = {
  deadline: number;
  /** Test seam — rol bo'yicha LLM. */
  complete?: CompleteFn;
  onStage?: (ev: EssayStage) => void;
  /** Avto-sayqal (5-bosqich). Standart `true`; `ESSAY_POLISH=0` ham o'chiradi. */
  polish?: boolean;
  /** `false` — baholovchi chaqirilmaydi (testlar). */
  judge?: boolean;
  onUsage?: (u: LlmUsage) => void;
  now?: Date;
};

export type EssayCost = ReturnType<CostMeter["toJson"]>;
export type EssayBuildResult = { doc: AcademicDoc; cost: EssayCost };

/* ────────────────────────── byudjet ────────────────────────── */

const OUTLINE_TIMEOUT_MS = 25_000;
/** Insho chaqiruvi: 25 s + so'z boshiga 45 ms, 35–90 s oralig'ida. */
const writeTimeout = (words: number, deadline: number) => Math.min(Math.max(35_000, 25_000 + words * 45), 90_000, remainingMs(deadline));
/** Chaqiruvga shundan kam vaqt qolsa umuman urinilmaydi. */
const MIN_CALL_MS = 8_000;

/* ────────────────────────── reja ────────────────────────── */

/**
 * Model rejasiz qolganda (JSON kelmadi / vaqt tugadi) — deterministik
 * reja: kirish, `bodyCount` ta tana bandi, xulosa. Insho baribir
 * yoziladi, faqat briflar umumiy bo'ladi.
 */
export function fallbackOutline(ctx: EssayCtx): EssayParagraphPlan[] {
  const { edges, words, bodyCount } = ctx;
  const introW = Math.round((edges.intro[0] + edges.intro[1]) / 2);
  const concW = Math.round((edges.conclusion[0] + edges.conclusion[1]) / 2);
  const bodyW = Math.max(60, Math.round((words.aim - introW - concW) / Math.max(1, bodyCount)));
  const out: EssayParagraphPlan[] = [
    { id: "p1", role: "intro", brief: `Lead the reader into «${ctx.input.topic}» and end with the thought the essay develops.`, words: introW },
  ];
  for (let i = 0; i < bodyCount; i++) {
    out.push({ id: `p${i + 2}`, role: "body", brief: `Develop one distinct aspect of «${ctx.input.topic}» with a concrete example; do not repeat the other paragraphs.`, words: bodyW });
  }
  out.push({ id: `p${bodyCount + 2}`, role: "conclusion", brief: `State what follows from the essay; do not repeat the introduction.`, words: concW });
  return out;
}

type OutlineRaw = { title?: unknown; thesisStatement?: unknown; paragraphs?: unknown };

export type EssayOutline = { title: string; thesisStatement: string; plans: EssayParagraphPlan[] };

const ROLES = new Set(["intro", "body", "conclusion"]);

/** Model javobi → reja; yaroqsiz bo'lsa `fallbackOutline`. */
export function outlineFromLlm(raw: string | null | undefined, ctx: EssayCtx): EssayOutline {
  const j = parseLlmObject<OutlineRaw>(raw ?? "");
  const title = cleanText(String(j?.title ?? "")).slice(0, 160) || ctx.input.topic;
  const thesis = ctx.context.thesisStatement ? cleanText(String(j?.thesisStatement ?? "")).slice(0, ESSAY_LIMITS.thesisChars) : "";
  const rows = Array.isArray(j?.paragraphs) ? j!.paragraphs : [];
  const plans: EssayParagraphPlan[] = [];
  for (const r of rows) {
    const o = r as { id?: unknown; role?: unknown; topicSentence?: unknown; brief?: unknown; words?: unknown } | null;
    if (!o || typeof o !== "object") continue;
    const role = String(o.role ?? "body");
    if (!ROLES.has(role)) continue;
    const brief = cleanText(String(o.brief ?? "")).slice(0, 400);
    const words = Number(o.words);
    plans.push({
      id: cleanText(String(o.id ?? `p${plans.length + 1}`)).slice(0, 20) || `p${plans.length + 1}`,
      role: role as EssayParagraphPlan["role"],
      ...(o.topicSentence ? { topicSentence: cleanText(String(o.topicSentence)).slice(0, ESSAY_LIMITS.topicSentenceChars) } : {}),
      brief,
      words: Number.isFinite(words) && words > 20 ? Math.round(words) : 120,
    });
    if (plans.length >= ESSAY_LIMITS.paragraphs) break;
  }
  // Reja ishonchli bo'lishi uchun: kirish + kamida 2 tana + xulosa.
  const ok = plans.length >= 4 && plans[0].role === "intro" && plans[plans.length - 1].role === "conclusion";
  return { title, thesisStatement: thesis, plans: ok ? plans : fallbackOutline(ctx) };
}

/* ────────────────────────── dvigatel ────────────────────────── */

type Ask = (role: LlmRole, system: string, user: string, o?: RoleOpts) => Promise<string | null>;

export async function buildEssayDoc(meta: DocMeta, values: FormValues, opts: EssayBuildOpts): Promise<EssayBuildResult | null> {
  const complete = opts.complete ?? completeRole;
  if (!opts.complete && !llmEnabled()) return null;
  const { deadline } = opts;
  const now = opts.now ?? new Date();
  const meter = new CostMeter();
  const input: EssayInput = essayInputFromValues({ ...values, sourceText: meta.sourceText ?? "" });
  const ctx = essayCtx({ ...meta, language: input.language, design: input.design }, input);
  const stage = (progress: number, step: string) => opts.onStage?.({ progress, step });

  // Ish muddati (EXT-03) har chaqiruvga — zanjir qayta urinishni muddatdan oshirmaydi.
  const ask: Ask = async (role, system, user, o = {}) => {
    const r = await complete(role, system, user, { json: true, ...o, deadline });
    if (r?.usage) {
      meter.add(r.usage);
      opts.onUsage?.(r.usage);
    }
    return r?.text ?? null;
  };

  const system = essaySystemPrompt(ctx);

  /* ── 1. reja ── */
  stage(2, "Insho rejasi");
  const outlineRaw = remainingMs(deadline) > MIN_CALL_MS ? await ask("writer", system, outlinePrompt(ctx), { maxTokens: 1200, timeoutMs: Math.min(OUTLINE_TIMEOUT_MS, remainingMs(deadline)) }) : null;
  const outline = outlineFromLlm(outlineRaw, ctx);
  stage(15, "Reja tayyor");

  /* ── 2. matn ── */
  let blocks = await writeEssay(ctx, outline, system, ask, deadline, stage);
  stage(60, "Insho yozildi");

  /* ── 3. qo'riqchi + hajm qayta so'rovi ── */
  const range: [number, number] = [ctx.words.min, ctx.words.max];
  let guarded = guardSection(blocks, { refs: [], userFacts: input.userFacts, wordRange: range });
  if (!guarded.report.wordRangeOk && blocks.length && remainingMs(deadline) > 25_000) {
    const current = guarded.blocks.map((b) => b.text).join("\n\n");
    const raw = await ask("writer", system, wordRangePrompt(ctx, guarded.report.words, range, current), {
      maxTokens: Math.min(8000, Math.max(1500, Math.round(ctx.words.max * 2.6))),
      timeoutMs: writeTimeout(ctx.words.aim, deadline),
    });
    const again = essayBlocksFromLlm(raw);
    if (again.length) {
      const re = guardSection(again, { refs: [], userFacts: input.userFacts, wordRange: range });
      // Yangi urinish oraliqqa yaqinroq bo'lsagina qabul qilinadi.
      if (distance(re.report.words, range) < distance(guarded.report.words, range)) guarded = re;
    }
  }
  blocks = guarded.blocks;
  if (guarded.report.filler.length) console.warn(`[essay] klişe iboralar: ${[...new Set(guarded.report.filler)].join(", ")}`);
  if (guarded.report.unsourcedNumbers.length) console.warn(`[essay] manbasiz foizlar: ${guarded.report.unsourcedNumbers.join(", ")}`);
  if (guarded.report.removedCitations.length) console.warn(`[essay] iqtibos id lari o'chirildi: ${guarded.report.removedCitations.join(", ")}`);
  stage(65, "Matn tekshirildi");

  /* ── hujjat ── */
  const model: EssayModel = {
    v: 1,
    context: input.context,
    kind: input.kind,
    language: input.language,
    words: ctx.words,
    ...(outline.thesisStatement ? { thesisStatement: outline.thesisStatement } : {}),
    ...(input.epigraph?.text ? { epigraph: input.epigraph } : {}),
    ...(input.workTitle ? { workTitle: input.workTitle } : {}),
    paragraphs: paragraphsOf(outline.plans),
    person: input.person,
    ...(input.design ? { design: input.design } : {}),
    rubric: ctx.context.rubric,
    ...(input.userFacts ? { userFacts: input.userFacts } : {}),
  };
  const section: DocSection = { id: "essay", title: outline.title, blocks: withEpigraph(input, blocks) };
  let doc: AcademicDoc = {
    meta: { ...meta, language: input.language, design: input.design },
    titlePage: ctx.context.titlePage,
    toc: false,
    sections: [section],
    essay: model,
  };

  /* ── 4. hisobot ── */
  let review: DocReview | null = null;
  if (remainingMs(deadline) > MIN_CALL_MS) {
    try {
      review = await reviewEssay(doc, {
        complete,
        deadline,
        judge: opts.judge,
        now,
        onUsage: (u) => {
          meter.add(u);
          opts.onUsage?.(u);
        },
        guard: { emptySections: blocks.length ? [] : ["essay"] },
      });
      doc = { ...doc, essay: { ...model, review } };
    } catch (e) {
      console.warn("[essay] hisobot xatosi:", e instanceof Error ? e.message : e);
    }
  }
  stage(82, "Tayyorlik hisoboti");

  /* ── 5. avto-sayqal ── */
  const wantPolish = opts.polish ?? process.env.ESSAY_POLISH !== "0";
  if (review && wantPolish && review.score < ESSAY_POLISH_BELOW && remainingMs(deadline) >= ESSAY_POLISH_MIN_MS) {
    try {
      const res = await runEssayPolish(doc, review, {
        complete,
        deadline,
        judge: opts.judge,
        now,
        onUsage: (u) => {
          meter.add(u);
          opts.onUsage?.(u);
        },
      });
      doc = { ...res.doc, essay: { ...(res.doc.essay ?? model), review: res.review } };
    } catch (e) {
      console.warn("[essay] sayqal xatosi:", e instanceof Error ? e.message : e);
    }
  }
  stage(94, "Sayqal");

  stage(100, "Insho tayyor");
  return { doc, cost: meter.toJson() };
}

/* ────────────────────────── yozish ────────────────────────── */

function distance(n: number, range: [number, number]): number {
  return n < range[0] ? range[0] - n : n > range[1] ? n - range[1] : 0;
}

/** Epigraf — birinchi blok (`quote`); band sifatida sanalmaydi. */
function withEpigraph(input: EssayInput, blocks: Block[]): Block[] {
  if (!input.epigraph?.text || !blocks.length) return blocks;
  const text = input.epigraph.author ? `${input.epigraph.text} — ${input.epigraph.author}` : input.epigraph.text;
  const first = blocks[0];
  if (first.kind === "quote" && first.text.includes(input.epigraph.text.slice(0, 24))) return blocks;
  return [{ kind: "quote", text }, ...blocks];
}

function paragraphsOf(plans: EssayParagraphPlan[]): EssayParagraph[] {
  return plans.map((p) => ({ id: p.id, role: p.role, ...(p.topicSentence ? { topicSentence: p.topicSentence } : {}) }));
}

/**
 * Insho matni. Kichik insho (≤ `ESSAY_SINGLE_CALL_WORDS`) BITTA
 * chaqiruvda — bo'lib yozish tutashligi (bir band ikkinchisiga
 * ulanishi) inshoda maqoladan ham muhimroq. Katta insho (5 varaq) ikki
 * qismda: kirish + tananing yarmi, so'ng qolgani + xulosa; ikkinchi
 * chaqiruvga birinchi qismning matni beriladi (takror bo'lmasin).
 */
async function writeEssay(
  ctx: EssayCtx,
  outline: EssayOutline,
  system: string,
  ask: Ask,
  deadline: number,
  stage: (p: number, s: string) => void,
): Promise<Block[]> {
  const { plans, thesisStatement, title } = outline;
  const one = async (part: "all" | "head" | "tail", subset: EssayParagraphPlan[], written?: string): Promise<Block[]> => {
    // Insho MATNI — asosiy yozuv: vaqt yo'q bo'lsa bo'sh (yarim) insho emas, `DeadlineError` (EXT-03).
    assertJobTime(deadline, "essay:writer", MIN_CALL_MS);
    const aim = subset.reduce((n, p) => n + p.words, 0) || ctx.words.aim;
    const user = essayPrompt(ctx, subset, { part, thesisStatement, title, ...(written ? { written } : {}) });
    const maxTokens = Math.min(8000, Math.max(1200, Math.round(aim * 2.6)));
    let blocks = essayBlocksFromLlm(await ask("writer", system, user, { maxTokens, timeoutMs: writeTimeout(aim, deadline) }));
    if (!blocks.length && remainingMs(deadline) > 20_000) {
      console.warn("[essay] javob bo'sh — bir marta qayta so'ralmoqda");
      blocks = essayBlocksFromLlm(await ask("writer", system, user, { maxTokens, timeoutMs: writeTimeout(aim, deadline) }));
    }
    return blocks;
  };

  if (!essayNeedsTwoParts(ctx)) return one("all", plans);

  const cut = Math.max(2, Math.ceil(plans.length / 2));
  const head = plans.slice(0, cut);
  const tail = plans.slice(cut);
  const first = await one("head", head);
  stage(40, "Insho (1-qism)");
  if (!first.length) return one("all", plans);
  const second = await one("tail", tail, first.map((b) => b.text).join("\n\n"));
  return second.length ? [...first, ...second] : first;
}
