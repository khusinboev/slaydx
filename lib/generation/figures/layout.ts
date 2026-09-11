/**
 * Maqola 2 (AUDIT-17) WP3 — sxema MAKETI: `FigureSpec` → `FigureLayout`.
 * DOM YO'Q, izomorf; birlik px @ 96 dpi (`model.ts`).
 *
 * Turlar:
 *   flow    — qatlamli maket (Sugiyama soddalashtirilgan): rank (eng uzun
 *             yo'l, DAG; sikl → null) → barisentr tartib (2×2 o'tish) →
 *             pozitsiya (matn kengligi + median tekislash) → ortogonal
 *             qirralar (qatlamlar orasidagi «shina» chizig'ida buriladi,
 *             tugun tanasini kesib o'tmaydi). Uzun qirralar virtual tugunlar
 *             orqali o'tadi. TB/LR — bitta kod, o'qlar almashadi.
 *   process — ≤5 qadam gorizontal, >5 vertikal; raqam doirasi (badge).
 *   tree    — yuqoridan pastga (Reingold–Tilford soddalashtirilgan);
 *             barglar ko'p bo'lsa «osilgan barglar» rejimi (vertikal ro'yxat).
 *   prisma  — `prisma.ts`, chart — `chart.ts`.
 *
 * Chegaralar (`ARTICLE_LIMITS`): >14 tugun / >24 qirra / sikl / chuqurlik >4
 * → `null` → chaqiruvchi (`index.ts`) raqamlangan ro'yxat fallback beradi.
 */
import type { FigureNode, FigureSpec, TreeNode } from "../article/types";
import { ARTICLE_LIMITS } from "../article/types";
import {
  CANVAS_W,
  FONT_PX,
  LINE_K,
  MARGIN,
  PAD_X,
  PAD_Y,
  dedupePoints,
  emptyLayout,
  fitToCanvas,
  nodeSize,
  orthoPath,
  textWidth,
  wrapLabel,
  type FigureLayout,
  type LayoutEdge,
  type LayoutNode,
  type NodeShape,
  type Pt,
} from "./model";
import { layoutPrisma } from "./prisma";
import { layoutChart } from "./chart";

export type { FigureLayout, LayoutEdge, LayoutNode, LayoutText, NodeShape, Prim, PatternDef, Pt } from "./model";
export { CANVAS_W, FONT_PX, FIGURE_WIDTH_MM, FONT_FAMILY, textWidth, wrapLabel } from "./model";

export type LayoutOpts = { lang?: string };

/** Asosiy kirish: spec → maket yoki `null` (fallback). */
export function layoutFigure(spec: FigureSpec, opts: LayoutOpts = {}): FigureLayout | null {
  if (!spec || typeof spec !== "object") return null;
  try {
    switch (spec.kind) {
      case "flow":
        return layoutFlow(spec);
      case "process":
        return layoutProcess(spec);
      case "tree":
        return layoutTree(spec);
      case "prisma":
        return layoutPrisma(spec, opts.lang ?? "uz");
      case "chart":
        return layoutChart(spec, opts.lang ?? "uz");
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/* ══════════════════════════ FLOW ══════════════════════════ */

type FlowSpec = Extract<FigureSpec, { kind: "flow" }>;

/** Ichki tugun (haqiqiy yoki virtual). */
type FNode = {
  id: string;
  label: string;
  shape: NodeShape;
  virtual: boolean;
  rank: number;
  order: number;
  lines: string[];
  w: number;
  h: number;
  /** Markaz: p — asosiy o'q (TB: y, LR: x), s — ikkilamchi. */
  p: number;
  s: number;
  preds: FNode[];
  succs: FNode[];
};

type FEdge = { from: FNode; to: FNode; label?: string; via: FNode[] };

const FLOW_GAP_S = 28; // ikkilamchi o'q bo'ylab tugunlar orasi
const FLOW_GAP_P_TB = 46; // qatlamlar orasi (TB) — yorliq + burilishga joy
const FLOW_GAP_P_LR = 64;

function shapeOf(kind: FigureNode["kind"]): NodeShape {
  switch (kind) {
    case "decision":
      return "diamond";
    case "start":
    case "end":
      return "rounded";
    case "data":
      return "parallelogram";
    default:
      return "rect";
  }
}

/** Tugunlar/qirralarni tozalaydi; sikl yoki chegara buzilsa `null`. */
export function flowGraph(spec: FlowSpec): { nodes: FigureNode[]; edges: { from: string; to: string; label?: string }[]; order: string[] } | null {
  if (!Array.isArray(spec.nodes) || !Array.isArray(spec.edges)) return null;
  const seen = new Map<string, FigureNode>();
  for (const n of spec.nodes) {
    if (!n || typeof n !== "object") continue;
    const id = String(n.id ?? "").trim();
    if (!id || seen.has(id)) continue;
    const label = String(n.label ?? "").replace(/\s+/g, " ").trim() || id;
    seen.set(id, { id, label, kind: n.kind });
  }
  const nodes = [...seen.values()];
  if (nodes.length === 0 || nodes.length > ARTICLE_LIMITS.figureNodes) return null;
  const edgeKeys = new Set<string>();
  const edges: { from: string; to: string; label?: string }[] = [];
  for (const e of spec.edges) {
    if (!e || typeof e !== "object") continue;
    const from = String(e.from ?? "").trim();
    const to = String(e.to ?? "").trim();
    if (!seen.has(from) || !seen.has(to)) continue; // noma'lum uch — tashlab ketiladi
    if (from === to) return null; // o'z-o'ziga sikl
    const key = `${from}->${to}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    const label = e.label ? String(e.label).replace(/\s+/g, " ").trim() : undefined;
    edges.push(label ? { from, to, label } : { from, to });
  }
  if (edges.length > ARTICLE_LIMITS.figureEdges) return null;
  // Kahn — topologik tartib; hammasi chiqmasa sikl bor.
  const indeg = new Map(nodes.map((n) => [n.id, 0]));
  for (const e of edges) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  const queue = nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const e of edges) {
      if (e.from !== id) continue;
      const d = (indeg.get(e.to) ?? 0) - 1;
      indeg.set(e.to, d);
      if (d === 0) queue.push(e.to);
    }
  }
  if (order.length !== nodes.length) return null; // sikl
  return { nodes, edges, order };
}

function layoutFlow(spec: FlowSpec): FigureLayout | null {
  const g = flowGraph(spec);
  if (!g) return null;
  const dir = spec.direction === "LR" ? "LR" : "TB";
  // Moslashuvchan o'rash: keng qatlam kanvasga sig'masa torroq o'rash bilan qayta.
  const attempts: Array<[number, number]> = dir === "TB" ? [[22, 2], [14, 3]] : [[18, 2], [12, 3]];
  let best: { layout: FigureLayout; scale: number } | null = null;
  for (const [maxChars, maxLines] of attempts) {
    const l = flowOnce(g, dir, maxChars, maxLines);
    const s = fitToCanvas(l);
    if (!best || s > best.scale + 0.02) best = { layout: l, scale: s };
    if (s >= 0.8) break;
  }
  return best!.layout;
}

function flowOnce(g: NonNullable<ReturnType<typeof flowGraph>>, dir: "TB" | "LR", maxChars: number, maxLines: number): FigureLayout {
  const byId = new Map<string, FNode>();
  const real: FNode[] = g.nodes.map((n) => {
    const shape = shapeOf(n.kind);
    const lines = wrapLabel(n.label, shape === "diamond" ? Math.min(maxChars, 16) : maxChars, maxLines);
    const size = nodeSize(lines, shape);
    const f: FNode = { id: n.id, label: n.label, shape, virtual: false, rank: 0, order: 0, lines, w: size.w, h: size.h, p: 0, s: 0, preds: [], succs: [] };
    byId.set(n.id, f);
    return f;
  });
  /* 1. rank — eng uzun yo'l (topologik tartibda). */
  for (const id of g.order) {
    const v = byId.get(id)!;
    for (const e of g.edges) if (e.to === id) v.rank = Math.max(v.rank, byId.get(e.from)!.rank + 1);
  }
  /* Uzun qirralar → virtual tugunlar (har oraliq qatlamda bittadan). */
  const all: FNode[] = [...real];
  const edges: FEdge[] = [];
  let vi = 0;
  for (const e of g.edges) {
    const a = byId.get(e.from)!;
    const b = byId.get(e.to)!;
    const via: FNode[] = [];
    let prev = a;
    for (let r = a.rank + 1; r < b.rank; r++) {
      const v: FNode = { id: `__v${vi++}`, label: "", shape: "rect", virtual: true, rank: r, order: 0, lines: [], w: 8, h: 8, p: 0, s: 0, preds: [prev], succs: [] };
      prev.succs.push(v);
      all.push(v);
      via.push(v);
      prev = v;
    }
    prev.succs.push(b);
    b.preds.push(prev);
    edges.push({ from: a, to: b, label: e.label, via });
  }
  const maxRank = Math.max(...all.map((n) => n.rank));
  const layers: FNode[][] = Array.from({ length: maxRank + 1 }, () => []);
  for (const n of all) layers[n.rank].push(n);
  // Boshlang'ich tartib — kirish tartibi (deterministik).
  layers.forEach((L) => L.forEach((n, i) => (n.order = i)));

  /* 2. order — barisentr, pastga/yuqoriga 2 marta. */
  const bary = (n: FNode, nbrs: FNode[]): number => (nbrs.length ? nbrs.reduce((s, m) => s + m.order, 0) / nbrs.length : n.order);
  const sortLayer = (L: FNode[], key: (n: FNode) => number) => {
    const keyed = L.map((n) => ({ n, k: key(n) }));
    keyed.sort((a, b) => a.k - b.k || a.n.order - b.n.order);
    keyed.forEach((x, i) => (x.n.order = i));
    L.splice(0, L.length, ...keyed.map((x) => x.n));
  };
  for (let sweep = 0; sweep < 2; sweep++) {
    for (let r = 1; r <= maxRank; r++) sortLayer(layers[r], (n) => bary(n, n.preds));
    for (let r = maxRank - 1; r >= 0; r--) sortLayer(layers[r], (n) => bary(n, n.succs));
  }

  /* 3. position — ikkilamchi o'q: ketma-ket + median tekislash; asosiy o'q: qatlam qalinligi. */
  const sizeS = (n: FNode) => (dir === "TB" ? n.w : n.h);
  const sizeP = (n: FNode) => (dir === "TB" ? n.h : n.w);
  const gapS = FLOW_GAP_S;
  const gapP = dir === "TB" ? FLOW_GAP_P_TB : FLOW_GAP_P_LR;
  for (const L of layers) {
    let s = 0;
    for (const n of L) {
      n.s = s + sizeS(n) / 2;
      s += sizeS(n) + gapS;
    }
    const total = s - gapS;
    for (const n of L) n.s -= total / 2; // qatlam markazi 0
  }
  const separate = (L: FNode[]) => {
    // Tartibni saqlab, minimal oraliqni ta'minlash (chapdan o'ngga surish, keyin o'rtaga qaytarish).
    for (let i = 1; i < L.length; i++) {
      const min = L[i - 1].s + sizeS(L[i - 1]) / 2 + gapS + sizeS(L[i]) / 2;
      if (L[i].s < min) L[i].s = min;
    }
    for (let i = L.length - 2; i >= 0; i--) {
      const max = L[i + 1].s - sizeS(L[i + 1]) / 2 - gapS - sizeS(L[i]) / 2;
      if (L[i].s > max) L[i].s = max;
    }
  };
  const align = (L: FNode[], nbrs: (n: FNode) => FNode[]) => {
    const want: number[] = [];
    for (const n of L) {
      const m = nbrs(n);
      if (m.length) n.s = m.reduce((a, x) => a + x.s, 0) / m.length;
      want.push(n.s);
    }
    separate(L);
    // `separate` faqat bir tomonga suradi — qatlam istalgan markazdan og'masin (yon siljish yo'q).
    const drift = L.reduce((a, n, i) => a + (n.s - want[i]), 0) / L.length;
    for (const n of L) n.s -= drift;
  };
  for (let it = 0; it < 3; it++) {
    for (let r = 1; r <= maxRank; r++) align(layers[r], (n) => n.preds);
    for (let r = maxRank - 1; r >= 0; r--) align(layers[r], (n) => n.succs);
  }
  /*
   * Uzun qirra zinapoya bo'lmasin: virtual zanjir bitta koridorga tekislanadi —
   * har qatlamda qo'shnilar qoldirgan [lo, hi] oraliqlarining kesishmasi
   * ichida o'rtachaga eng yaqin nuqta; kesishma bo'sh bo'lsa o'rtacha + separate.
   */
  for (let it = 0; it < 3; it++) {
    for (const e of edges) {
      if (e.via.length < 2) continue;
      let lo = -Infinity;
      let hi = Infinity;
      let sum = 0;
      for (const v of e.via) {
        const L = layers[v.rank];
        const i = L.indexOf(v);
        const left = L[i - 1];
        const right = L[i + 1];
        if (left) lo = Math.max(lo, left.s + sizeS(left) / 2 + gapS + sizeS(v) / 2);
        if (right) hi = Math.min(hi, right.s - sizeS(right) / 2 - gapS - sizeS(v) / 2);
        sum += v.s;
      }
      const mean = sum / e.via.length;
      const s = lo <= hi ? Math.min(Math.max(mean, lo), hi) : mean;
      for (const v of e.via) v.s = s;
    }
    for (const L of layers) separate(L);
  }
  // Asosiy o'q: qatlam qalinligi = eng katta tugun; tugun markazlanadi.
  const layerP: { start: number; end: number }[] = [];
  let p = 0;
  for (const L of layers) {
    const thick = Math.max(...L.map(sizeP));
    layerP.push({ start: p, end: p + thick });
    for (const n of L) n.p = p + thick / 2;
    p += thick + gapP;
  }
  const toXY = (pp: number, ss: number): Pt => (dir === "TB" ? { x: ss, y: pp } : { x: pp, y: ss });

  /* 4. route — ortogonal: chiqish (asosiy o'q bo'ylab) → shina → kirish. */
  const out = emptyLayout("flow");
  for (const n of real) {
    const c = toXY(n.p, n.s);
    out.nodes.push({ id: n.id, x: c.x - n.w / 2, y: c.y - n.h / 2, w: n.w, h: n.h, lines: n.lines, shape: n.shape });
  }
  const axis = dir === "TB" ? "y" : "x";
  for (const e of edges) {
    const chain = [e.from, ...e.via, e.to];
    let pts: Pt[] = [];
    for (let i = 0; i < chain.length - 1; i++) {
      const a = chain[i];
      const b = chain[i + 1];
      const start = toXY(a.virtual ? a.p : a.p + sizeP(a) / 2, a.s);
      const end = toXY(b.virtual ? b.p : b.p - sizeP(b) / 2, b.s);
      const mid = (layerP[a.rank].end + layerP[b.rank].start) / 2;
      pts = pts.concat(orthoPath(start, end, mid, axis));
    }
    pts = dedupePoints(pts);
    const edge: LayoutEdge = { from: e.from.id, to: e.to.id, points: pts, arrow: true };
    if (e.label) {
      edge.label = e.label;
      edge.labelAt = edgeLabelAt(pts, axis, e.label);
    }
    out.edges.push(edge);
  }
  return out;
}

/**
 * Qirra yorlig'i joyi: birinchi ko'ndalang (shina) segment o'rtasi, chiziq
 * ustida; ko'ndalang segment bo'lmasa — bo'ylama segment o'rtasi, o'ng/pastda.
 */
function edgeLabelAt(pts: Pt[], axis: "y" | "x", label: string): Pt {
  const half = textWidth(label, FONT_PX * 0.9) / 2;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const across = axis === "y" ? Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) > 1 : Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) > 1;
    if (!across) continue;
    const len = axis === "y" ? Math.abs(a.x - b.x) : Math.abs(a.y - b.y);
    // Shina segmenti yorliqqa yetarli bo'lsa — uning o'rtasida, chiziq ustida (TB) / o'ngida (LR).
    if (axis === "y" ? len >= 2 * half + 16 : len >= FONT_PX * 2) {
      return axis === "y" ? { x: (a.x + b.x) / 2, y: a.y - FONT_PX * 0.6 } : { x: a.x + half + 8, y: (a.y + b.y) / 2 };
    }
    // Qisqa shina: keyingi bo'ylama (koridor) segment o'rtasida, chiziq yonida.
    const c = pts[i + 2];
    if (c) return axis === "y" ? { x: b.x + half + 6, y: (b.y + c.y) / 2 } : { x: (b.x + c.x) / 2, y: b.y - FONT_PX * 0.6 };
    return axis === "y" ? { x: (a.x + b.x) / 2, y: a.y - FONT_PX * 0.6 } : { x: a.x + half + 8, y: (a.y + b.y) / 2 };
  }
  const a = pts[0];
  const b = pts[pts.length - 1];
  return axis === "y" ? { x: (a.x + b.x) / 2 + half + 8, y: (a.y + b.y) / 2 } : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - FONT_PX * 0.6 };
}

/* ══════════════════════════ PROCESS ══════════════════════════ */

type ProcessSpec = Extract<FigureSpec, { kind: "process" }>;

export function processSteps(spec: ProcessSpec): string[] | null {
  if (!Array.isArray(spec.steps)) return null;
  const steps = spec.steps.map((s) => String(s ?? "").replace(/\s+/g, " ").trim()).filter(Boolean);
  if (steps.length === 0 || steps.length > ARTICLE_LIMITS.figureNodes) return null;
  return steps;
}

function layoutProcess(spec: ProcessSpec): FigureLayout | null {
  const steps = processSteps(spec);
  if (!steps) return null;
  const out = emptyLayout("process");
  const n = steps.length;
  const BADGE = 12; // doira radiusi
  if (n <= 5) {
    /* Gorizontal: kenglik teng bo'linadi, balandlik eng uzun matnga. */
    const gap = 30;
    const inner = CANVAS_W - 2 * MARGIN;
    const bw = (inner - gap * (n - 1)) / n;
    const maxChars = Math.max(8, Math.floor((bw - 2 * PAD_X) / (0.55 * FONT_PX)));
    const wrapped = steps.map((s) => wrapLabel(s, maxChars, 3));
    const bh = Math.max(...wrapped.map((l) => l.length)) * FONT_PX * LINE_K + 2 * PAD_Y + BADGE;
    const y = BADGE;
    wrapped.forEach((lines, i) => {
      const x = i * (bw + gap);
      out.nodes.push({ id: `s${i + 1}`, x, y, w: bw, h: bh, lines, shape: "rounded", rx: 10, badge: String(i + 1), dy: BADGE / 2 });
      if (i > 0) {
        const px = x - gap;
        out.edges.push({ from: `s${i}`, to: `s${i + 1}`, points: [{ x: px, y: y + bh / 2 }, { x, y: y + bh / 2 }], arrow: true });
      }
    });
  } else {
    /* Vertikal: bitta ustun, markazda. */
    const bw = 320;
    const gap = 34;
    const maxChars = Math.floor((bw - 2 * PAD_X) / (0.55 * FONT_PX));
    let y = BADGE;
    steps.forEach((s, i) => {
      const lines = wrapLabel(s, maxChars, 3);
      const bh = lines.length * FONT_PX * LINE_K + 2 * PAD_Y + BADGE;
      out.nodes.push({ id: `s${i + 1}`, x: 0, y, w: bw, h: bh, lines, shape: "rounded", rx: 10, badge: String(i + 1), dy: BADGE / 2 });
      if (i > 0) out.edges.push({ from: `s${i}`, to: `s${i + 1}`, points: [{ x: bw / 2, y: y - gap }, { x: bw / 2, y: y - BADGE }], arrow: true });
      y += bh + gap;
    });
  }
  fitToCanvas(out);
  return out;
}

/* ══════════════════════════ TREE ══════════════════════════ */

type TreeSpec = Extract<FigureSpec, { kind: "tree" }>;
export const TREE_MAX_DEPTH = 4;

type TNode = { label: string; depth: number; children: TNode[]; lines: string[]; w: number; h: number; x: number; y: number; subW: number; hanging: boolean };

/** Daraxtni tekshiradi: chuqurlik ≤4 daraja, tugun ≤14; bo'sh yorliqlar tashlanadi. */
export function treeNodes(spec: TreeSpec): { root: string; children: TreeNode[]; count: number } | null {
  const root = String(spec.root ?? "").replace(/\s+/g, " ").trim();
  if (!root) return null;
  let count = 1;
  let ok = true;
  const walk = (list: TreeNode[] | undefined, depth: number): TreeNode[] => {
    if (!Array.isArray(list)) return [];
    const out: TreeNode[] = [];
    for (const c of list) {
      if (!c || typeof c !== "object") continue;
      const label = String(c.label ?? "").replace(/\s+/g, " ").trim();
      if (!label) continue;
      if (depth >= TREE_MAX_DEPTH) {
        ok = false;
        return out;
      }
      count++;
      out.push({ label, children: walk(c.children, depth + 1) });
    }
    return out;
  };
  const children = walk(spec.children, 1);
  if (!ok || count > ARTICLE_LIMITS.figureNodes) return null;
  return { root, children, count };
}

function layoutTree(spec: TreeSpec): FigureLayout | null {
  const t = treeNodes(spec);
  if (!t) return null;
  const attempts: Array<{ maxChars: number; maxLines: number; hang: boolean }> = [
    { maxChars: 18, maxLines: 2, hang: false },
    { maxChars: 12, maxLines: 3, hang: false },
    { maxChars: 16, maxLines: 2, hang: true },
  ];
  let best: { layout: FigureLayout; scale: number } | null = null;
  for (const a of attempts) {
    const l = treeOnce(t, a.maxChars, a.maxLines, a.hang);
    const s = fitToCanvas(l);
    if (!best || s > best.scale + 0.02) best = { layout: l, scale: s };
    if (s >= 0.8) break;
  }
  return best!.layout;
}

function treeOnce(t: NonNullable<ReturnType<typeof treeNodes>>, maxChars: number, maxLines: number, hang: boolean): FigureLayout {
  const GAP_X = 18;
  const GAP_Y = 40;
  const HANG_X = 22; // osilgan barglar shinasi chap chekkadan
  const HANG_GAP = 8;
  const build = (label: string, kids: TreeNode[], depth: number): TNode => {
    const lines = wrapLabel(label, maxChars, maxLines);
    const size = nodeSize(lines, "rect");
    const node: TNode = { label, depth, children: kids.map((k) => build(k.label, k.children ?? [], depth + 1)), lines, w: size.w, h: size.h, x: 0, y: 0, subW: 0, hanging: false };
    // Osilgan rejim: barcha bolalari barg va ≥3 ta bo'lsa — vertikal ro'yxat.
    node.hanging = hang && node.children.length >= 3 && node.children.every((c) => c.children.length === 0);
    if (node.hanging) {
      // Osilgan barglar bir xil kenglikda — ro'yxat tekis ko'rinsin.
      const w = Math.max(...node.children.map((c) => c.w));
      for (const c of node.children) c.w = w;
    }
    return node;
  };
  const root = build(t.root, t.children, 0);
  const measure = (n: TNode): number => {
    if (n.children.length === 0) return (n.subW = n.w);
    if (n.hanging) return (n.subW = Math.max(n.w, HANG_X + Math.max(...n.children.map((c) => c.w))));
    const kids = n.children.reduce((s, c) => s + measure(c), 0) + GAP_X * (n.children.length - 1);
    return (n.subW = Math.max(n.w, kids));
  };
  measure(root);
  // Daraja balandliklari (osilgan barglar o'z ota darajasidan pastga cho'ziladi).
  const levelH: number[] = [];
  const collect = (n: TNode) => {
    levelH[n.depth] = Math.max(levelH[n.depth] ?? 0, n.h);
    if (!n.hanging) n.children.forEach(collect);
  };
  collect(root);
  // Bir darajadagi tugunlar BIR XIL balandlikda (tasnif daraxti tekis ko'rinsin).
  const unify = (n: TNode) => {
    n.h = levelH[n.depth];
    if (!n.hanging) n.children.forEach(unify);
  };
  unify(root);
  const levelY: number[] = [];
  let y = 0;
  levelH.forEach((h, i) => {
    levelY[i] = y;
    y += h + GAP_Y;
  });
  const out = emptyLayout("tree");
  let id = 0;
  const place = (n: TNode, x0: number): string => {
    const nid = `t${id++}`;
    n.y = levelY[n.depth] + (levelH[n.depth] - n.h) / 2;
    if (n.children.length === 0) {
      n.x = x0 + (n.subW - n.w) / 2;
    } else if (n.hanging) {
      n.x = x0;
      const busX = n.x + HANG_X / 2;
      let cy = n.y + n.h + GAP_Y / 2;
      for (const c of n.children) {
        c.x = n.x + HANG_X;
        c.y = cy;
        const cid = `t${id++}`;
        out.nodes.push({ id: cid, x: c.x, y: c.y, w: c.w, h: c.h, lines: c.lines, shape: "rect" });
        out.edges.push({ from: nid, to: cid, points: [{ x: busX, y: n.y + n.h }, { x: busX, y: c.y + c.h / 2 }, { x: c.x, y: c.y + c.h / 2 }], arrow: false });
        cy += c.h + HANG_GAP;
      }
    } else {
      const kidsW = n.children.reduce((s, c) => s + c.subW, 0) + GAP_X * (n.children.length - 1);
      let cx = x0 + (n.subW - kidsW) / 2;
      const ids: string[] = [];
      for (const c of n.children) {
        ids.push(place(c, cx));
        cx += c.subW + GAP_X;
      }
      const first = n.children[0];
      const last = n.children[n.children.length - 1];
      n.x = (first.x + first.w / 2 + last.x + last.w / 2) / 2 - n.w / 2;
      const midY = n.y + n.h + GAP_Y / 2;
      n.children.forEach((c, i) => {
        out.edges.push({ from: nid, to: ids[i], points: dedupePoints(orthoPath({ x: n.x + n.w / 2, y: n.y + n.h }, { x: c.x + c.w / 2, y: c.y }, midY, "y")), arrow: false });
      });
    }
    out.nodes.push({ id: nid, x: n.x, y: n.y, w: n.w, h: n.h, lines: n.lines, shape: "rect", bold: n.depth === 0 });
    return nid;
  };
  place(root, 0);
  // Osilgan rejimda barglar o'z ota-onasidan keyin qo'shildi — qirra `from` ota id'si (nid) shu yerda mavjud.
  return out;
}

/* ══════════════════════════ yordamchi ══════════════════════════ */

/** Tugun matnining eng keng qatori (px) — testlar va zich joylashuv tekshiruvi uchun. */
export function nodeTextWidth(n: LayoutNode, fontPx = FONT_PX): number {
  return Math.max(...n.lines.map((l) => textWidth(l, n.size ?? fontPx)), 0);
}
