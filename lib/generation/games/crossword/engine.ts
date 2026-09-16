/**
 * KROSSVORD DVIGATELI (AUDIT-21 WP-A) — `buildCrosswordDoc`.
 *
 * Bosqichlar (`onStage` foizlari, `games/engine.ts` shartnomasi):
 *    1 kirish       0→10   forma → `CrosswordInput`, fayl manbasi
 *    2 so'zlar     10→55   LLM: so'z + ta'rif (kerak bo'lsa bir marta
 *                          QO'SHIMCHA so'rov — sig'magan so'zlar o'rniga)
 *    3 to'r        55→75   `placeWords` (sof algoritm) + SVG/PNG
 *    4 hisobot     75→90   `review.ts` (qoidalar + baholovchi)
 *    5 sayqal      90→96   `polish.ts` (TA'RIFNI qayta yozish)
 *
 * MEHNAT TAQSIMOTI shu faylning asosiy g'oyasi: model faqat TIL ishini
 * qiladi (so'z + ta'rif), geometriyani esa dvigatel. Shuning uchun
 * «qayta urinish» ham til darajasida: to'rga sig'magan so'z o'rniga
 * QISQAROQ so'z so'raladi (`WordsAsk.retry`), to'r esa har safar
 * boshidan, TO'LIQ ro'yxat bilan qayta quriladi — eski to'rga yamoq
 * qo'yilsa kesishmalar ixchamligi yo'qolardi.
 *
 * Yagona manba qarori (oila bilan bir xil): MATN `doc.sections` da,
 * METAMA'LUMOT `doc.game` da. Bu fayl BET BO'LMAYDI va raqam QO'YMAYDI
 * — tartibni `games/layout.ts planGame` (WP-B) beradi. Bo'lim id lari
 * SHARTNOMA: `grid · across · down · answers`.
 *
 * `null` — dvigatel ishlamadi (LLM kalitsiz muhit, model javob bermadi,
 * birorta so'z to'rga tushmadi): `games/engine.ts` uni `write-llm.ts` ga
 * uzatadi va u yerda MAVJUD xulq ishlaydi.
 */
import type { FormValues } from "../../../types";
import type { AcademicDoc, Block, DocMeta, DocSection, Figure, FigureSpec } from "../../types";
import type { TranslationSource } from "../../source-types";
import { llmEnabled } from "../../llm";
import { CostMeter, complete as completeRole } from "../../llm-roles";
import { parseLlmObject } from "../../json";
import { remainingMs } from "../../quality";
import { runPolishWith } from "../../report/polish-core";
import { GAME_LIMITS, type GameModel } from "../types";
import { gameTypeOf } from "../registry";
import type { GameBuildOpts, GameBuilt, GameStage } from "../engine";
import { cluesOf, placeWords, wordText, type CrosswordWord, type PlaceResult } from "./grid";
import { crosswordSvg, crosswordWidthMm } from "./svg";
import { crosswordInputFromValues, crosswordSeed, type CrosswordInput } from "./input";
import { crosswordLabels, crosswordSourceBlock, crosswordSystemPrompt, crosswordUserPrompt, instructionLines } from "./prompts";
import { crosswordUserNeeds, planCrosswordPolish, rewriteClues, applyClueOps, type CrosswordPolishOp } from "./polish";
import { crosswordJudgeFromReview, rescoreCrossword, reviewCrossword, type CrosswordJudgeResult } from "./review";

/* ────────────────────────── shartnoma ────────────────────────── */

export type CrosswordBuildOpts = GameBuildOpts & {
  /** Seam — SVG → PNG (standart: `../../figures buildFigures`). */
  buildFigures?: (figures: Figure[], o: { lang: string }) => Promise<Figure[]>;
  /** Seam — yuklangan fayl matni. */
  sourceTextOf?: (source: TranslationSource) => Promise<string>;
  /** Determinizm urug'i (standart: `crosswordSeed`). */
  seed?: string;
};

const STAGE = { plan: 10, words: 55, grid: 75, review: 90, polish: 96, done: 100 } as const;

/** Sayqal uchun byudjetdan kamida shuncha qolishi kerak. */
export const CROSSWORD_POLISH_MIN_MS = 45_000;
/** Qo'shimcha so'rov uchun eng kam vaqt. */
export const CROSSWORD_RETRY_MIN_MS = 25_000;
/** Q-3 qabul chegarasi (oila bilan bir xil). */
export const CROSSWORD_ACCEPT_DELTA = 1;

/** Bo'lim id lari — SHARTNOMA (maket, tahrir va hisobot shunga tayanadi). */
export const CROSSWORD_SECTION_IDS = ["grid", "across", "down", "answers"] as const;

/* ────────────────────────── LLM javobi ────────────────────────── */

type RawWord = { answer?: unknown; clue?: unknown; word?: unknown; definition?: unknown };

/** Model javobidagi bandlar — maydon nomlari erkin (`answer`/`word`). */
export function parseWords(raw: string | null): { answer: string; clue: string }[] {
  const parsed = raw ? parseLlmObject<{ words?: unknown }>(raw) : null;
  const list = Array.isArray(parsed?.words) ? (parsed.words as RawWord[]) : [];
  return list
    .map((w) => ({
      answer: String(w?.answer ?? w?.word ?? "").trim(),
      clue: String(w?.clue ?? w?.definition ?? "")
        .replace(/\s+/g, " ")
        .trim(),
    }))
    .filter((w) => w.answer && w.clue);
}

/* ────────────────────────── hujjat qismlari ────────────────────────── */

const li = (text: string): Block => ({ kind: "li", text });

/**
 * Hujjat bo'limlari: to'r (rasm), gorizontal/vertikal savollar, javoblar.
 *
 * Javoblar bo'limi ALOHIDA: reyestrdagi `answerSeparate` (doim `true`)
 * — maket uni yangi betdan boshlaydi, aks holda o'quvchi to'rni
 * yechishdan oldin javobni ko'rardi.
 */
export function crosswordSections(
  place: PlaceResult,
  input: CrosswordInput,
  figures: { grid: string | null; answers: string | null },
): DocSection[] {
  const L = crosswordLabels(input.language);
  const clues = cluesOf(place.placed);
  const out: DocSection[] = [];

  const gridBlocks: Block[] = instructionLines(input, place.placed.length, input.language).map((t) => ({ kind: "p", text: t }) as Block);
  if (figures.grid) gridBlocks.push({ kind: "figure", text: L.grid, figureId: figures.grid });
  out.push({ id: "grid", title: L.grid, blocks: gridBlocks });

  out.push({
    id: "across",
    title: L.across,
    blocks: clues.across.map((c) => li(`${c.number}. ${c.text} (${c.length})`)),
  });
  out.push({
    id: "down",
    title: L.down,
    blocks: clues.down.map((c) => li(`${c.number}. ${c.text} (${c.length})`)),
  });

  const answerBlocks: Block[] = [];
  if (figures.answers) answerBlocks.push({ kind: "figure", text: L.answers, figureId: figures.answers });
  // Raqam → so'z ro'yxati: javob to'ri PNG chizilmasa ham (sharp yiqilsa)
  // o'qituvchi javoblarni ko'radi.
  for (const [dir, list] of [
    [L.across, clues.across],
    [L.down, clues.down],
  ] as const) {
    if (!list.length) continue;
    answerBlocks.push({ kind: "p", text: `${dir}: ${list.map((c) => `${c.number}. ${answerTextOf(place.placed, c.wordId)}`).join("; ")}` });
  }
  out.push({ id: "answers", title: L.answers, blocks: answerBlocks });

  return out;
}

const answerTextOf = (words: readonly CrosswordWord[], wordId: string): string => {
  const w = words.find((x) => x.id === wordId);
  return w ? wordText(w.answer) : "";
};

/** To'r rasmi — `FigureSpec kind:"svg"` (chizuvchi bizniki, `figurePng` PNG qiladi). */
export function crosswordFigure(place: PlaceResult, caption: string, o: { answers: boolean }): Figure {
  const svg = crosswordSvg(place.grid, place.placed, { answers: o.answers });
  const spec: FigureSpec = { kind: "svg", svg, widthMm: crosswordWidthMm(place.grid) };
  return { id: o.answers ? "crossword-answers" : "crossword-grid", kind: "scheme", caption, spec, w: 0, h: 0 };
}

async function drawFigures(figures: Figure[], lang: string, opts: CrosswordBuildOpts): Promise<Figure[]> {
  if (!figures.length) return [];
  try {
    const draw = opts.buildFigures ?? (await import("../../figures")).buildFigures;
    return await draw(figures, { lang });
  } catch (e) {
    console.warn("[crossword] to'r chizilmadi:", e instanceof Error ? e.message : e);
    return [];
  }
}

/** Yuklangan fayl matni — tarjima ekstraktori orqali (`teacher/test/engine.ts` naqshi). */
async function resolveSource(meta: DocMeta, opts: CrosswordBuildOpts): Promise<string> {
  if (meta.sourceText) return meta.sourceText;
  if (!opts.source) return "";
  if (opts.sourceTextOf) return opts.sourceTextOf(opts.source);
  try {
    const { extractSegments } = await import("../../translate/index");
    const ex = await extractSegments(opts.source.kind, opts.source.bytes);
    return ex.segments
      .map((s) => s.text)
      .join("\n\n")
      .slice(0, GAME_LIMITS.sourceTextChars);
  } catch (e) {
    console.warn("[crossword] manba fayl o'qilmadi:", e instanceof Error ? e.message : e);
    return "";
  }
}

/* ────────────────────────── asosiy ────────────────────────── */

export async function buildCrosswordDoc(meta: DocMeta, values: FormValues, opts: CrosswordBuildOpts): Promise<GameBuilt | null> {
  const complete = opts.complete ?? completeRole;
  if (!opts.complete && !llmEnabled()) return null;
  const { deadline } = opts;
  const now = opts.now ?? new Date();
  const meter = new CostMeter();
  const stage = (ev: GameStage) => opts.onStage?.(ev);

  const input = crosswordInputFromValues(meta, values);
  const spec = gameTypeOf("crossword", input.type);
  const seed = opts.seed ?? crosswordSeed(meta, input);

  const call = async (user: string, o: { maxTokens: number; timeoutMs: number }): Promise<string | null> => {
    const r = await complete("writer", crosswordSystemPrompt(input, spec), user, { json: true, ...o });
    if (r?.usage) {
      meter.add(r.usage);
      opts.onUsage?.(r.usage);
    }
    return r?.text ?? null;
  };

  /* ── 1. kirish ── */
  stage({ progress: 2, step: "Reja" });
  const sourceText = input.mode === "file" ? await resolveSource(meta, opts) : "";
  const blocks = { source: input.mode === "file" ? crosswordSourceBlock({ ...meta, sourceText: sourceText.slice(0, GAME_LIMITS.sourceTextChars) }) : "" };
  stage({ progress: STAGE.plan, step: "So'zlar" });

  /* ── 2. so'zlar ── */
  const tokensFor = (n: number) => Math.min(4000, 400 + n * 120);
  const timeoutFor = (n: number) => Math.min(Math.max(30_000, 10_000 + n * 2_000), 75_000, remainingMs(deadline));
  // Bir nechtasi dublikat/uzun bo'lib tushishini hisobga olib biroz ko'proq so'raymiz.
  const askCount = Math.min(input.wordCount + 3, input.wordCount * 2);
  let words = parseWords(await call(crosswordUserPrompt(input, { n: askCount }, blocks), { maxTokens: tokensFor(askCount), timeoutMs: timeoutFor(askCount) }));
  if (!words.length) return null;

  /* ── 3. to'r ── */
  stage({ progress: STAGE.words, step: "To'r" });
  let place = placeWords(words.slice(0, input.wordCount * 2), { maxSize: input.gridSize, seed });

  /*
   * QO'SHIMCHA SO'ROV — bir marta. Sig'magan so'z o'rniga QISQAROQ so'z
   * so'raladi (`retry`), keyin to'r BOSHIDAN, to'liq ro'yxat bilan
   * qayta quriladi: eski to'rga yamoq qo'yilsa ixchamlik yo'qolardi.
   */
  const missing = input.wordCount - place.placed.length;
  if (missing > 0 && remainingMs(deadline) > CROSSWORD_RETRY_MIN_MS) {
    stage({ progress: STAGE.words + 5, step: "So'zlar" });
    const avoid = words.map((w) => w.answer);
    const extra = parseWords(
      await call(crosswordUserPrompt(input, { n: missing + 2, avoid, retry: true }, blocks), {
        maxTokens: tokensFor(missing + 2),
        timeoutMs: timeoutFor(missing + 2),
      }),
    );
    if (extra.length) {
      words = [...words, ...extra];
      place = placeWords(words, { maxSize: input.gridSize, seed });
    }
  }
  if (!place.placed.length) return null;
  // Va'da qilingandan ortiq so'z joylashib qolsa — ortig'i kesiladi.
  place = trimTo(words, place, input, seed);

  /* ── 4. rasmlar va hujjat ── */
  const L = crosswordLabels(input.language);
  const drawn = await drawFigures(
    [crosswordFigure(place, L.grid, { answers: false }), crosswordFigure(place, L.answers, { answers: true })],
    input.language,
    opts,
  );
  const gridFig = drawn.find((f) => f.id === "crossword-grid") ?? null;
  const answersFig = drawn.find((f) => f.id === "crossword-answers") ?? null;

  stage({ progress: STAGE.grid, step: "Hisobot" });
  const model: GameModel = {
    v: 1,
    kind: "crossword",
    type: spec.id,
    language: input.language,
    topic: input.topic,
    crossword: { words: place.placed, grid: place.grid, clues: cluesOf(place.placed), dropped: place.dropped },
    ...(drawn.length ? { figures: drawn } : {}),
  };
  let doc: AcademicDoc = {
    meta,
    titlePage: true,
    toc: false,
    sections: crosswordSections(place, input, { grid: gridFig ? gridFig.id : null, answers: answersFig ? answersFig.id : null }),
    tables: [],
    game: model,
  };

  /* ── 5. hisobot ── */
  const ask = { wordCount: input.wordCount, gridSize: input.gridSize, hasAnswers: true, dropped: place.dropped };
  let review = await reviewCrossword(doc, { ask, complete, deadline, judge: opts.judge, now, onUsage: (u) => opts.onUsage?.(u) });
  doc = withReview(doc, review);

  /* ── 6. sayqal: TA'RIFNI qayta yozish (so'z o'zgarmaydi) ── */
  stage({ progress: STAGE.review, step: "Sayqal" });
  const wantPolish = opts.polish !== false && process.env.GAME_POLISH !== "0";
  if (wantPolish && remainingMs(deadline) > CROSSWORD_POLISH_MIN_MS) {
    const res = await runPolishWith<CrosswordPolishOp, CrosswordJudgeResult>(doc, review, {
      plan: (r) => planCrosswordPolish(r),
      userNeeds: () => crosswordUserNeeds(place, input),
      rewrite: (d, fix, fixDeadline) => rewriteClues(d, fix, { complete, input, spec, deadline: fixDeadline, onUsage: (u) => opts.onUsage?.(u), meter }),
      apply: (d, ops) => applyClueOps(d, ops),
      review: (d) => reviewCrossword(d, { ask, complete, deadline, judge: opts.judge, now, onUsage: (u) => opts.onUsage?.(u) }),
      judgeFromReview: (prev) => crosswordJudgeFromReview(prev),
      rescore: (fresh, j) => rescoreCrossword(fresh, j),
      acceptDelta: CROSSWORD_ACCEPT_DELTA,
      deadline,
      judge: opts.judge,
      now,
    });
    doc = withReview(res.doc, res.review);
    review = res.review;
  } else {
    doc = withReview(doc, { ...review, userNeeds: crosswordUserNeeds(place, input) });
  }

  stage({ progress: STAGE.done, step: "Tayyor" });
  const cost = meter.toJson();
  opts.onCost?.(cost);
  /*
   * `delivered` — TO'RGA TUSHGAN so'z soni. Dvigatel uni O'ZI qaytaradi:
   * qaysi so'z kesishma topolmagani faqat shu yerda ma'lum.
   */
  return { doc, cost, delivered: { got: place.placed.length, want: input.wordCount } };
}

/* ────────────────────────── yordamchilar ────────────────────────── */

/**
 * Va'dadan ORTIQ so'z joylashib qolsa, ro'yxat kesiladi va to'r qayta
 * quriladi: o'qituvchi «10 so'z» so'ragan bo'lsa 13 so'zli to'r olishi
 * ham nuqson (bet va vaqt boshqacha rejalangan).
 */
function trimTo(words: readonly { answer: string; clue: string }[], place: PlaceResult, input: CrosswordInput, seed: string): PlaceResult {
  if (place.placed.length <= input.wordCount) return place;
  const keep = new Set(place.placed.slice(0, input.wordCount).map((w) => wordText(w.answer)));
  const subset = words.filter((w) => keep.has(w.answer.toUpperCase()) || keep.has(w.answer));
  const again = placeWords(subset.length >= input.wordCount ? subset : words.slice(0, input.wordCount), { maxSize: input.gridSize, seed });
  return again.placed.length ? again : place;
}

function withReview(doc: AcademicDoc, review: AcademicDoc["game"] extends undefined ? never : NonNullable<AcademicDoc["game"]>["review"]): AcademicDoc {
  if (!doc.game || !review) return doc;
  return { ...doc, game: { ...doc.game, review } };
}
