/**
 * OMR JAVOBLAR VARAG'I — spec va hujjat bloki (AUDIT-20 WP-B).
 *
 * Ikki qatlam ATAYLAB ajratilgan:
 *   — CHIZUVCHI `figures/omr.ts` (millimetr maketi, SVG) — u testdan ham,
 *     modeldan ham mustaqil, faqat `FigureSpec kind:"omr"` ni biladi;
 *   — SPEC bu yerda: `TestModel` dan (savol soni, variantlar, turlar)
 *     strukturaviy tavsif chiqariladi.
 *
 * Nega xom SVG saqlanmaydi: `Figure.spec` — YAGONA manba. O'qituvchi
 * ko'ruvchida savolni o'chirsa yoki variant qo'shsa, blankani QAYTA
 * chizish kerak bo'ladi; saqlangan SVG esa eski savol soni bilan qolib
 * ketardi (R3 §6.1 tuzatishi).
 */
import { TEACHER_LIMITS, isOmrQuestionKind, type TestOmr, type TestQuestion, type TestVariant } from "../types";
import type { Figure, FigureSpec } from "../../types";
import { omrColumns, omrFits, omrQuestions } from "./questions";

export type OmrFigureSpec = Extract<FigureSpec, { kind: "omr" }>;

/** Javob varag'idagi savollar soni — `open`/`match` hisobga kirmaydi. */
export const omrCount = (questions: readonly TestQuestion[]): number => omrQuestions(questions).length;

/**
 * `TestModel` → OMR spec.
 *
 * `optionCount` — varaqdagi doiralar soni: eng KO'P variantli savolga
 * qarab olinadi (aralash testda 3 variantli savol ham, 4 variantli ham
 * bo'lishi mumkin; kam doira chizilsa to'g'ri javobni belgilab
 * bo'lmasdi). `truefalse` ikki doira ishlatadi, lekin uchinchi/to'rtinchi
 * doira bo'sh qolishi bosma blankada odatiy.
 */
export function omrSpecOf(questions: readonly TestQuestion[], variants: readonly TestVariant[]): OmrFigureSpec | null {
  const list = omrQuestions(questions);
  if (!list.length || !omrFits(list.length)) return null;
  const widest = Math.max(...list.map((q) => q.options.length || TEACHER_LIMITS.optionsMin));
  const optionCount = Math.max(TEACHER_LIMITS.optionsMin, Math.min(TEACHER_LIMITS.optionsMax, widest));
  return {
    kind: "omr",
    count: list.length,
    optionCount,
    columns: omrColumns(list.length),
    variantIds: variants.map((v) => v.id),
    idBoxes: TEACHER_LIMITS.omrIdBoxes,
    hasMulti: list.some((q) => q.kind === "multi"),
  };
}

/** Spec dagi `kind` siz qism — `TestModel.omr` (ikki joyda qo'lda yozilmasin). */
export function omrModelOf(spec: OmrFigureSpec): TestOmr {
  const { kind: _kind, ...rest } = spec;
  void _kind;
  return rest;
}

/** Hujjatdagi rasm yozuvi — `buildFigures` uni PNG ga aylantiradi. */
export function omrFigure(spec: OmrFigureSpec, caption: string): Figure {
  return { id: "omr", kind: "scheme", caption, spec, w: 0, h: 0 };
}

/**
 * Savol turlari OMR ga umuman tushadimi — forma va hisobot uchun.
 * Faqat `open`/`match` bo'lgan testda javob varag'i MA'NOSIZ.
 */
export const omrUsable = (questions: readonly TestQuestion[]): boolean => questions.some((q) => isOmrQuestionKind(q.kind));
