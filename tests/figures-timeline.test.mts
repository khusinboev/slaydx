import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { FIGURE_LIMITS, type FigureSpec } from "../lib/generation/article/types.ts";
import { CANVAS_W, layoutFigure, type FigureLayout } from "../lib/generation/figures/layout.ts";
import { TIMELINE_ROW_MAX, timelineEvents, timelineRows } from "../lib/generation/figures/layout-timeline.ts";
import { figureSvg } from "../lib/generation/figures/svg.ts";
import { figureFallbackBlocks } from "../lib/generation/figures/index.ts";
import { figureSpecFromLlm } from "../lib/generation/article/engine.ts";

/**
 * Maqola 3 (AUDIT-18) WP-B — VAQT CHIZIG'I (`timeline`).
 *
 * Maket: voqealar chapdan o'ngga KIRISH tartibida (x o'sadi), `when` belgi
 * ostida, yorliq navbatma-navbat tepada/pastda, ≤6 voqea — bir qator,
 * ko'p bo'lsa ikki qator (ikkinchisi pastda, yana chapdan boshlanadi);
 * kanvas past. `figureSpecFromLlm`: 3–10 voqea, `when` va `label` shart.
 */

const mk = (n: number): FigureSpec => ({ kind: "timeline", events: Array.from({ length: n }, (_, i) => ({ when: `${2015 + i}`, label: `Voqea ${i + 1} tavsifi` })) });

type Dot = Extract<FigureLayout["prims"][number], { k: "dot" }>;
type Line = Extract<FigureLayout["prims"][number], { k: "line" }>;
const dots = (l: FigureLayout): Dot[] => l.prims.filter((p): p is Dot => p.k === "dot");
const axes = (l: FigureLayout): Line[] => l.prims.filter((p): p is Line => p.k === "line" && Boolean(p.arrow));
const label = (l: FigureLayout, i: number) => {
  const n = l.nodes.find((x) => x.id === `e${i}`);
  assert.ok(n, `yorliq e${i}`);
  return n;
};

test("timeline: 5 voqea — bitta o'q, belgilar chapdan o'ngga tartibda, `when` belgi ostida, yorliqlar navbatma-navbat tepada/pastda, kanvas past", () => {
  const l = layoutFigure(mk(5));
  assert.ok(l);
  assert.equal(l.kind, "timeline");
  assert.equal(l.w, CANVAS_W);
  assert.equal(axes(l).length, 1, "bitta o'q chizig'i");
  const ds = dots(l);
  assert.equal(ds.length, 5);
  for (let i = 1; i < 5; i++) assert.ok(ds[i].x > ds[i - 1].x + 40, `belgi ${i} o'ngda`);
  const ax = axes(l)[0];
  for (const d of ds) assert.ok(Math.abs(d.y - ax.y1) < 0.01, "belgi o'q chizig'ida");
  assert.ok(ax.x2 > ax.x1 && Math.abs(ax.y1 - ax.y2) < 0.01, "o'q chapdan o'ngga, gorizontal");
  // `when` — belgi ostida, belgi bilan bir x da.
  const whens = l.texts.filter((t) => t.bold);
  assert.deepEqual(whens.map((t) => t.text), ["2015", "2016", "2017", "2018", "2019"]);
  whens.forEach((t, i) => {
    assert.ok(Math.abs(t.x - ds[i].x) < 0.01, "when belgi ostida");
    assert.ok(t.y > ds[i].y + ds[i].r, "when chiziq OSTIDA");
  });
  // Yorliqlar: juft indeks tepada, toq — pastda; markazi belgi ustida.
  for (let i = 0; i < 5; i++) {
    const n = label(l, i);
    assert.ok(Math.abs(n.x + n.w / 2 - ds[i].x) < 0.5, `yorliq ${i} belgi ustida markazlangan`);
    if (i % 2 === 0) assert.ok(n.y + n.h < ax.y1, `yorliq ${i} tepada`);
    else assert.ok(n.y > ax.y1 + 10, `yorliq ${i} pastda (when ostida)`);
    assert.equal(n.shape, "none");
  }
  // Tepadagi yorliqlar bir-biriga tegmaydi (ikki qadam oraliq), pastdagilar ham.
  const above = [0, 2, 4].map((i) => label(l, i));
  for (let a = 0; a < above.length - 1; a++) assert.ok(above[a].x + above[a].w <= above[a + 1].x, "tepadagi yorliqlar kesishmaydi");
  assert.ok(l.mm.h < 60, `balandlik ${l.mm.h} mm — past sxema`);
  for (const n of l.nodes) assert.ok(n.x >= 0 && n.y >= 0 && n.x + n.w <= l.w + 0.5 && n.y + n.h <= l.h + 0.5, "kanvas ichida");
});

test("timeline: 10 voqea (chegara) — ikki qator (5+5), ikkinchi qator pastda va chapdan boshlanadi, tartib davom etadi; 7 → 4+3", () => {
  assert.equal(FIGURE_LIMITS.timelineMax, 10);
  assert.equal(TIMELINE_ROW_MAX, 6);
  const l = layoutFigure(mk(10))!;
  assert.equal(axes(l).length, 2, "ikki o'q chizig'i");
  const ds = dots(l);
  assert.equal(ds.length, 10);
  const [a1, a2] = axes(l);
  assert.ok(a2.y1 > a1.y1 + 40, "ikkinchi qator pastda");
  for (let i = 0; i < 5; i++) assert.ok(Math.abs(ds[i].y - a1.y1) < 0.01, `belgi ${i} birinchi qatorda`);
  for (let i = 5; i < 10; i++) assert.ok(Math.abs(ds[i].y - a2.y1) < 0.01, `belgi ${i} ikkinchi qatorda`);
  assert.ok(ds[5].x < ds[4].x, "ikkinchi qator chapdan boshlanadi");
  assert.ok(Math.abs(ds[5].x - ds[0].x) < 0.01, "ikkinchi qator birinchi bilan bir xil boshlanadi");
  for (let i = 6; i < 10; i++) assert.ok(ds[i].x > ds[i - 1].x, "ikkinchi qatorda ham o'ngga");
  // `when` tartibi kirish tartibida (mutatsiya: voqealar aralashsa qizaradi).
  assert.deepEqual(l.texts.filter((t) => t.bold).map((t) => t.text), Array.from({ length: 10 }, (_, i) => `${2015 + i}`));
  assert.deepEqual(timelineRows(timelineEvents(mk(7) as Extract<FigureSpec, { kind: "timeline" }>)!).map((r) => r.length), [4, 3]);
  assert.deepEqual(timelineRows(timelineEvents(mk(6) as Extract<FigureSpec, { kind: "timeline" }>)!).map((r) => r.length), [6]);
  assert.ok(layoutFigure(mk(6))!.h < l.h, "bir qatorli maket pastroq");
});

test("timeline: 3 voqea bo'ladi, 2 → null; bo'sh `when`/`label` tashlanadi; 11 → 10 ga kesiladi", () => {
  assert.equal(FIGURE_LIMITS.timelineMin, 3);
  assert.ok(layoutFigure(mk(3)));
  assert.equal(layoutFigure(mk(2)), null);
  assert.equal(timelineEvents(mk(11) as Extract<FigureSpec, { kind: "timeline" }>)!.length, 10);
  const ev = timelineEvents({ kind: "timeline", events: [{ when: "2020", label: "A" }, { when: "", label: "B" }, { when: "2021", label: " " }, { when: "2022", label: "C" }, { when: "2023", label: "D" }] })!;
  assert.deepEqual(ev.map((e) => e.when), ["2020", "2022", "2023"]);
  assert.equal(layoutFigure({ kind: "timeline", events: [{ when: "2020", label: "A" }, { when: "", label: "B" }, { when: "2021", label: " " }] }), null);
});

test("timeline: SVG — o'q chizig'i marker-end bilan, aylana belgilar (oq, qora chegara), `when` qalin, to'g'ri XML", () => {
  const svg = figureSvg(layoutFigure(mk(4))!);
  const doc = new JSDOM(svg, { contentType: "image/svg+xml" }).window.document;
  assert.equal(doc.querySelectorAll("line[marker-end='url(#arrow)']").length, 1);
  const circles = [...doc.querySelectorAll("circle")];
  assert.equal(circles.length, 4);
  assert.ok(circles.every((c) => c.getAttribute("fill") === "#fff" && c.getAttribute("stroke") === "#000"));
  const bold = [...doc.querySelectorAll("text[font-weight='bold']")].map((t) => t.textContent);
  assert.deepEqual(bold, ["2015", "2016", "2017", "2018"]);
  const text = [...doc.querySelectorAll("text")].map((t) => t.textContent ?? "").join(" ");
  for (let i = 1; i <= 4; i++) assert.ok(text.includes(`Voqea ${i}`));
});

test("timeline: figureSpecFromLlm — 3–10 voqea, when ≤40/label ≤90, bo'sh tashlanadi; fallback «when — label» tartibda", () => {
  const s = figureSpecFromLlm({ kind: "timeline", events: [{ when: "2019", label: "A" }, { when: "2020" }, { when: "2021", label: "B" }, { label: "C" }, { when: "2022", label: "D" }], direction: "LR" }, {});
  assert.deepEqual(s, { kind: "timeline", events: [{ when: "2019", label: "A" }, { when: "2021", label: "B" }, { when: "2022", label: "D" }] });
  assert.equal(figureSpecFromLlm({ kind: "timeline", events: [{ when: "2019", label: "A" }, { when: "2020", label: "B" }] }, {}), null);
  const many = figureSpecFromLlm({ kind: "timeline", events: Array.from({ length: 12 }, (_, i) => ({ when: `${i}`, label: `L${i}` })) }, {});
  assert.ok(many && many.kind === "timeline" && many.events.length === 10);
  const li = figureFallbackBlocks({ id: "f", kind: "scheme", caption: "Tarix", spec: mk(3), w: 0, h: 0 }, "uz").filter((b) => b.kind === "li").map((b) => b.text);
  assert.deepEqual(li, ["2015 — Voqea 1 tavsifi", "2016 — Voqea 2 tavsifi", "2017 — Voqea 3 tavsifi"]);
});
