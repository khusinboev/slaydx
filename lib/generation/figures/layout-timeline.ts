/**
 * Maqola 3 (AUDIT-18) WP-B — VAQT CHIZIG'I (`timeline`): gorizontal o'q,
 * har voqea — aylana belgi, `when` (yil/sana) belgi ostida qalin, `label`
 * navbatma-navbat TEPADA (kalta ulagich chiziq bilan) va PASTDA (`when`
 * ostida). 3–10 voqea; 7 tadan ko'p bo'lsa IKKI qator (birinchi qatorda
 * ko'prog'i), har qator o'z o'qi bilan chapdan o'ngga.
 *
 * Yorliq kengligi: navbatlash tufayli bir tomondagi qo'shnilar ikki qadam
 * uzoqda — yorliq ≤ 2·qadam − 12 px (≤ 190 px), ≤3 qator.
 */
import type { FigureSpec } from "../article/types";
import { FIGURE_LIMITS } from "../article/types";
import { CANVAS_W, FONT_PX, LINE_K, MARGIN, cleanLabel, emptyLayout, fitToCanvas, linesBox, wrapToWidth, type FigureLayout } from "./model";

export type TimelineSpec = Extract<FigureSpec, { kind: "timeline" }>;
export type TimelineEvent = { when: string; label: string };

export const TIMELINE_ROW_MAX = 6;
const DOT_R = 5;
const CONN = 14;
const LABEL_MAX_W = 190;
const ROW_GAP = 26;

/** Voqealar (ikkala maydon ham bo'sh bo'lmagan); 3–10 bo'lmasa `null`. */
export function timelineEvents(spec: TimelineSpec): TimelineEvent[] | null {
  if (!Array.isArray(spec.events)) return null;
  const events: TimelineEvent[] = [];
  for (const e of spec.events) {
    if (!e || typeof e !== "object") continue;
    const when = cleanLabel(e.when, 40);
    const label = cleanLabel(e.label, 90);
    if (!when || !label) continue;
    events.push({ when, label });
  }
  if (events.length < FIGURE_LIMITS.timelineMin) return null;
  return events.slice(0, FIGURE_LIMITS.timelineMax);
}

/** Qatorlarga bo'lish: ≤6 → bitta; aks holda ikkiga (birinchisi ko'proq). */
export function timelineRows(events: TimelineEvent[]): TimelineEvent[][] {
  if (events.length <= TIMELINE_ROW_MAX) return [events];
  const first = Math.ceil(events.length / 2);
  return [events.slice(0, first), events.slice(first)];
}

export function layoutTimeline(spec: TimelineSpec): FigureLayout | null {
  const events = timelineEvents(spec);
  if (!events) return null;
  const out = emptyLayout("timeline");
  const W = CANVAS_W - 2 * MARGIN;
  const labelSize = FONT_PX * 0.95;
  const whenSize = FONT_PX * 0.9;
  const lineH = labelSize * LINE_K;
  const whenH = whenSize * LINE_K;
  let y = 0;
  let idx = 0;
  timelineRows(events).forEach((row) => {
    const m = row.length;
    const pitch = W / m;
    const labelW = Math.min(LABEL_MAX_W, 2 * pitch - 12);
    const lines = row.map((e) => wrapToWidth(e.label, labelW, labelSize, 3));
    const above = (j: number) => j % 2 === 0;
    const aboveH = Math.max(0, ...lines.filter((_, j) => above(j)).map((l) => l.length * lineH));
    const belowH = Math.max(0, ...lines.filter((_, j) => !above(j)).map((l) => l.length * lineH));
    const yLine = y + aboveH + CONN + DOT_R + 2;
    // O'q chizig'i — chapdan o'ngga, oxirida uch; prim (belgilar USTIDA chizilsin, `edges` tugundan keyin chiziladi).
    out.prims.push({ k: "line", x1: 0, y1: yLine, x2: W, y2: yLine, arrow: true });
    row.forEach((e, j) => {
      const x = pitch * (j + 0.5);
      const n = idx++;
      const lw = Math.max(linesBox(lines[j], labelSize).tw + 8, 40);
      if (above(j)) {
        const top = yLine - DOT_R - CONN - lines[j].length * lineH;
        out.prims.push({ k: "line", x1: x, y1: yLine - DOT_R, x2: x, y2: yLine - DOT_R - CONN + 2 });
        out.nodes.push({ id: `e${n}`, x: x - lw / 2, y: top, w: lw, h: lines[j].length * lineH, lines: lines[j], shape: "none", size: labelSize });
      } else {
        const top = yLine + DOT_R + 4 + whenH + 2;
        out.nodes.push({ id: `e${n}`, x: x - lw / 2, y: top, w: lw, h: lines[j].length * lineH, lines: lines[j], shape: "none", size: labelSize });
      }
      out.prims.push({ k: "dot", x, y: yLine, r: DOT_R });
      out.texts.push({ x, y: yLine + DOT_R + 4 + whenH / 2, text: e.when, size: whenSize, bold: true, anchor: "middle" });
    });
    y = yLine + DOT_R + 4 + whenH + 2 + belowH + ROW_GAP;
  });
  fitToCanvas(out);
  return out;
}
