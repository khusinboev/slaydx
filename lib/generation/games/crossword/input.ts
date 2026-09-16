/**
 * KROSSVORD KIRISHI (AUDIT-21 WP-A) — formadan dvigatelgacha.
 *
 * `teacher/test/input.ts` naqshi: `FormValues` bilan `CrosswordInput`
 * orasidagi YAGONA ko'prik. `extractMeta` umumiy va `mode`/`wordCount`/
 * `gridSize` kabi maydonlarni bilmaydi, `subject`/`grade`/`language` esa
 * undan keladi — ikkala manba shu yerda BIRLASHTIRILADI.
 *
 * Har qiymat REYESTRDAN chegaralanadi (`docs/research/crossword.md` §3):
 * forma «12 so'z» yuborsa ham dvigatel ruxsat etilgan chipga (10)
 * tushiradi — reyestrdan tashqari son bilan hech qachon ishlamaydi.
 *
 * Server importi YO'Q (izomorf).
 */
import type { FormValues } from "../../../types";
import type { DocMeta } from "../../types";
import { GAME_LIMITS, normalizeGameCount } from "../types";
import { normalizeGameType } from "../registry";
import { autoGridSize } from "./grid";

/** Rejimlar (§3): mavzu asosida yoki yuklangan fayl asosida. */
export const CROSSWORD_MODES = ["topic", "file"] as const;
export type CrosswordMode = (typeof CROSSWORD_MODES)[number];

export const isCrosswordMode = (v: unknown): v is CrosswordMode => (CROSSWORD_MODES as readonly string[]).includes(String(v));

/**
 * Reyestr chegaralari — HAMMASI R0 `GAME_LIMITS` dan.
 *
 * Bu yerda faqat QISQA nomlar beriladi (`answerMin` ↔ `wordLettersMin`):
 * ikkinchi manba emas, o'sha qiymatlarning krossvordcha o'qilishi.
 */
export const CROSSWORD_LIMITS = {
  /** So'z soni chiplari. */
  wordCounts: GAME_LIMITS.counts,
  wordCountDefault: GAME_LIMITS.countDefault,
  /** So'z uzunligi — KATAKDA (`grid.ts letters`). */
  answerMin: GAME_LIMITS.wordLettersMin,
  answerMax: GAME_LIMITS.wordLettersMax,
  /** Ta'rif uzunligi (belgi). */
  clueMin: GAME_LIMITS.clueCharsMin,
  clueMax: GAME_LIMITS.clueCharsMax,
  /** Mavzu va qo'shimcha talab uzunligi. */
  topicChars: GAME_LIMITS.topicChars,
  extraChars: GAME_LIMITS.extraChars,
  /** Fayl rejimida promptga tushadigan manba matni. */
  sourceTextChars: GAME_LIMITS.sourceTextChars,
} as const;

export type CrosswordInput = {
  mode: CrosswordMode;
  /** Reyestr TUR id (`klassik` | `tarifli`) — `GameModel.type`. */
  type: string;
  topic: string;
  subject: string;
  /** 0 — sinf ko'rsatilmagan. */
  grade: number;
  language: string;
  /** Va'da qilingan so'z soni (5/10/15/20). */
  wordCount: number;
  /**
   * To'rning eng katta tomoni — AVTOMAT (`autoGridSize`), formada maydon
   * YO'Q (egasining qarori): to'r baribir ramka bo'yicha kesiladi, ya'ni
   * foydalanuvchi tanlagan «15×15» chop etiladigan o'lchamni belgilamas,
   * faqat algoritmga chegara qo'yardi.
   */
  gridSize: number;
  extra: string;
  institution: string;
  author: string;
  /** Fayl rejimida formadan kelgan manba matni. */
  sourceText: string;
};

const s = (v: unknown, max = 300): string =>
  String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function crosswordInputFromValues(meta: DocMeta, values: FormValues): CrosswordInput {
  const modeRaw = s(values.mode, 20);
  const mode: CrosswordMode = isCrosswordMode(modeRaw) ? modeRaw : "topic";
  const wordCount = normalizeGameCount(values.wordCount ?? values.words ?? values.count);
  return {
    mode,
    type: normalizeGameType("crossword", values.crosswordType ?? values.type),
    topic: s(values.topic ?? meta.topic, CROSSWORD_LIMITS.topicChars),
    subject: s(values.subject ?? meta.subject, 120),
    grade: Math.max(0, Math.min(11, Math.round(num(values.grade) ?? num(meta.grade) ?? 0))),
    language: s(values.language ?? meta.language, 12) || "uz",
    wordCount,
    gridSize: autoGridSize(wordCount),
    extra: s(values.extra ?? meta.extra, CROSSWORD_LIMITS.extraChars),
    institution: s(values.university ?? meta.university, 200),
    author: s(values.author ?? meta.author, 120),
    sourceText: mode === "file" ? s(values.sourceText ?? meta.sourceText, CROSSWORD_LIMITS.sourceTextChars) : "",
  };
}

/**
 * Determinizm urug'i — bitta buyurtma har doim bitta to'r beradi.
 * Mavzu va so'z sonidan quriladi (tasodif/sana ARALASHMAYDI).
 */
export const crosswordSeed = (meta: DocMeta, input: CrosswordInput): string =>
  `${meta.toolId ?? "crossword"}:${input.type}:${input.topic}:${input.wordCount}:${input.gridSize}`;
