/**
 * Maqola 3 (AUDIT-18) WP-B — QATLAMLI ARXITEKTURA (`layers`).
 *
 * Gorizontal tasmalar ustma-ust: `layers[0]` eng yuqorida (ilova/foydalanuvchi
 * qatlami), oxirgisi eng pastda (fizik/infratuzilma). Har tasma: chapda
 * bo'yalgan sarlavha katagi + o'ngda ≤4 band (kichik yumaloq bloklar);
 * bandsiz qatlamda sarlavha tasma markazida. Qatlamlar orasida ixtiyoriy
 * ikki tomonlama o'q (`arrows`, standart yoqiq) — qatlamlar o'zaro
 * muloqotda ekanini ko'rsatadi.
 *
 * Chegara: 2–7 qatlam (`FIGURE_LIMITS`); aks holda `null` → fallback ro'yxat.
 * Kenglik doim 160 mm (tasma butun kanvas), balandlik qatlam soniga qarab.
 */
import type { FigureSpec } from "../article/types";
import { FIGURE_LIMITS } from "../article/types";
import { CANVAS_W, FONT_PX, LINE_K, MARGIN, PAD_X, PAD_Y, cleanLabel, emptyLayout, fitToCanvas, wrapToWidth, type FigureLayout } from "./model";

export type LayersSpec = Extract<FigureSpec, { kind: "layers" }>;
export type LayerRow = { label: string; items: string[] };

/** Tasma sarlavha katagi rangi (PRISMA bosqich bandi bilan bir xil). */
export const LAYER_TITLE_FILL = "#e6ebf1";
const TITLE_W = 140;
const ITEM_GAP = 8;
const ITEM_PAD = 10;
const ITEM_PAD_Y = 8;
const GAP_ARROW = 32;
const GAP_PLAIN = 12;

/** Qatlamlarni tozalaydi: bo'sh yorliq tashlanadi, bandlar ≤4; 2–7 qatlam bo'lmasa `null`. */
export function layersData(spec: LayersSpec): LayerRow[] | null {
  if (!Array.isArray(spec.layers)) return null;
  const rows: LayerRow[] = [];
  for (const l of spec.layers) {
    if (!l || typeof l !== "object") continue;
    const label = cleanLabel(l.label, 80);
    if (!label) continue;
    const items = (Array.isArray(l.items) ? l.items : []).map((x) => cleanLabel(x, 80)).filter(Boolean).slice(0, FIGURE_LIMITS.layerItems);
    rows.push({ label, items });
  }
  if (rows.length < FIGURE_LIMITS.layersMin) return null;
  return rows.slice(0, FIGURE_LIMITS.layersMax);
}

export function layoutLayers(spec: LayersSpec): FigureLayout | null {
  const rows = layersData(spec);
  if (!rows) return null;
  const arrows = spec.arrows !== false;
  const out = emptyLayout("layers");
  const W = CANVAS_W - 2 * MARGIN;
  const anyItems = rows.some((r) => r.items.length > 0);
  const titleW = anyItems ? TITLE_W : W;
  const lineH = FONT_PX * LINE_K;
  const itemSize = FONT_PX * 0.92;
  const gap = arrows ? GAP_ARROW : GAP_PLAIN;
  let y = 0;
  rows.forEach((r, i) => {
    const titleLines = wrapToWidth(r.label, titleW - 2 * PAD_X, FONT_PX, 3);
    const titleH = titleLines.length * lineH + 2 * PAD_Y;
    const n = r.items.length;
    let itemW = 0;
    let itemLines: string[][] = [];
    let itemH = 0;
    if (n) {
      itemW = (W - titleW - 2 * ITEM_PAD - ITEM_GAP * (n - 1)) / n;
      itemLines = r.items.map((it) => wrapToWidth(it, itemW - 2 * 6, itemSize, 3));
      itemH = Math.max(...itemLines.map((l) => l.length)) * itemSize * LINE_K + 2 * PAD_Y;
    }
    const bandH = Math.max(36, titleH, n ? itemH + 2 * ITEM_PAD_Y : 0);
    // Tasma — butun kenglikda.
    out.prims.push({ k: "rect", x: 0, y, w: W, h: bandH, fill: "#fff", stroke: "#000" });
    // Sarlavha katagi (bandli qatlamda chapda bo'yalgan; aks holda tasma markazida).
    out.nodes.push({ id: `L${i}`, x: 0, y, w: titleW, h: bandH, lines: titleLines, shape: anyItems ? "rect" : "none", bold: true, ...(anyItems ? { fill: LAYER_TITLE_FILL } : {}) });
    r.items.forEach((_, j) => {
      const x = titleW + ITEM_PAD + j * (itemW + ITEM_GAP);
      out.nodes.push({ id: `L${i}i${j}`, x, y: y + (bandH - itemH) / 2, w: itemW, h: itemH, lines: itemLines[j], shape: "rounded", rx: 6, size: itemSize });
    });
    if (i > 0 && arrows) {
      // Ikki tomonlama o'q — oraliq markazida, ikki tasma chetidan 3 px ichkarida.
      const cx = W / 2;
      out.edges.push({ from: `L${i - 1}`, to: `L${i}`, points: [{ x: cx, y: y - gap + 3 }, { x: cx, y: y - 3 }], arrow: true, arrowStart: true });
    }
    y += bandH + gap;
  });
  fitToCanvas(out);
  return out;
}
