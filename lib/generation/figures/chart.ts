/**
 * Maqola 2 (AUDIT-17) WP3 — raqamli grafik: bar (guruhli), line, pie.
 *
 * QAT'IY QOIDA: faqat `dataSource: "user"` — foydalanuvchi bergan raqamlar.
 * Boshqa manba (yoki maydon yo'q) → `null` → `index.ts` fallback + «Ma’lumot
 * berilmagan» (uydirma raqam taqiqlangan, Q-2).
 *
 * Oq-qora chop: har qator (seriya) sokin ko'k/kulrang rang + o'z shtrix
 * naqshi (`PatternDef`, `svg.ts` `<pattern>`); chiziqli grafikda — chiziq
 * uslubi (dash) + marker shakli. O'qlar, to'r, legenda, qiymat yorliqlari.
 */
import type { FigureSpec } from "../article/types";
import { CANVAS_W, FONT_PX, LINE_K, MARGIN, emptyLayout, textWidth, wrapLabel, type FigureLayout, type LayoutText, type PatternDef, type Pt } from "./model";

export type ChartSpec = Extract<FigureSpec, { kind: "chart" }>;

export const CHART_MAX_SERIES = 6;
export const CHART_MAX_CATEGORIES = 12;

/** Sokin palitra (Maqola) — ko'k/kulrang; naqsh bilan juftlikda B/W da ham farqlanadi. */
export const CHART_PATTERNS: PatternDef[] = [
  { id: "pt0", base: "#4a6fa5", kind: "solid" },
  { id: "pt1", base: "#ccd6e0", kind: "diag" },
  { id: "pt2", base: "#8ea6c0", kind: "dots" },
  { id: "pt3", base: "#eaeff4", kind: "cross" },
  { id: "pt4", base: "#6e8db0", kind: "horiz" },
  { id: "pt5", base: "#d8e0e8", kind: "vert" },
];
/** Chiziqli grafik ranglari — to'q (naqsh fonlari och, chiziqqa yaramaydi). */
export const LINE_COLORS = ["#34527f", "#8a949f", "#1f2933", "#5f86b5", "#a3adb8", "#6b7f99"];
const LINE_DASH = ["", "7 4", "2 3", "9 3 2 3", "4 2", "12 4"];
const LINE_MARKER: Array<"circle" | "square" | "triangle" | "diamond"> = ["circle", "square", "triangle", "diamond", "circle", "square"];

export type ChartData = { chart: "bar" | "line" | "pie"; series: { name: string; values: number[] }[]; categories: string[]; unit?: string };

/**
 * Spec'ni tekshiradi va tozalaydi. `dataSource !== "user"` → `null` (asosiy
 * darvoza). Qator uzunligi kategoriyalardan KAM bo'lsa ham `null` — yetishmagan
 * qiymatni to'ldirish = uydirma.
 */
export function chartData(spec: ChartSpec): ChartData | null {
  if (!spec || spec.dataSource !== "user") return null;
  if (spec.chart !== "bar" && spec.chart !== "line" && spec.chart !== "pie") return null;
  if (!Array.isArray(spec.categories) || !Array.isArray(spec.series)) return null;
  const categories = spec.categories.map((c) => String(c ?? "").replace(/\s+/g, " ").trim());
  if (categories.length === 0 || categories.length > CHART_MAX_CATEGORIES || categories.some((c) => !c)) return null;
  const series: ChartData["series"] = [];
  for (const s of spec.series) {
    if (!s || typeof s !== "object" || !Array.isArray(s.values)) return null;
    if (s.values.length < categories.length) return null;
    const values = s.values.slice(0, categories.length).map((v) => Number(v));
    if (values.some((v) => !Number.isFinite(v))) return null;
    series.push({ name: String(s.name ?? "").replace(/\s+/g, " ").trim() || `${series.length + 1}`, values });
  }
  if (series.length === 0 || series.length > CHART_MAX_SERIES) return null;
  if (spec.chart === "pie") {
    const v = series[0].values;
    if (v.some((x) => x < 0) || v.reduce((a, b) => a + b, 0) <= 0) return null;
  }
  const unit = typeof spec.unit === "string" ? spec.unit.trim() : "";
  return { chart: spec.chart, series, categories, ...(unit ? { unit } : {}) };
}

/** Raqam formati: uz/ru — vergul kasr, ming ajratgich bo'shliq. */
export function fmtNum(v: number, lang = "uz"): string {
  const dec = Number.isInteger(v) ? 0 : 2; // foydalanuvchi raqami — 2 kasrgacha, nol kesiladi
  let s = v.toFixed(dec);
  if (dec > 0) s = s.replace(/\.?0+$/, "");
  const [int, frac] = s.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const sep = (lang || "uz").toLowerCase() === "en" ? "." : ",";
  return frac ? `${grouped}${sep}${frac}` : grouped;
}

/** «Chiroyli» o'q bo'linmalari (1-2-5 qadam). */
export function niceTicks(min: number, max: number, count = 5): { ticks: number[]; lo: number; hi: number } {
  if (max <= min) max = min + 1;
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(Math.round(t / step) * step);
  return { ticks, lo, hi };
}

const H_BAR = 340;
const H_PIE = 300;
const TICK_SIZE = FONT_PX * 0.85;
const VALUE_SIZE = FONT_PX * 0.8;

export function layoutChart(spec: ChartSpec, lang: string): FigureLayout | null {
  const d = chartData(spec);
  if (!d) return null;
  return d.chart === "pie" ? layoutPie(d, lang) : layoutAxes(d, lang);
}

/* ── legenda (bar/line): yuqorida, qatorlarga o'raladi ── */
function legend(out: FigureLayout, d: ChartData, x0: number, x1: number, y: number, line: boolean): number {
  if (d.series.length < 2) return y;
  const SW = 16;
  const rowH = FONT_PX * 1.4;
  let x = x0;
  let row = 0;
  d.series.forEach((s, i) => {
    const tw = textWidth(s.name, TICK_SIZE);
    const itemW = SW + 6 + tw + 18;
    if (x + itemW > x1 && x > x0) {
      row++;
      x = x0;
    }
    const cy = y + row * rowH + rowH / 2;
    if (line) {
      out.prims.push({ k: "line", x1: x, y1: cy, x2: x + SW, y2: cy, stroke: LINE_COLORS[i % 6], width: 1.8, dash: LINE_DASH[i % 6] });
      out.prims.push({ k: "marker", x: x + SW / 2, y: cy, shape: LINE_MARKER[i % 6], fill: LINE_COLORS[i % 6] });
    } else {
      out.prims.push({ k: "rect", x, y: cy - 5, w: SW, h: 10, pattern: CHART_PATTERNS[i % 6].id, stroke: "#000" });
    }
    out.texts.push({ x: x + SW + 6, y: cy, text: s.name, size: TICK_SIZE, anchor: "start" });
    x += itemW;
  });
  return y + (row + 1) * rowH;
}

function usedPatterns(n: number): PatternDef[] {
  return CHART_PATTERNS.slice(0, Math.min(n, 6));
}

/* ── bar / line ── */
function layoutAxes(d: ChartData, lang: string): FigureLayout {
  const out = emptyLayout("chart");
  const line = d.chart === "line";
  out.patterns = line ? [] : usedPatterns(d.series.length);
  const all = d.series.flatMap((s) => s.values);
  const dataMin = Math.min(...all);
  const dataMax = Math.max(...all);
  // Ustunlar doim 0 dan; chiziq — tor diapazonda 0 ga majburlanmaydi.
  const forceZero = !line || dataMin <= 0 || dataMax - dataMin > 0.3 * Math.abs(dataMax);
  const { ticks, lo, hi } = niceTicks(forceZero ? Math.min(0, dataMin) : dataMin, forceZero ? Math.max(0, dataMax) : dataMax);
  const unit = d.unit ?? "";
  const tickLabels = ticks.map((t) => fmtNum(t, lang));
  const tickW = Math.max(...tickLabels.map((t) => textWidth(t, TICK_SIZE)));
  const x0 = MARGIN + (unit ? FONT_PX * 1.3 : 0) + tickW + 10;
  const x1 = CANVAS_W - MARGIN - 6;
  const legendBottom = legend(out, d, x0, x1, MARGIN, line);
  const y0 = legendBottom + (d.series.length > 1 ? 10 : 6);
  const nCats = d.categories.length;
  const slot = (x1 - x0) / nCats;
  // Kategoriya yorliqlari — ≤2 qator, kenglik slotdan.
  const catChars = Math.max(6, Math.floor((slot - 6) / (0.5 * TICK_SIZE)));
  const catLines = d.categories.map((c) => wrapLabel(c, catChars, 2));
  const catRows = Math.max(...catLines.map((l) => l.length));
  const y1 = H_BAR - MARGIN - catRows * TICK_SIZE * LINE_K - 10;
  const Y = (v: number) => y1 - ((v - lo) / (hi - lo)) * (y1 - y0);

  /* to'r + o'qlar */
  for (const t of ticks) {
    const y = Y(t);
    if (Math.abs(t) > 1e-9) out.prims.push({ k: "line", x1: x0, y1: y, x2: x1, y2: y, stroke: "#c9d0d8", width: 0.8, dash: "3 3" });
    out.prims.push({ k: "line", x1: x0 - 4, y1: y, x2: x0, y2: y, stroke: "#000", width: 1 });
    out.texts.push({ x: x0 - 7, y, text: fmtNum(t, lang), size: TICK_SIZE, anchor: "end" });
  }
  out.prims.push({ k: "line", x1: x0, y1: y0, x2: x0, y2: y1, stroke: "#000", width: 1.2 });
  const zeroY = lo <= 0 && hi >= 0 ? Y(0) : y1;
  out.prims.push({ k: "line", x1: x0, y1: zeroY, x2: x1, y2: zeroY, stroke: "#000", width: 1.2 });
  if (unit) out.texts.push({ x: MARGIN + FONT_PX * 0.5, y: (y0 + y1) / 2, text: unit, size: TICK_SIZE, anchor: "middle", rotate: -90, italic: true });

  /* kategoriya yorliqlari */
  catLines.forEach((lines, i) => {
    const cx = x0 + slot * (i + 0.5);
    lines.forEach((t, k) => out.texts.push({ x: cx, y: y1 + 10 + (k + 0.5) * TICK_SIZE * LINE_K, text: t, size: TICK_SIZE, anchor: "middle" }));
  });

  const showValues = d.series.length * nCats <= 24;
  if (!line) {
    const groupW = slot * 0.72;
    const barW = groupW / d.series.length;
    d.series.forEach((s, j) => {
      s.values.forEach((v, i) => {
        const x = x0 + slot * i + (slot - groupW) / 2 + barW * j;
        const top = Y(Math.max(v, 0));
        const bottom = Y(Math.min(v, 0));
        out.prims.push({ k: "rect", x, y: top, w: barW, h: Math.max(bottom - top, 0.5), pattern: CHART_PATTERNS[j % 6].id, stroke: "#000" });
        if (showValues) out.texts.push({ x: x + barW / 2, y: v >= 0 ? top - VALUE_SIZE * 0.7 : bottom + VALUE_SIZE * 0.8, text: fmtNum(v, lang), size: VALUE_SIZE, anchor: "middle" });
      });
    });
  } else {
    d.series.forEach((s, j) => {
      const pts: Pt[] = s.values.map((v, i) => ({ x: x0 + slot * (i + 0.5), y: Y(v) }));
      const color = LINE_COLORS[j % 6];
      if (pts.length > 1) out.prims.push({ k: "polyline", points: pts, stroke: color, width: 1.8, dash: LINE_DASH[j % 6] });
      pts.forEach((p, i) => {
        out.prims.push({ k: "marker", x: p.x, y: p.y, shape: LINE_MARKER[j % 6], fill: color });
        if (showValues) out.texts.push({ x: p.x, y: p.y - VALUE_SIZE * 0.9, text: fmtNum(s.values[i], lang), size: VALUE_SIZE, anchor: "middle" });
      });
    });
  }
  out.w = CANVAS_W;
  out.h = H_BAR;
  out.mm = { w: 160, h: Math.round((H_BAR / (96 / 25.4)) * 10) / 10 };
  return out;
}

/* ── pie ── */
function layoutPie(d: ChartData, lang: string): FigureLayout {
  const out = emptyLayout("chart");
  const values = d.series[0].values;
  const total = values.reduce((a, b) => a + b, 0);
  out.patterns = usedPatterns(values.length);
  const r = 108;
  const cx = MARGIN + r + 30;
  const legendX = cx + r + 40;
  const rowH = FONT_PX * 1.45;
  const h = Math.max(H_PIE, MARGIN * 2 + values.length * rowH + 20);
  const cy = h / 2;
  let a = -Math.PI / 2;
  const slices: { pattern: string; text: LayoutText | null }[] = [];
  values.forEach((v, i) => {
    const frac = v / total;
    const ang = frac * 2 * Math.PI;
    const pat = CHART_PATTERNS[i % 6].id;
    const pct = `${fmtNum(Math.round(frac * 1000) / 10, lang)}%`;
    if (frac <= 0) {
      slices.push({ pattern: pat, text: null });
      return;
    }
    let dPath: string;
    if (frac >= 0.9999) {
      dPath = `M ${f(cx - r)} ${f(cy)} A ${r} ${r} 0 1 1 ${f(cx + r)} ${f(cy)} A ${r} ${r} 0 1 1 ${f(cx - r)} ${f(cy)} Z`;
    } else {
      const x1 = cx + r * Math.cos(a);
      const y1 = cy + r * Math.sin(a);
      const x2 = cx + r * Math.cos(a + ang);
      const y2 = cy + r * Math.sin(a + ang);
      dPath = `M ${f(cx)} ${f(cy)} L ${f(x1)} ${f(y1)} A ${r} ${r} 0 ${ang > Math.PI ? 1 : 0} 1 ${f(x2)} ${f(y2)} Z`;
    }
    out.prims.push({ k: "path", d: dPath, pattern: pat, stroke: "#000" });
    const mid = a + ang / 2;
    const inside = ang >= 0.35;
    const rr = inside ? r * 0.62 : r * 1.14;
    const tx = cx + rr * Math.cos(mid);
    const ty = cy + rr * Math.sin(mid);
    const text: LayoutText = { x: tx, y: ty, text: pct, size: VALUE_SIZE, anchor: inside ? "middle" : Math.cos(mid) >= 0 ? "start" : "end", bold: inside };
    slices.push({ pattern: pat, text });
    a += ang;
  });
  // Ichki foiz yorliqlari naqsh ustida o'qilsin — oq halo `svg.ts` da (`halo: true`).
  for (const s of slices) if (s.text) out.texts.push({ ...s.text, halo: true });
  /* legenda — o'ngda, vertikal */
  const y0 = cy - (values.length * rowH) / 2;
  const unit = d.unit ? ` ${d.unit}` : "";
  d.categories.forEach((c, i) => {
    const y = y0 + (i + 0.5) * rowH;
    out.prims.push({ k: "rect", x: legendX, y: y - 6, w: 16, h: 12, pattern: CHART_PATTERNS[i % 6].id, stroke: "#000" });
    const label = `${c} — ${fmtNum(values[i], lang)}${unit}`;
    const maxW = CANVAS_W - MARGIN - (legendX + 24);
    const shown = textWidth(label, TICK_SIZE) > maxW ? wrapLabel(label, Math.floor(maxW / (0.55 * TICK_SIZE)), 1)[0] : label;
    out.texts.push({ x: legendX + 24, y, text: shown, size: TICK_SIZE, anchor: "start" });
  });
  out.w = CANVAS_W;
  out.h = Math.round(h);
  out.mm = { w: 160, h: Math.round((h / (96 / 25.4)) * 10) / 10 };
  return out;
}

function f(n: number): string {
  return String(Math.round(n * 100) / 100);
}
