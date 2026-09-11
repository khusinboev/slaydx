import test from "node:test";
import assert from "node:assert/strict";
import type { FigureSpec } from "../lib/generation/article/types.ts";
import { layoutFigure } from "../lib/generation/figures/layout.ts";
import { CHART_MAX_CATEGORIES, CHART_MAX_SERIES, chartData, fmtNum, niceTicks, type ChartSpec } from "../lib/generation/figures/chart.ts";

/**
 * Maqola 2 (AUDIT-17) WP3 — raqamli grafik: FAQAT `dataSource: "user"`
 * (uydirma raqam taqiqi), o'qlar/to'r/legenda/qiymatlar, bar/line/pie.
 */

const BAR: ChartSpec = {
  kind: "chart",
  chart: "bar",
  dataSource: "user",
  series: [
    { name: "Tajriba", values: [62.5, 71.2, 78.9, 84.3] },
    { name: "Nazorat", values: [61.8, 64.1, 66.7, 69] },
  ],
  categories: ["1-nazorat", "2-nazorat", "3-nazorat", "Yakuniy"],
  unit: "%",
};

test("chart: dataSource ≠ user → null (model/undefined/bo'sh) — asosiy darvoza", () => {
  assert.ok(chartData(BAR));
  assert.equal(chartData({ ...BAR, dataSource: "model" } as unknown as ChartSpec), null);
  assert.equal(chartData({ ...BAR, dataSource: undefined } as unknown as ChartSpec), null);
  assert.equal(chartData({ ...BAR, dataSource: "" } as unknown as ChartSpec), null);
  assert.equal(layoutFigure({ ...BAR, dataSource: "llm" } as unknown as FigureSpec), null);
  assert.ok(layoutFigure(BAR));
});

test("chart: ma'lumot tekshiruvi — qisqa qator, NaN, >12 kategoriya, >6 seriya, bo'sh → null; ortiqcha qiymat kesiladi", () => {
  assert.equal(CHART_MAX_CATEGORIES, 12);
  assert.equal(CHART_MAX_SERIES, 6);
  assert.equal(chartData({ ...BAR, series: [{ name: "A", values: [1, 2, 3] }] }), null, "qator kategoriyadan qisqa — to'ldirilmaydi");
  assert.equal(chartData({ ...BAR, series: [{ name: "A", values: [1, 2, Number.NaN, 4] }] }), null);
  assert.equal(chartData({ ...BAR, series: [{ name: "A", values: [1, 2, "x" as unknown as number, 4] }] }), null);
  assert.equal(chartData({ ...BAR, categories: Array.from({ length: 13 }, (_, i) => `k${i}`), series: [{ name: "A", values: Array(13).fill(1) }] }), null);
  assert.equal(chartData({ ...BAR, series: Array.from({ length: 7 }, (_, i) => ({ name: `S${i}`, values: [1, 2, 3, 4] })) }), null);
  assert.equal(chartData({ ...BAR, series: [] }), null);
  assert.equal(chartData({ ...BAR, categories: [] }), null);
  assert.equal(chartData({ ...BAR, categories: ["a", "", "c", "d"] }), null);
  assert.equal(chartData({ ...BAR, chart: "scatter" as "bar" }), null);
  const d = chartData({ ...BAR, series: [{ name: "A", values: [1, 2, 3, 4, 5, 6] }] })!;
  assert.deepEqual(d.series[0].values, [1, 2, 3, 4]);
  assert.equal(d.unit, "%");
  assert.equal(chartData({ ...BAR, series: [{ name: "  ", values: [1, 2, 3, 4] }] })!.series[0].name, "1", "bo'sh nom → tartib raqami");
});

test("chart bar: o'qlar, to'r, 8 ustun naqsh bilan, qiymat yorliqlari, legenda 2 seriya, birlik burilgan", () => {
  const l = layoutFigure(BAR, { lang: "uz" })!;
  assert.equal(l.kind, "chart");
  assert.equal(l.w, 605);
  assert.equal(l.mm.w, 160);
  assert.equal(l.patterns.length, 2);
  const bars = l.prims.filter((p) => p.k === "rect" && p.pattern && p.h > 10);
  assert.equal(bars.length, 8);
  // Balandroq qiymat — balandroq ustun; hamma ustun 0 chizig'ida tugaydi.
  const bottoms = new Set(bars.map((b) => (b.k === "rect" ? Math.round(b.y + b.h) : 0)));
  assert.equal(bottoms.size, 1, "ustunlar 0 dan boshlanadi");
  const h = (i: number) => (bars[i].k === "rect" ? bars[i].h : 0);
  assert.ok(h(3) > h(0), "84.3 > 62.5");
  const axes = l.prims.filter((p) => p.k === "line" && p.stroke === "#000" && p.width === 1.2);
  assert.equal(axes.length, 2, "x va y o'qlari");
  const grid = l.prims.filter((p) => p.k === "line" && p.dash === "3 3");
  assert.ok(grid.length >= 4, "to'r chiziqlari");
  const texts = l.texts.map((t) => t.text);
  for (const v of ["62,5", "71,2", "78,9", "84,3", "61,8", "64,1", "66,7", "69"]) assert.ok(texts.includes(v), `qiymat ${v} (uz — vergul)`);
  for (const c of BAR.categories) assert.ok(texts.includes(c));
  assert.ok(texts.includes("Tajriba") && texts.includes("Nazorat"), "legenda");
  assert.ok(texts.includes("0") && texts.includes("100"), "o'q bo'linmalari 0..100");
  const unit = l.texts.find((t) => t.text === "%");
  assert.ok(unit && unit.rotate === -90, "birlik y o'qi bo'ylab burilgan");
  // Legenda kvadratlari — ustunlar bilan bir xil naqsh id.
  const sw = l.prims.filter((p) => p.k === "rect" && p.pattern && p.h <= 10);
  assert.equal(sw.length, 2);
});

test("chart line: har seriya polilinya + markerlar, dash farqi, qiymatlar; tor diapazon 0 ga majburlanmaydi", () => {
  const spec: ChartSpec = {
    kind: "chart",
    chart: "line",
    dataSource: "user",
    series: [
      { name: "A", values: [120, 135, 150] },
      { name: "B", values: [90, 95, 110] },
    ],
    categories: ["Yan", "Fev", "Mar"],
  };
  const l = layoutFigure(spec, { lang: "en" })!;
  const lines = l.prims.filter((p) => p.k === "polyline");
  assert.equal(lines.length, 2);
  assert.equal(l.prims.filter((p) => p.k === "marker").length, 6 + 2, "6 nuqta + 2 legenda markeri");
  assert.notEqual(lines[0].k === "polyline" ? lines[0].dash : "", lines[1].k === "polyline" ? lines[1].dash : "", "B/W: chiziq uslubi farqli");
  assert.equal(l.patterns.length, 0, "chiziqli grafikda naqsh yo'q");
  const texts = l.texts.map((t) => t.text);
  for (const v of ["120", "135", "150", "90", "95", "110"]) assert.ok(texts.includes(v));
  // Nuqtalar chapdan o'ngga, balandroq qiymat yuqorida (kichik y).
  const a = lines[0].k === "polyline" ? lines[0].points : [];
  assert.ok(a[0].x < a[1].x && a[1].x < a[2].x);
  assert.ok(a[2].y < a[0].y, "150 nuqtasi 120 dan yuqorida");
  const narrow = layoutFigure({ ...spec, series: [{ name: "A", values: [95, 96, 97] }] }, { lang: "en" })!;
  assert.ok(!narrow.texts.some((t) => t.text === "0"), "tor diapazon — o'q 0 dan boshlanmaydi");
  const wide = layoutFigure({ ...spec, series: [{ name: "A", values: [0, 50, 97] }] }, { lang: "en" })!;
  assert.ok(wide.texts.some((t) => t.text === "0"));
});

test("chart pie: bo'laklar = kategoriyalar, foizlar 100 ga yig'iladi, legenda qiymat+birlik; manfiy/nol → null", () => {
  const spec: ChartSpec = { kind: "chart", chart: "pie", dataSource: "user", series: [{ name: "S", values: [148, 96, 44, 24] }], categories: ["Bakalavr", "Magistr", "O‘qituvchi", "Boshqa"], unit: "kishi" };
  const l = layoutFigure(spec, { lang: "uz" })!;
  const slices = l.prims.filter((p) => p.k === "path");
  assert.equal(slices.length, 4);
  assert.equal(new Set(slices.map((s) => (s.k === "path" ? s.pattern : ""))).size, 4, "har bo'lak o'z naqshi");
  const pct = l.texts.filter((t) => t.text.endsWith("%")).map((t) => Number(t.text.replace("%", "").replace(",", ".")));
  assert.equal(pct.length, 4);
  assert.ok(Math.abs(pct.reduce((a, b) => a + b, 0) - 100) < 0.3, `foizlar ${pct.join("+")} ≈ 100`);
  assert.ok(l.texts.some((t) => t.text === "Bakalavr — 148 kishi"));
  assert.ok(l.texts.some((t) => t.text === "Boshqa — 24 kishi"));
  assert.ok(l.texts.filter((t) => t.halo).length === 4, "foiz yorliqlari halo bilan (naqsh ustida o'qilsin)");
  assert.equal(layoutFigure({ ...spec, series: [{ name: "S", values: [1, -1, 2, 3] }] }), null);
  assert.equal(layoutFigure({ ...spec, series: [{ name: "S", values: [0, 0, 0, 0] }] }), null);
  // Bitta 100% bo'lak — to'liq doira yo'li (buzilmaydi).
  const one = layoutFigure({ ...spec, series: [{ name: "S", values: [5] }], categories: ["Hammasi"] })!;
  assert.equal(one.prims.filter((p) => p.k === "path").length, 1);
  assert.ok(one.texts.some((t) => t.text === "100%"));
});

test("chart: manfiy qiymatli ustunlar 0 chizig'idan pastga; ko'p ustunda qiymat yorliqlari o'chadi", () => {
  const l = layoutFigure({ kind: "chart", chart: "bar", dataSource: "user", series: [{ name: "S", values: [5, -3] }], categories: ["a", "b"] })!;
  const bars = l.prims.filter((p) => p.k === "rect" && p.pattern && p.h > 2);
  assert.equal(bars.length, 2);
  const zero = l.prims.find((p) => p.k === "line" && p.stroke === "#000" && p.width === 1.2 && Math.abs(p.y1 - p.y2) < 0.01);
  assert.ok(zero && zero.k === "line");
  const [pos, neg] = bars;
  assert.ok(pos.k === "rect" && Math.abs(pos.y + pos.h - zero.y1) < 0.6, "musbat ustun 0 da tugaydi");
  assert.ok(neg.k === "rect" && Math.abs(neg.y - zero.y1) < 0.6, "manfiy ustun 0 dan boshlanadi");
  assert.ok(l.texts.some((t) => t.text === "-3" || t.text === "−3"));
  const many = layoutFigure({ kind: "chart", chart: "bar", dataSource: "user", series: Array.from({ length: 3 }, (_, i) => ({ name: `S${i}`, values: Array(10).fill(i + 1) })), categories: Array.from({ length: 10 }, (_, i) => `k${i}`) })!;
  assert.ok(!many.texts.some((t) => t.text === "3" && t.size && t.size < 12), "30 ustun — qiymat yorliqlari yo'q (faqat o'q)");
});

test("chart: fmtNum va niceTicks", () => {
  assert.equal(fmtNum(1234.5, "uz"), "1 234,5");
  assert.equal(fmtNum(1234.5, "en"), "1 234.5");
  assert.equal(fmtNum(69, "uz"), "69");
  assert.equal(fmtNum(0.126, "uz"), "0,13");
  assert.equal(fmtNum(12.34, "ru"), "12,34");
  assert.equal(fmtNum(2.5, "uz"), "2,5");
  assert.equal(fmtNum(-3, "uz"), "-3");
  assert.equal(fmtNum(1000000, "en"), "1 000 000");
  assert.deepEqual(niceTicks(0, 84.3).ticks, [0, 20, 40, 60, 80, 100]);
  assert.deepEqual(niceTicks(0, 4).ticks, [0, 1, 2, 3, 4]);
  assert.deepEqual(niceTicks(-3, 5).ticks, [-4, -2, 0, 2, 4, 6]);
  assert.deepEqual(niceTicks(95, 97).ticks, [95, 95.5, 96, 96.5, 97]);
});
