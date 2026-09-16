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

/** Rejimlar (§3): mavzu asosida yoki yuklangan fayl asosida. */
export const CROSSWORD_MODES = ["topic", "file"] as const;
export type CrosswordMode = (typeof CROSSWORD_MODES)[number];

export const isCrosswordMode = (v: unknown): v is CrosswordMode => (CROSSWORD_MODES as readonly string[]).includes(String(v));

/**
 * Reyestr chegaralari (§3 jadvali).
 *
 * R0 ning `games/types.ts GAME_LIMITS` i kelganda so'z uzunligi va to'r
 * o'lchami SHU YERDAN emas, undan olinadi (bitta manba); qolgan bandlar
 * (so'z soni chiplari, ta'rif uzunligi) krossvordga xos bo'lgani uchun
 * shu faylda qoladi.
 */
export const CROSSWORD_LIMITS = {
  /** So'z soni chiplari. */
  wordCounts: [5, 10, 15, 20] as const,
  wordCountDefault: 10,
  /** To'r o'lchami chiplari (toq, 13–21). */
  gridSizes: [13, 15, 17, 19, 21] as const,
  gridSizeDefault: 15,
  /** So'z uzunligi — KATAKDA (`grid.ts letters`). */
  answerMin: 3,
  answerMax: 15,
  /** Ta'rif uzunligi (belgi). */
  clueMin: 10,
  clueMax: 150,
  /** Mavzu va qo'shimcha talab uzunligi. */
  topicChars: 300,
  extraChars: 1000,
  /** Fayl rejimida promptga tushadigan manba matni. */
  sourceTextChars: 24_000,
} as const;

export type CrosswordInput = {
  mode: CrosswordMode;
  topic: string;
  subject: string;
  /** 0 — sinf ko'rsatilmagan. */
  grade: number;
  language: string;
  /** Va'da qilingan so'z soni (5/10/15/20). */
  wordCount: number;
  /** To'rning eng katta tomoni. */
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

/** Ro'yxatdagi eng yaqin ruxsat etilgan qiymat (chip). */
export function nearestChoice(want: number | null, choices: readonly number[], fallback: number): number {
  if (want === null || !choices.length) return fallback;
  return choices.reduce((best, c) => (Math.abs(c - want) < Math.abs(best - want) ? c : best), choices[0]);
}

export function crosswordInputFromValues(meta: DocMeta, values: FormValues): CrosswordInput {
  const modeRaw = s(values.mode, 20);
  const mode: CrosswordMode = isCrosswordMode(modeRaw) ? modeRaw : "topic";
  return {
    mode,
    topic: s(values.topic ?? meta.topic, CROSSWORD_LIMITS.topicChars),
    subject: s(values.subject ?? meta.subject, 120),
    grade: Math.max(0, Math.min(11, Math.round(num(values.grade) ?? num(meta.grade) ?? 0))),
    language: s(values.language ?? meta.language, 12) || "uz",
    wordCount: nearestChoice(num(values.wordCount ?? values.words ?? values.count), CROSSWORD_LIMITS.wordCounts, CROSSWORD_LIMITS.wordCountDefault),
    gridSize: nearestChoice(num(values.gridSize), CROSSWORD_LIMITS.gridSizes, CROSSWORD_LIMITS.gridSizeDefault),
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
export const crosswordSeed = (meta: DocMeta, input: CrosswordInput): string => `${meta.toolId ?? "crossword"}:${input.topic}:${input.wordCount}:${input.gridSize}`;
