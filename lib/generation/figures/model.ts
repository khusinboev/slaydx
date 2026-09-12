/**
 * Maqola 2 (AUDIT-17) WP3 — sxema maketi MODELI: umumiy tiplar, matn
 * o'lchovi (DOM YO'Q) va tugun o'lchamlari.
 *
 * Nega alohida fayl: `layout.ts` (flow/process/tree + dispatch) `prisma.ts`
 * va `chart.ts` ni chaqiradi; ular esa matn o'lchovi va tiplarga muhtoj.
 * Umumiy qatlam shu yerda turadi — sikl import yo'q.
 *
 * Birlik: px @ 96 dpi (1 mm = 3.78 px). Kanvas kengligi QAT'IY 160 mm
 * (605 px): DOCX renderer rasmni doim foydali kenglikda chizadi, shuning
 * uchun tor sxema kengaytirilib shishib ketmasin — kontent markazda,
 * chetlari oq. Balandlik kontentga qarab. Shrift 11 pt = 14.67 px —
 * maqola tanasi (TNR 12–14) bilan uyg'un.
 */

import type { FigureKind } from "../article/types";

/* ────────────────────────── konstantalar ────────────────────────── */

export const FIGURE_WIDTH_MM = 160;
export const PX_PER_MM = 96 / 25.4;
/** Kanvas kengligi px (160 mm @ 96 dpi). */
export const CANVAS_W = Math.round(FIGURE_WIDTH_MM * PX_PER_MM); // 605
/** Asosiy shrift px (11 pt). */
export const FONT_PX = (11 * 96) / 72; // 14.67
/** Qator balandligi (shriftga nisbatan). */
export const LINE_K = 1.25;
/** Kanvas cheti. */
export const MARGIN = 10;
/** Tugun ichki bo'shlig'i. */
export const PAD_X = 12;
export const PAD_Y = 8;
/** Shrift ro'yxati: Alpine'da TNR yo'q → Liberation Serif (metrik mos) → Noto Serif. */
export const FONT_FAMILY = "Times New Roman, Liberation Serif, Noto Serif, serif";

/* ────────────────────────── tiplar ────────────────────────── */

export type Pt = { x: number; y: number };

/** `none` — shaklsiz matn bloki (timeline yorlig'i, matritsa bandi): faqat o'ralgan qatorlar chiziladi. */
export type NodeShape = "rect" | "rounded" | "diamond" | "parallelogram" | "ellipse" | "none";

export type LayoutNode = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** O'ralgan matn qatorlari. */
  lines: string[];
  shape: NodeShape;
  /** Shrift px (standart `FigureLayout.fontSize`). */
  size?: number;
  bold?: boolean;
  fill?: string;
  /** `rounded` burchak radiusi (standart h/2 — stadion; process bloklari 10). */
  rx?: number;
  /** Process: yuqori chetdagi raqam doirasi. */
  badge?: string;
  /** Matnni pastga surish (badge uchun joy). */
  dy?: number;
  /** Matn tekislash (`none` shaklda; standart markaz). `start` — matn `x + PAD_X` dan boshlanadi. */
  align?: "start" | "middle";
  /** `align: "start"` da davom qatorlari chekinishi (px, masshtabgacha) — «•» ostiga tushmasin. */
  indent?: number;
};

export type LayoutEdge = {
  from: string;
  to: string;
  /** Polilinya nuqtalari (tugun chegarasidan chegarasigacha). */
  points: Pt[];
  label?: string;
  /** Yorliq markazi. */
  labelAt?: Pt;
  arrow: boolean;
  /** Ikki tomonlama o'q — boshida ham uch (layers). */
  arrowStart?: boolean;
};

export type LayoutText = {
  x: number;
  y: number;
  text: string;
  size?: number;
  anchor?: "start" | "middle" | "end";
  bold?: boolean;
  italic?: boolean;
  /** Gradus (soat sohasi bo'yicha), markaz atrofida. */
  rotate?: number;
  fill?: string;
  /** Orqasida oq to'rtburchak (naqsh/chiziq ustida o'qilsin). */
  halo?: boolean;
};

/** Grafik primitivlari (chart, PRISMA bandlari). */
export type Prim =
  | { k: "rect"; x: number; y: number; w: number; h: number; fill?: string; pattern?: string; stroke?: string; rx?: number }
  | { k: "line"; x1: number; y1: number; x2: number; y2: number; stroke?: string; width?: number; dash?: string; arrow?: boolean }
  | { k: "polyline"; points: Pt[]; stroke?: string; width?: number; dash?: string }
  | { k: "path"; d: string; fill?: string; pattern?: string; stroke?: string }
  | { k: "marker"; x: number; y: number; shape: "circle" | "square" | "triangle" | "diamond"; fill?: string; r?: number }
  /**
   * Yoy o'q (cycle): ellips (`cx`,`cy`,`rx`,`ry`) bo'ylab `a0` → `a1` gradus
   * (soat yo'nalishi — ekran koordinatasida burchak o'sishi). `sweep` —
   * SVG `A` bayrog'i: 1 — burchak o'sadi (soat yo'nalishi), 0 — kamayadi.
   * Yoy 180° dan kichik (qo'shni bosqichlar orasi). `arrow` — oxirida uch.
   */
  | { k: "arc"; cx: number; cy: number; rx: number; ry: number; a0: number; a1: number; sweep: 0 | 1; arrow?: boolean }
  /** To'la aylana belgisi (timeline tuguni): qora chegara, `fill` (standart oq). */
  | { k: "dot"; x: number; y: number; r: number; fill?: string };

/** Oq-qora chop uchun shtrix naqshlari — `svg.ts` `<pattern>` chiqaradi. */
export type PatternKind = "solid" | "diag" | "dots" | "cross" | "horiz" | "vert";
export type PatternDef = { id: string; base: string; kind: PatternKind };

export type FigureLayout = {
  kind: FigureKind;
  w: number;
  h: number;
  /** Asosiy shrift px (masshtabdan keyin). */
  fontSize: number;
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  texts: LayoutText[];
  prims: Prim[];
  patterns: PatternDef[];
  mm: { w: number; h: number };
};

/* ────────────────────────── matn o'lchovi ────────────────────────── */

/*
 * Belgi kengligi jadvali (em): serif shrift o'rtachasi — DOM/canvas yo'q,
 * shuning uchun taxminiy, lekin ATAYIN biroz keng (matn tugundan chiqib
 * ketmasin). Lotin/kirill kichik 0.55, katta 0.70, bo'shliq 0.30, tor
 * belgilar 0.33, keng (m/w/Ш/Щ…) 0.85/0.95, raqam 0.50.
 */
const NARROW = new Set("iljtfrI.,:;'’‘!|()[]-·".split(""));
const WIDE_LOWER = new Set("mwшщжмыюфдц".split(""));
const WIDE_UPPER = new Set("MWШЩЖМЫЮФДЦ".split(""));

export function charWidth(ch: string): number {
  if (ch === " " || ch === " ") return 0.3;
  if (NARROW.has(ch)) return 0.33;
  if (WIDE_UPPER.has(ch)) return 0.95;
  if (WIDE_LOWER.has(ch)) return 0.85;
  if (/\d/.test(ch)) return 0.5;
  if (ch !== ch.toLowerCase()) return 0.7; // katta harf (lotin/kirill)
  if (/[←-⇿─-➿]/.test(ch)) return 0.9; // o'q/belgi
  return 0.55;
}

/** Matn kengligi px. */
export function textWidth(s: string, fontPx = FONT_PX): number {
  let w = 0;
  for (const ch of s) w += charWidth(ch);
  return w * fontPx;
}

/**
 * So'zlarga bo'lib o'rash: ≤`maxChars` belgi/qator, ≤`maxLines` qator.
 * Sig'masa avval kengroq qator (`maxChars`×1.35) sinaladi, keyin oxirgi
 * qator «…» bilan kesiladi (ma'lumot yo'qolishi — hisobotda ochiq band).
 * Uzun bitta so'z qattiq bo'linadi («-» bilan).
 */
export function wrapLabel(label: string, maxChars = 22, maxLines = 2): string[] {
  // NBSP (U+00A0) saqlanadi — «(n = 175)» kabi bo'linmas guruhlar uchun.
  const text = String(label ?? "").replace(/[ \t\r\n]+/g, " ").trim();
  if (!text) return [""];
  const attempt = (limit: number): string[] => {
    const words = text.split(" ");
    const lines: string[] = [];
    let cur = "";
    // Bitta so'z chegaradan biroz uzun bo'lsa BUTUN qoladi (qator sal kengayadi);
    // faqat juda uzun so'z (URL kabi) qattiq bo'linadi.
    const hard = Math.max(limit + 6, 20);
    for (let word of words) {
      while (word.length > hard) {
        if (cur) {
          lines.push(cur);
          cur = "";
        }
        lines.push(word.slice(0, hard - 1) + "-");
        word = word.slice(hard - 1);
      }
      if (!cur) cur = word;
      else if ((cur + " " + word).length <= limit) cur += " " + word;
      else {
        lines.push(cur);
        cur = word;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  };
  let lines = attempt(maxChars);
  if (lines.length > maxLines) lines = attempt(Math.ceil(maxChars * 1.35));
  if (lines.length > maxLines) {
    const limit = Math.ceil(maxChars * 1.35);
    lines = lines.slice(0, maxLines);
    const last = lines[maxLines - 1];
    lines[maxLines - 1] = (last.length + 1 > limit ? last.slice(0, limit - 1).trimEnd() : last) + "…";
  }
  return lines;
}

/**
 * KENGLIK bo'yicha o'rash (AUDIT-18 WP-B): `wrapLabel` belgi soni bilan
 * ishlaydi (o'rtacha 0.55 em — tor harfli so'zlarda 20–30 % erta o'raydi);
 * katakli maketlarda (matritsa, taqqoslash, qatlam bandlari) o'lchangan
 * kenglik (`textWidth`) aniqroq. Qoidalar `wrapLabel` bilan bir xil:
 * ≤`maxLines` qator, sig'masa oxirgi qator «…» bilan; uzun so'z «-» bilan.
 */
export function wrapToWidth(label: string, maxPx: number, fontPx = FONT_PX, maxLines = 2): string[] {
  const text = String(label ?? "").replace(/[ \t\r\n]+/g, " ").trim();
  if (!text) return [""];
  const fits = (s: string) => textWidth(s, fontPx) <= maxPx;
  const lines: string[] = [];
  let cur = "";
  for (let word of text.split(" ")) {
    // Bitta so'z qatorga sig'masa — «-» bilan qattiq bo'linadi.
    while (!fits(word) && word.length > 2) {
      let k = word.length - 1;
      while (k > 1 && !fits(word.slice(0, k) + "-")) k--;
      if (cur) {
        lines.push(cur);
        cur = "";
      }
      lines.push(word.slice(0, k) + "-");
      word = word.slice(k);
    }
    if (!cur) cur = word;
    else if (fits(`${cur} ${word}`)) cur += ` ${word}`;
    else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines;
  const out = lines.slice(0, maxLines);
  let last = out[maxLines - 1];
  while (last.length > 1 && !fits(`${last}…`)) last = last.slice(0, -1).trimEnd();
  out[maxLines - 1] = `${last}…`;
  return out;
}

/** Berilgan kenglikka sig'adigan taxminiy belgi soni (o'rtacha belgi 0.55 em). */
export function charsFor(widthPx: number, fontPx = FONT_PX, min = 6): number {
  return Math.max(min, Math.floor(widthPx / (0.55 * fontPx)));
}

/** Matnni tozalaydi: bo'shliqlar bitta, chetlari kesilgan, `max` belgigacha. */
export function cleanLabel(v: unknown, max = 120): string {
  return String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/* ────────────────────────── tugun o'lchami ────────────────────────── */

export function linesBox(lines: string[], fontPx = FONT_PX): { tw: number; th: number } {
  const tw = Math.max(...lines.map((l) => textWidth(l, fontPx)), 0);
  const th = lines.length * fontPx * LINE_K;
  return { tw, th };
}

/**
 * Shaklga qarab tugun o'lchami — matn ichiga sig'ishi kafolatlanadi:
 * romb uchun ichki to'rtburchak sharti tw/W + th/H ≤ 1; stadion (start/end)
 * to'g'ri qismi = matn kengligi; parallelogramm — qiyalik ikki tomonda.
 */
export function nodeSize(lines: string[], shape: NodeShape, fontPx = FONT_PX): { w: number; h: number } {
  const { tw, th } = linesBox(lines, fontPx);
  switch (shape) {
    case "diamond":
      return { w: Math.max(72, tw * 1.7 + 2 * PAD_X), h: Math.max(44, th * 2.4 + 2 * PAD_Y) };
    case "rounded": {
      const h = Math.max(32, th + 2 * PAD_Y);
      return { w: Math.max(72, tw + h), h };
    }
    case "parallelogram": {
      const h = Math.max(32, th + 2 * PAD_Y);
      return { w: Math.max(80, tw + 2 * PAD_X + 2 * skewOf(h)), h };
    }
    case "ellipse":
      return { w: Math.max(80, tw * 1.35 + 2 * PAD_X), h: Math.max(40, th * 1.5 + 2 * PAD_Y) };
    default:
      return { w: Math.max(64, tw + 2 * PAD_X), h: Math.max(32, th + 2 * PAD_Y) };
  }
}

/** Parallelogramm qiyaligi (px) — balandlikka nisbatan. */
export function skewOf(h: number): number {
  return Math.round(h * 0.35);
}

/* ────────────────────────── kanvasga moslash ────────────────────────── */

export type Box = { x0: number; y0: number; x1: number; y1: number };

function grow(b: Box, x: number, y: number): void {
  if (x < b.x0) b.x0 = x;
  if (y < b.y0) b.y0 = y;
  if (x > b.x1) b.x1 = x;
  if (y > b.y1) b.y1 = y;
}

/** Barcha elementlar chegarasi. */
export function bounds(l: Pick<FigureLayout, "nodes" | "edges" | "texts" | "prims">, fontPx = FONT_PX): Box {
  const b: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const n of l.nodes) {
    grow(b, n.x, n.y - (n.badge ? 12 : 0));
    grow(b, n.x + n.w, n.y + n.h);
  }
  for (const e of l.edges) {
    for (const p of e.points) grow(b, p.x, p.y);
    if (e.label && e.labelAt) {
      const w = textWidth(e.label, fontPx * 0.9) + 6;
      grow(b, e.labelAt.x - w / 2, e.labelAt.y - fontPx * 0.7);
      grow(b, e.labelAt.x + w / 2, e.labelAt.y + fontPx * 0.7);
    }
  }
  for (const t of l.texts) {
    const size = t.size ?? fontPx;
    const w = textWidth(t.text, size);
    if (t.rotate) {
      // −90°: `start` matn yuqoriga o'sadi, `end` yuqorida tugaydi (pastga o'sadi); +90° — teskari.
      const first = t.anchor === "start" ? w : t.anchor === "end" ? 0 : w / 2;
      const up = t.rotate < 0 ? first : w - first;
      grow(b, t.x - size * 0.7, t.y - up);
      grow(b, t.x + size * 0.7, t.y + (w - up));
      continue;
    }
    // Anchor: middle — ikki tomonga yarmi; start — o'ngga; end — chapga.
    const left = t.anchor === "start" ? 0 : t.anchor === "end" ? w : w / 2;
    grow(b, t.x - left, t.y - size * 0.7);
    grow(b, t.x - left + w, t.y + size * 0.7);
  }
  for (const p of l.prims) {
    if (p.k === "rect") {
      grow(b, p.x, p.y);
      grow(b, p.x + p.w, p.y + p.h);
    } else if (p.k === "line") {
      grow(b, p.x1, p.y1);
      grow(b, p.x2, p.y2);
    } else if (p.k === "polyline") {
      for (const q of p.points) grow(b, q.x, q.y);
    } else if (p.k === "marker") {
      grow(b, p.x - 5, p.y - 5);
      grow(b, p.x + 5, p.y + 5);
    } else if (p.k === "dot") {
      grow(b, p.x - p.r - 1, p.y - p.r - 1);
      grow(b, p.x + p.r + 1, p.y + p.r + 1);
    } else if (p.k === "arc") {
      for (const q of arcPoints(p, 12)) grow(b, q.x, q.y);
    }
    // `path` (pie) — chaqiruvchi o'zi kanvasni belgilaydi
  }
  if (!Number.isFinite(b.x0)) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  return b;
}

/** Ellips nuqtasi (gradus, ekran koordinatasi: 0° — o'ng, 90° — past). */
export function ellipsePt(cx: number, cy: number, rx: number, ry: number, deg: number): Pt {
  const t = (deg * Math.PI) / 180;
  return { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) };
}

/** Yoy bo'ylab `n` nuqta (chegara hisobi/testlar uchun). */
export function arcPoints(a: { cx: number; cy: number; rx: number; ry: number; a0: number; a1: number; sweep: 0 | 1 }, n = 8): Pt[] {
  const out: Pt[] = [];
  const d = arcSpan(a);
  for (let i = 0; i <= n; i++) out.push(ellipsePt(a.cx, a.cy, a.rx, a.ry, a.a0 + (d * i) / n));
  return out;
}

/** Yoy burchak farqi (belgili): sweep 1 → musbat, 0 → manfiy; |span| < 360. */
export function arcSpan(a: { a0: number; a1: number; sweep: 0 | 1 }): number {
  let d = ((a.a1 - a.a0) % 360) + 360;
  d %= 360;
  if (a.sweep === 1) return d;
  return d - 360; // manfiy
}

/**
 * Kontentni 160 mm kanvasga joylaydi: kengroq bo'lsa BUTUN maket (koordinata
 * + shrift) bir xil masshtabda kichraytiriladi, torroq bo'lsa markazlanadi.
 * Balandlik kontentdan. Qaytaradi masshtab (1 = kichraytirilmagan).
 */
export function fitToCanvas(l: FigureLayout, opts: { minScale?: number } = {}): number {
  const b = bounds(l, l.fontSize);
  const cw = b.x1 - b.x0;
  const ch = b.y1 - b.y0;
  const inner = CANVAS_W - 2 * MARGIN;
  let s = cw > inner ? inner / cw : 1;
  if (opts.minScale && s < opts.minScale) s = opts.minScale;
  const offX = MARGIN + (inner - cw * s) / 2 - b.x0 * s;
  const offY = MARGIN - b.y0 * s;
  const X = (x: number) => x * s + offX;
  const Y = (y: number) => y * s + offY;
  for (const n of l.nodes) {
    n.x = X(n.x);
    n.y = Y(n.y);
    n.w *= s;
    n.h *= s;
    n.size = (n.size ?? l.fontSize) * s;
    if (n.dy) n.dy *= s;
    if (n.rx) n.rx *= s;
    if (n.indent) n.indent *= s;
  }
  for (const e of l.edges) {
    e.points = e.points.map((p) => ({ x: X(p.x), y: Y(p.y) }));
    if (e.labelAt) e.labelAt = { x: X(e.labelAt.x), y: Y(e.labelAt.y) };
  }
  for (const t of l.texts) {
    t.x = X(t.x);
    t.y = Y(t.y);
    t.size = (t.size ?? l.fontSize) * s;
  }
  for (const p of l.prims) {
    if (p.k === "rect") {
      p.x = X(p.x);
      p.y = Y(p.y);
      p.w *= s;
      p.h *= s;
    } else if (p.k === "line") {
      p.x1 = X(p.x1);
      p.y1 = Y(p.y1);
      p.x2 = X(p.x2);
      p.y2 = Y(p.y2);
    } else if (p.k === "polyline") {
      p.points = p.points.map((q) => ({ x: X(q.x), y: Y(q.y) }));
    } else if (p.k === "marker" || p.k === "dot") {
      p.x = X(p.x);
      p.y = Y(p.y);
      if (p.k === "dot") p.r *= s;
    } else if (p.k === "arc") {
      p.cx = X(p.cx);
      p.cy = Y(p.cy);
      p.rx *= s;
      p.ry *= s;
    }
  }
  l.fontSize *= s;
  l.w = Math.max(cw * s + 2 * MARGIN, CANVAS_W);
  l.h = Math.round(ch * s + 2 * MARGIN);
  l.mm = { w: l.w === CANVAS_W ? FIGURE_WIDTH_MM : round1(l.w / PX_PER_MM), h: round1(l.h / PX_PER_MM) };
  return s;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function emptyLayout(kind: FigureLayout["kind"]): FigureLayout {
  return { kind, w: CANVAS_W, h: 0, fontSize: FONT_PX, nodes: [], edges: [], texts: [], prims: [], patterns: [], mm: { w: FIGURE_WIDTH_MM, h: 0 } };
}

/** Ortogonal (Manhattan) yo'l: p → q, oraliq `mid` chizig'ida burilib. */
export function orthoPath(p: Pt, q: Pt, mid: number, axis: "y" | "x"): Pt[] {
  if (axis === "y") {
    if (Math.abs(p.x - q.x) < 0.5) return [p, q];
    return [p, { x: p.x, y: mid }, { x: q.x, y: mid }, q];
  }
  if (Math.abs(p.y - q.y) < 0.5) return [p, q];
  return [p, { x: mid, y: p.y }, { x: mid, y: q.y }, q];
}

/** Ketma-ket takror nuqtalarni olib tashlaydi. */
export function dedupePoints(points: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > 0.01 || Math.abs(last.y - p.y) > 0.01) out.push(p);
  }
  return out;
}
