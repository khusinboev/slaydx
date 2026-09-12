/**
 * Maqola 3 (AUDIT-18) WP-B — TAQQOSLASH (`compare`): ikki ustun yonma-yon
 * («an'anaviy vs taklif»), har ustunda bo'yalgan qalin sarlavha + ≤6 band
 * («•» bilan). `rows` berilsa — MEZON BO'YICHA jadvalsimon sxema: chapda
 * mezon nomi (bo'yalgan), ikki ustunda qiymat (`left.items[i]` /
 * `right.items[i]`, yo'q bo'lsa «—»); qator soni = `rows` soni (≤6).
 *
 * Jadvaldan farqi: bu RASM (PNG) — ramka, ustun sarlavhalari qalin va
 * bo'yalgan, matn qatorlarga o'raladi (`wrapToWidth`); hujjat jadvali emas.
 */
import type { FigureSpec } from "../article/types";
import { FIGURE_LIMITS } from "../article/types";
import { CANVAS_W, FONT_PX, LINE_K, MARGIN, PAD_X, PAD_Y, cleanLabel, emptyLayout, fitToCanvas, wrapToWidth, type FigureLayout } from "./model";
import { bulletIndent, bulletLines } from "./layout-matrix";

export type CompareSpec = Extract<FigureSpec, { kind: "compare" }>;
export type CompareSide = { title: string; items: string[] };
export type CompareData = { left: CompareSide; right: CompareSide; rows?: string[] };

export const COMPARE_HEAD_FILL = "#e6ebf1";
export const COMPARE_CRIT_FILL = "#f3f5f8";
const COL_GAP = 18;
const CRIT_SHARE = 0.28;
const ITEM_GAP = 4;

function sideOf(raw: unknown, max: number): CompareSide | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  const title = cleanLabel(s.title, 60);
  if (!title) return null;
  const items = (Array.isArray(s.items) ? s.items : []).map((x) => cleanLabel(x, 100)).filter(Boolean).slice(0, max);
  return { title, items };
}

/** Ikki tomon (sarlavha + ≥1 band) bo'lmasa `null`; `rows` bo'lsa bandlar qator soniga kesiladi. */
export function compareData(spec: CompareSpec): CompareData | null {
  const rows = (Array.isArray(spec.rows) ? spec.rows : []).map((r) => cleanLabel(r, 60)).filter(Boolean).slice(0, FIGURE_LIMITS.compareItems);
  const max = rows.length || FIGURE_LIMITS.compareItems;
  const left = sideOf(spec.left, max);
  const right = sideOf(spec.right, max);
  if (!left || !right || (!left.items.length && !right.items.length)) return null;
  return rows.length ? { left, right, rows } : { left, right };
}

export function layoutCompare(spec: CompareSpec): FigureLayout | null {
  const d = compareData(spec);
  if (!d) return null;
  const out = emptyLayout("compare");
  const W = CANVAS_W - 2 * MARGIN;
  const lineH = FONT_PX * LINE_K;
  const itemSize = FONT_PX * 0.95;
  const itemH = itemSize * LINE_K;
  if (d.rows) {
    /* Mezonli: 3 ustun — mezon | chap | o'ng; qator balandligi eng uzun katakka. */
    const critW = Math.round(W * CRIT_SHARE);
    const colW = (W - critW) / 2;
    const xs = [0, critW, critW + colW];
    const ws = [critW, colW, colW];
    const heads = [[], ...[d.left.title, d.right.title].map((t) => wrapToWidth(t, colW - 2 * PAD_X, FONT_PX, 2))];
    const headH = Math.max(...heads.slice(1).map((h) => h.length)) * lineH + 2 * PAD_Y;
    let y = 0;
    xs.forEach((x, c) => {
      out.nodes.push({ id: `h${c}`, x, y, w: ws[c], h: headH, lines: heads[c], shape: "rect", bold: true, fill: COMPARE_HEAD_FILL });
    });
    y += headH;
    d.rows.forEach((crit, i) => {
      const cells = [wrapToWidth(crit, critW - 2 * PAD_X, FONT_PX, 3), wrapToWidth(d.left.items[i] ?? "—", colW - 2 * PAD_X, itemSize, 3), wrapToWidth(d.right.items[i] ?? "—", colW - 2 * PAD_X, itemSize, 3)];
      const h = Math.max(cells[0].length * lineH, cells[1].length * itemH, cells[2].length * itemH) + 2 * PAD_Y;
      xs.forEach((x, c) => {
        out.nodes.push({
          id: `r${i}c${c}`,
          x,
          y,
          w: ws[c],
          h,
          lines: cells[c],
          shape: "rect",
          align: "start",
          ...(c === 0 ? { bold: true, fill: COMPARE_CRIT_FILL } : { size: itemSize }),
        });
      });
      y += h;
    });
  } else {
    /* Ikki ustun yonma-yon: sarlavha (bo'yalgan) + bandlar; ustunlar bir xil balandlikda. */
    const colW = (W - COL_GAP) / 2;
    const sides = [d.left, d.right].map((s) => ({
      head: wrapToWidth(s.title, colW - 2 * PAD_X, FONT_PX, 2),
      items: s.items.map((it) => bulletLines(it, colW - 2 * PAD_X, itemSize, 2)),
    }));
    const headH = Math.max(...sides.map((s) => s.head.length)) * lineH + 2 * PAD_Y;
    const bodyH = Math.max(...sides.map((s) => s.items.reduce((a, l) => a + l.length * itemH, 0) + ITEM_GAP * Math.max(0, s.items.length - 1))) + 2 * PAD_Y;
    sides.forEach((s, c) => {
      const x = c * (colW + COL_GAP);
      out.prims.push({ k: "rect", x, y: 0, w: colW, h: headH + bodyH, fill: "#fff", stroke: "#000" });
      out.nodes.push({ id: `h${c}`, x, y: 0, w: colW, h: headH, lines: s.head, shape: "rect", bold: true, fill: COMPARE_HEAD_FILL });
      let iy = headH + PAD_Y;
      s.items.forEach((lines, j) => {
        const h = lines.length * itemH;
        out.nodes.push({ id: `c${c}i${j}`, x, y: iy, w: colW, h, lines, shape: "none", align: "start", size: itemSize, indent: bulletIndent(itemSize) });
        iy += h + ITEM_GAP;
      });
    });
  }
  fitToCanvas(out);
  return out;
}
