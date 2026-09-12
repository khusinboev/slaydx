/**
 * Maqola 3 (AUDIT-18) WP-B — SIKL (`cycle`): 3–8 bosqich ellips bo'ylab,
 * qo'shni bosqichlar orasida yoy o'q (SVG `A` + marker), markazda ixtiyoriy
 * yorliq. Birinchi bosqich TEPADA (−90°), keyingilari soat yo'nalishida
 * (`clockwise` standart; `false` — teskari).
 *
 * Geometriya: bosqich bloklari bir xil o'lchamda (matnning eng kengiga
 * qarab) — simmetriya; radius iterativ topiladi: bloklar bir-biriga tegmasin
 * (≥14 px), markaz yorlig'iga tegmasin (≥10 px), har yoy kamida 12° ko'rinsin.
 * Ellips (ry = 0.85·rx) — kanvas balandligi kvadratdan biroz kam.
 */
import type { FigureSpec } from "../article/types";
import { FIGURE_LIMITS } from "../article/types";
import { FONT_PX, LINE_K, PAD_X, PAD_Y, charsFor, cleanLabel, ellipsePt, emptyLayout, fitToCanvas, linesBox, wrapLabel, type FigureLayout, type Pt } from "./model";

export type CycleSpec = Extract<FigureSpec, { kind: "cycle" }>;

export const CYCLE_KY = 0.85;
const NODE_GAP = 16;
const CENTER_GAP = 10;
const ARC_PAD = 3;
/** Yoy uzunligi kamida shuncha px — o'q uchi (9 px) + ko'rinadigan tana; aks holda radius o'sadi. */
const MIN_ARC_PX = 28;

/** Bosqich yorliqlari (bo'shlar tashlanadi); 3–8 bo'lmasa `null`. */
export function cycleSteps(spec: CycleSpec): string[] | null {
  if (!Array.isArray(spec.steps)) return null;
  const steps = spec.steps.map((s) => cleanLabel(s && typeof s === "object" ? (s as { label?: unknown }).label : s, 80)).filter(Boolean);
  if (steps.length < FIGURE_LIMITS.cycleMin) return null;
  return steps.slice(0, FIGURE_LIMITS.cycleMax);
}

type Box = { x: number; y: number; w: number; h: number };

function apart(a: Box, b: Box, gap: number): boolean {
  return a.x + a.w + gap <= b.x || b.x + b.w + gap <= a.x || a.y + a.h + gap <= b.y || b.y + b.h + gap <= a.y;
}

function inside(p: Pt, b: Box, pad: number): boolean {
  return p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad;
}

/** Burchakni `from` dan `dir` yo'nalishda 0.5° qadam bilan yurib, blokdan tashqaridagi birinchi nuqta burchagi. */
function exitAngle(cx: number, cy: number, rx: number, ry: number, from: number, dir: 1 | -1, box: Box, limitDeg: number): number {
  for (let d = 0; d <= limitDeg; d += 0.5) {
    const a = from + dir * d;
    if (!inside(ellipsePt(cx, cy, rx, ry, a), box, ARC_PAD)) return a;
  }
  return from + dir * limitDeg;
}

export function layoutCycle(spec: CycleSpec): FigureLayout | null {
  const steps = cycleSteps(spec);
  if (!steps) return null;
  const n = steps.length;
  const dir: 1 | -1 = spec.clockwise === false ? -1 : 1;
  const maxChars = n >= 7 ? 12 : 14;
  const lines = steps.map((s) => wrapLabel(s, maxChars, 3));
  const tw = Math.max(...lines.map((l) => linesBox(l).tw));
  const th = Math.max(...lines.map((l) => l.length)) * FONT_PX * LINE_K;
  const w = Math.max(84, tw + 2 * PAD_X);
  const h = Math.max(34, th + 2 * PAD_Y);
  const center = cleanLabel(spec.center, 60);
  const centerLines = center ? wrapLabel(center, 16, 3) : [];
  const cb = center ? linesBox(centerLines) : { tw: 0, th: 0 };
  const centerBox: Box | null = center ? { x: -cb.tw / 2 - 4, y: -cb.th / 2 - 2, w: cb.tw + 8, h: cb.th + 4 } : null;
  const step = 360 / n;
  const angles = steps.map((_, i) => -90 + dir * i * step);

  // Radius: qadam 4 px; bloklar va markaz to'qnashmasin, yoy ko'rinsin.
  let R = Math.max(60, (w + NODE_GAP) / (2 * Math.sin(Math.PI / n)) * 0.6);
  let boxes: Box[] = [];
  let arcs: { a0: number; a1: number }[] = [];
  for (let it = 0; it < 200; it++) {
    const rx = R;
    const ry = R * CYCLE_KY;
    boxes = angles.map((a) => {
      const c = ellipsePt(0, 0, rx, ry, a);
      return { x: c.x - w / 2, y: c.y - h / 2, w, h };
    });
    let ok = true;
    for (let i = 0; i < n && ok; i++) for (let j = i + 1; j < n; j++) if (!apart(boxes[i], boxes[j], NODE_GAP)) ok = false;
    if (ok && centerBox) for (const b of boxes) if (!apart(b, centerBox, CENTER_GAP)) ok = false;
    if (ok) {
      arcs = angles.map((a, i) => {
        const j = (i + 1) % n;
        const a0 = exitAngle(0, 0, rx, ry, a, dir, boxes[i], step);
        const a1 = exitAngle(0, 0, rx, ry, a + dir * step, (dir * -1) as 1 | -1, boxes[j], step);
        return { a0, a1 };
      });
      // Yoy uzunligi (ellips o'rtacha radiusi bilan taxminan).
      const rMean = (rx + ry) / 2;
      if (arcs.some((arc) => (Math.abs(arc.a1 - arc.a0) * Math.PI * rMean) / 180 < MIN_ARC_PX)) ok = false;
    }
    if (ok) break;
    R += 4;
  }
  const out = emptyLayout("cycle");
  const rx = R;
  const ry = R * CYCLE_KY;
  steps.forEach((_, i) => {
    out.nodes.push({ id: `c${i + 1}`, x: boxes[i].x, y: boxes[i].y, w, h, lines: lines[i], shape: "rounded", rx: 10 });
  });
  arcs.forEach((arc) => {
    out.prims.push({ k: "arc", cx: 0, cy: 0, rx, ry, a0: arc.a0, a1: arc.a1, sweep: dir === 1 ? 1 : 0, arrow: true });
  });
  if (centerBox) out.nodes.push({ id: "center", x: centerBox.x, y: centerBox.y, w: centerBox.w, h: centerBox.h, lines: centerLines, shape: "none", bold: true });
  fitToCanvas(out);
  return out;
}
