import type { ViewerKind } from "@/lib/viewers/kind";

/**
 * Ko'ruvchi ramkasi shartnomasi (viewer redesign V0, `docs/viewer/PLAN.md`).
 *
 * - `flow` — ko'ruvchi SAHIFA scroll'ida oqadi (hujjatlar, rezyume, rasm,
 *   audio, tarjima): ichki `overflow-auto` qutisi yo'q, toolbar
 *   `sticky top-[var(--result-header-h)]`.
 * - `fill` — ko'ruvchi sticky sarlavha ostidagi QOLGAN ekranni aynan
 *   egallaydi (`var(--result-fill-h)`), sahnasini o'zi boshqaradi (slayd).
 *
 * `boxed` — VAQTINCHALIK ko'prik: ko'ruvchi hali eski «o'z scroll'i bor
 * quti» shaklida (`h-full min-h-[70vh]` + ichki `Workspace`). Ramka unga
 * qat'iy balandlik (qolgan ekran) beradi — ichki scroll ishlaydi, hech
 * narsa kesilmaydi. Har WP o'z ko'ruvchisini haqiqiy oqimga o'tkazganda
 * O'Z QATORIDA `boxed: false` qiladi (V1: academic/essay/article/teacher/
 * game/resume).
 */
export type FrameMode = "flow" | "fill";
export type FrameSpec = { mode: FrameMode; boxed: boolean };

export const VIEWER_FRAME: Record<ViewerKind, FrameSpec> = {
  slides: { mode: "fill", boxed: false }, // V2
  academic: { mode: "flow", boxed: true }, // V1
  essay: { mode: "flow", boxed: true }, // V1
  article: { mode: "flow", boxed: true }, // V1
  teacher: { mode: "flow", boxed: true }, // V1
  game: { mode: "flow", boxed: true }, // V1
  resume: { mode: "flow", boxed: true }, // V1
  image: { mode: "flow", boxed: false }, // V4
  audio: { mode: "flow", boxed: false }, // V4
  translation: { mode: "flow", boxed: false }, // V4
};

export function viewerFrame(kind: ViewerKind): FrameSpec {
  return VIEWER_FRAME[kind];
}

/**
 * Ramka o'ramining klasslari. CSS o'zgaruvchilari `ResultLayout` ildizida
 * e'lon qilinadi; ko'ruvchi boshqa joyda (masalan test) chizilsa zaxira
 * qiymat ishlaydi.
 *
 * - fill / boxed: `height: var(--result-fill-h)` — sarlavha ostidagi qolgan ekran;
 * - flow: `min-height` xuddi shu — qisqa hujjat ham ekranni to'ldiradi,
 *   uzuni esa sahifani cho'zadi (ichki quti yo'q).
 */
export function frameClass(spec: FrameSpec): string {
  if (spec.mode === "fill" || spec.boxed) return "flex h-[var(--result-fill-h,100svh)] min-h-80 flex-col";
  return "flex min-h-[var(--result-fill-h,0px)] flex-col";
}
