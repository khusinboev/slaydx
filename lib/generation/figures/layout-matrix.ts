/**
 * Maqola 3 (AUDIT-18) WP-B — 2×2 MATRITSA (`matrix`): aynan 4 kvadrant
 * (tartib: yuqori-chap, yuqori-o'ng, pastki-chap, pastki-o'ng), har birida
 * bo'yalgan sarlavha yo'lakchasi + ≤4 band («•» bilan, chapdan). O'qlar
 * ixtiyoriy: `xAxis` — panjara ostida o'ngga o'q (`low` chapda, `high`
 * o'ngda, `label` o'rtada qalin); `yAxis` — chapda yuqoriga o'q (burilgan
 * matn: `low` pastda, `high` tepada). SWOT — o'qsiz, 4 kvadrant.
 *
 * Kataklar bir xil o'lchamda (eng katta mazmunga qarab) — panjara tekis.
 */
import type { FigureAxis, FigureSpec } from "../article/types";
import { FIGURE_LIMITS } from "../article/types";
import { CANVAS_W, FONT_PX, LINE_K, MARGIN, PAD_X, PAD_Y, cleanLabel, emptyLayout, fitToCanvas, textWidth, wrapToWidth, type FigureLayout } from "./model";

export type MatrixSpec = Extract<FigureSpec, { kind: "matrix" }>;
export type Quadrant = { title: string; items: string[] };
export type MatrixData = { quadrants: [Quadrant, Quadrant, Quadrant, Quadrant]; xAxis?: FigureAxis; yAxis?: FigureAxis };

export const MATRIX_TITLE_FILL = "#e6ebf1";
const AXIS_W = 30;
const AXIS_GAP = 10;
const ITEM_GAP = 3;

function axisOf(raw: unknown): FigureAxis | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const a = raw as Record<string, unknown>;
  const low = cleanLabel(a.low, 30);
  const high = cleanLabel(a.high, 30);
  if (!low || !high) return undefined;
  const label = cleanLabel(a.label, 40);
  return label ? { low, high, label } : { low, high };
}

/** 4 kvadrant (sarlavhali) bo'lmasa `null`; bandlar ≤4; o'qlar faqat `low`+`high` bilan. */
export function matrixData(spec: MatrixSpec): MatrixData | null {
  if (!Array.isArray(spec.quadrants)) return null;
  const quadrants: Quadrant[] = [];
  for (const q of spec.quadrants) {
    if (!q || typeof q !== "object") continue;
    const title = cleanLabel(q.title, 60);
    if (!title) continue;
    const items = (Array.isArray(q.items) ? q.items : []).map((x) => cleanLabel(x, 90)).filter(Boolean).slice(0, FIGURE_LIMITS.quadrantItems);
    quadrants.push({ title, items });
  }
  if (quadrants.length !== FIGURE_LIMITS.quadrants) return null;
  const out: MatrixData = { quadrants: quadrants as MatrixData["quadrants"] };
  const x = axisOf(spec.xAxis);
  const y = axisOf(spec.yAxis);
  if (x) out.xAxis = x;
  if (y) out.yAxis = y;
  return out;
}

/** «•» chekinishi (px) — davom qatorlari shu qadar o'ngga (`LayoutNode.indent`). */
export const bulletIndent = (fontPx: number): number => textWidth("• ", fontPx);

/** Band qatorlari (o'lchangan kenglik bo'yicha): birinchi qator «• » bilan, davomi `indent` bilan chiziladi. */
export function bulletLines(item: string, maxPx: number, fontPx: number, maxLines = 2): string[] {
  return wrapToWidth(item, maxPx - bulletIndent(fontPx), fontPx, maxLines).map((l, i) => (i === 0 ? `• ${l}` : l));
}

export function layoutMatrix(spec: MatrixSpec): FigureLayout | null {
  const d = matrixData(spec);
  if (!d) return null;
  const out = emptyLayout("matrix");
  const W = CANVAS_W - 2 * MARGIN;
  const axisSize = FONT_PX * 0.9;
  // O'q yorlig'i (qalin) `low`/`high` bilan bitta qatorga sig'masa — ikkinchi qatorga (x); y da doim alohida ustun.
  const axisNeed = (a: FigureAxis) => textWidth(a.low, axisSize) + textWidth(a.high, axisSize) + (a.label ? textWidth(a.label, axisSize) * 1.1 : 0) + 2 * 16;
  const yTwo = Boolean(d.yAxis?.label);
  const x0 = d.yAxis ? AXIS_W + (yTwo ? axisSize * 1.4 : 0) + AXIS_GAP : 0;
  const gw = W - x0;
  const cw = gw / 2;
  const itemSize = FONT_PX * 0.95;
  const lineH = FONT_PX * LINE_K;
  const itemH = itemSize * LINE_K;
  const cells = d.quadrants.map((q) => {
    const title = wrapToWidth(q.title, cw - 2 * PAD_X, FONT_PX, 2);
    const items = q.items.map((it) => bulletLines(it, cw - 2 * PAD_X, itemSize, 2));
    const titleH = title.length * lineH + 2 * PAD_Y;
    const bodyH = items.length ? items.reduce((s, l) => s + l.length * itemH, 0) + ITEM_GAP * (items.length - 1) + 2 * PAD_Y : 0;
    return { title, items, titleH, bodyH };
  });
  const titleH = Math.max(...cells.map((c) => c.titleH));
  const bodyH = Math.max(...cells.map((c) => c.bodyH), 0);
  const ch = titleH + bodyH;
  cells.forEach((c, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = x0 + col * cw;
    const y = row * ch;
    out.prims.push({ k: "rect", x, y, w: cw, h: ch, fill: "#fff", stroke: "#000" });
    out.nodes.push({ id: `q${i + 1}`, x, y, w: cw, h: titleH, lines: c.title, shape: "rect", bold: true, fill: MATRIX_TITLE_FILL });
    let iy = y + titleH + PAD_Y;
    c.items.forEach((lines, j) => {
      const h = lines.length * itemH;
      out.nodes.push({ id: `q${i + 1}i${j}`, x, y: iy, w: cw, h, lines, shape: "none", align: "start", size: itemSize, indent: bulletIndent(itemSize) });
      iy += h + ITEM_GAP;
    });
  });
  const gy1 = 2 * ch;
  if (d.xAxis) {
    const ay = gy1 + AXIS_GAP + 4;
    out.prims.push({ k: "line", x1: x0, y1: ay, x2: x0 + gw, y2: ay, arrow: true });
    const ty = ay + 6 + axisSize * 0.7;
    out.texts.push({ x: x0 + 2, y: ty, text: d.xAxis.low, size: axisSize, anchor: "start" });
    out.texts.push({ x: x0 + gw - 2, y: ty, text: d.xAxis.high, size: axisSize, anchor: "end" });
    // Yorliq: bitta qatorga sig'sa o'rtada, sig'masa ikkinchi qatorda.
    if (d.xAxis.label) out.texts.push({ x: x0 + gw / 2, y: axisNeed(d.xAxis) > gw ? ty + axisSize * LINE_K : ty, text: d.xAxis.label, size: axisSize, anchor: "middle", bold: true });
  }
  if (d.yAxis) {
    const ax = x0 - AXIS_GAP - 4;
    out.prims.push({ k: "line", x1: ax, y1: gy1, x2: ax, y2: 0, arrow: true });
    const tx = ax - 6 - axisSize * 0.7;
    // Burilgan (−90°) matn: `start` — pastdan yuqoriga o'sadi, `end` — yuqorida tugaydi.
    out.texts.push({ x: tx, y: gy1 - 2, text: d.yAxis.low, size: axisSize, anchor: "start", rotate: -90 });
    out.texts.push({ x: tx, y: 2, text: d.yAxis.high, size: axisSize, anchor: "end", rotate: -90 });
    // Yorliq — panjara past bo'lgani uchun DOIM alohida (chaproq) ustunda: `low`/`high` bilan ustma-ust tushmasin.
    if (d.yAxis.label) out.texts.push({ x: tx - axisSize * 1.4, y: gy1 / 2, text: d.yAxis.label, size: axisSize, anchor: "middle", bold: true, rotate: -90 });
  }
  fitToCanvas(out);
  return out;
}
