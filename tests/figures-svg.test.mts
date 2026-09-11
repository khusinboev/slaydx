import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type { FigureSpec } from "../lib/generation/article/types.ts";
import { layoutFigure } from "../lib/generation/figures/layout.ts";
import { figureSvg } from "../lib/generation/figures/svg.ts";
import { svgWidthPx } from "../lib/generation/figures/png.ts";

/**
 * Maqola 2 (AUDIT-17) WP3 — `figureSvg`: XML to'g'riligi (jsdom XML rejimi
 * buzuq hujjatda XATO tashlaydi), `xmlEscape`, marker, shakl soni, naqshlar.
 *
 * jsdom faqat XML tekshiruvi va SONLAR uchun (`assert.ok`/`equal` raqamga);
 * DOM tugunlari `deepEqual` ga berilmaydi (CLAUDE.md, xotira).
 */

function parse(svg: string) {
  const dom = new JSDOM(svg, { contentType: "image/svg+xml" });
  return dom.window.document;
}

const FLOW: FigureSpec = {
  kind: "flow",
  direction: "TB",
  nodes: [
    { id: "s", label: "Boshlash", kind: "start" },
    { id: "d", label: "Ma’lumot <kiritish> & tekshirish", kind: "data" },
    { id: "q", label: "To‘g‘rimi?", kind: "decision" },
    { id: "e", label: "Yakun", kind: "end" },
  ],
  edges: [
    { from: "s", to: "d" },
    { from: "d", to: "q" },
    { from: "q", to: "e", label: "Ha & yo‘q" },
  ],
};

test("svg: to'g'ri XML, ildiz <svg>, width/height/viewBox 605 px, oq fon, shrift ro'yxati", () => {
  const l = layoutFigure(FLOW)!;
  const svg = figureSvg(l);
  const doc = parse(svg);
  assert.equal(doc.documentElement.tagName, "svg");
  assert.equal(doc.documentElement.getAttribute("width"), "605");
  assert.equal(doc.documentElement.getAttribute("height"), String(Math.round(l.h)));
  assert.equal(doc.documentElement.getAttribute("viewBox"), `0 0 605 ${Math.round(l.h)}`);
  assert.equal(svgWidthPx(svg), 605);
  assert.match(doc.documentElement.getAttribute("font-family") ?? "", /Times New Roman.*Liberation Serif.*Noto Serif.*serif/);
  // Birinchi rect — butun kanvas oq fon.
  const bg = doc.querySelector("svg > rect");
  assert.ok(bg);
  assert.equal(bg.getAttribute("fill"), "#fff");
  assert.equal(bg.getAttribute("width"), "605");
});

test("svg: xmlEscape — `<`/`&` matnda qochiriladi, xom teg yo'q", () => {
  const svg = figureSvg(layoutFigure(FLOW)!);
  assert.ok(svg.includes("&lt;kiritish&gt;"), "yorliqdagi < > qochirilgan");
  assert.ok(svg.includes("&lt;kiritish&gt; &amp;"), "& qochirilgan");
  assert.ok(!svg.includes("<kiritish>"), "xom teg yo'q");
  assert.ok(svg.includes("Ha &amp; yo‘q"), "qirra yorlig'i ham qochirilgan");
  const doc = parse(svg); // buzuq bo'lsa tashlaydi
  const texts = [...doc.querySelectorAll("text")].map((t) => t.textContent ?? "");
  assert.ok(texts.some((t) => t.includes("<kiritish>")), "DOM'da matn asl holida");
});

test("svg: o'q markeri bor; o'qli qirralar marker-end bilan, daraxt qirralari markersiz", () => {
  const svg = figureSvg(layoutFigure(FLOW)!);
  const doc = parse(svg);
  const marker = doc.querySelector("defs > marker#arrow");
  assert.ok(marker);
  assert.equal(marker.getAttribute("orient"), "auto");
  const polylines = [...doc.querySelectorAll("polyline")];
  assert.equal(polylines.length, 3);
  assert.ok(polylines.every((p) => p.getAttribute("marker-end") === "url(#arrow)"));
  assert.ok(polylines.every((p) => p.getAttribute("stroke") === "#000" && p.getAttribute("stroke-width") === "1.2"));
  const tree = figureSvg(layoutFigure({ kind: "tree", root: "R", children: [{ label: "A" }, { label: "B" }] })!);
  const tdoc = parse(tree);
  assert.equal(tdoc.querySelectorAll("polyline").length, 2);
  assert.equal(tdoc.querySelectorAll("polyline[marker-end]").length, 0);
});

test("svg: tugun soni = shakl soni (rect|polygon|ellipse minus fon), shakl turi tugun turiga mos", () => {
  const l = layoutFigure({ ...FLOW, edges: FLOW.kind === "flow" ? FLOW.edges.map((e) => ({ from: e.from, to: e.to })) : [] })!; // yorliqsiz — halo rect yo'q
  const doc = parse(figureSvg(l));
  const shapes = doc.querySelectorAll("rect, polygon, ellipse").length - 1; // fon
  assert.equal(shapes, l.nodes.length);
  assert.equal(doc.querySelectorAll("rect[rx]").length, 2, "start/end — yumaloq");
  assert.equal(doc.querySelectorAll("polygon").length, 2, "romb + parallelogramm");
  // Har tugun matni tspan qatorlari bilan, text-anchor middle.
  const nodeTexts = [...doc.querySelectorAll("text")].filter((t) => t.getAttribute("text-anchor") === "middle");
  assert.equal(nodeTexts.length, l.nodes.length);
  assert.equal(doc.querySelectorAll("tspan").length, l.nodes.reduce((s, n) => s + n.lines.length, 0));
});

test("svg: process badge doiralari, PRISMA burilgan matn transform bilan", () => {
  const p = parse(figureSvg(layoutFigure({ kind: "process", steps: ["A", "B", "C"] })!));
  assert.equal(p.querySelectorAll("circle").length, 3, "3 raqam doirasi");
  const pr = parse(figureSvg(layoutFigure({ kind: "prisma", identified: 10, screened: 8, excludedScreen: 3, eligible: 5, excludedElig: 1, included: 4 }, { lang: "en" })!));
  const rotated = [...pr.querySelectorAll("text[transform]")];
  assert.equal(rotated.length, 4);
  assert.ok(rotated.every((t) => /^rotate\(-90 /.test(t.getAttribute("transform") ?? "")));
  assert.deepEqual(
    rotated.map((t) => t.textContent),
    ["Identification", "Screening", "Eligibility", "Included"],
  );
});

test("svg: chart — <pattern> shtrixlar defs'da, ustunlar fill=url(#pt…), qiymat yorliqlari", () => {
  const spec: FigureSpec = {
    kind: "chart",
    chart: "bar",
    dataSource: "user",
    series: [
      { name: "A", values: [1, 2] },
      { name: "B", values: [3, 4] },
    ],
    categories: ["x", "y"],
  };
  const svg = figureSvg(layoutFigure(spec)!);
  const doc = parse(svg);
  const patterns = [...doc.querySelectorAll("defs > pattern")].map((p) => p.getAttribute("id"));
  assert.deepEqual(patterns, ["pt0", "pt1"]);
  assert.ok(doc.querySelector("pattern#pt1 line"), "diagonal shtrix chizig'i");
  assert.ok(doc.querySelector("pattern#pt1")?.getAttribute("patternTransform")?.includes("rotate(45)"));
  const bars = doc.querySelectorAll('rect[fill="url(#pt0)"]').length + doc.querySelectorAll('rect[fill="url(#pt1)"]').length;
  assert.equal(bars, 4 + 2, "4 ustun + 2 legenda kvadrati");
  const texts = [...doc.querySelectorAll("text")].map((t) => t.textContent);
  for (const v of ["1", "2", "3", "4"]) assert.ok(texts.includes(v), `qiymat ${v}`);
  assert.ok(texts.includes("A") && texts.includes("B") && texts.includes("x") && texts.includes("y"));
});

test("svg: shrift/font opsiyalari — font ro'yxati almashadi, fontSize masshtabi", () => {
  const l = layoutFigure({ kind: "process", steps: ["Bir", "Ikki"] })!;
  const svg = figureSvg(l, { font: "Noto Serif, serif", fontSize: 11 });
  const doc = parse(svg);
  assert.equal(doc.documentElement.getAttribute("font-family"), "Noto Serif, serif");
  assert.equal(doc.documentElement.getAttribute("font-size"), String(Math.round(l.fontSize * 100) / 100));
  const big = parse(figureSvg(l, { fontSize: 22 }));
  assert.equal(Number(big.documentElement.getAttribute("font-size")), Math.round(l.fontSize * 2 * 100) / 100);
});
