import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { FIGURE_LIMITS, type FigureSpec } from "../lib/generation/article/types.ts";
import { CANVAS_W, layoutFigure, type FigureLayout } from "../lib/generation/figures/layout.ts";
import { COMPARE_CRIT_FILL, COMPARE_HEAD_FILL, compareData } from "../lib/generation/figures/layout-compare.ts";
import { figureSvg } from "../lib/generation/figures/svg.ts";
import { figureFallbackBlocks } from "../lib/generation/figures/index.ts";
import { figureSpecFromLlm } from "../lib/generation/article/engine.ts";

/**
 * Maqola 3 (AUDIT-18) WP-B — TAQQOSLASH (`compare`).
 *
 * Maket: `rows`siz — IKKI ustun yonma-yon (bo'yalgan qalin sarlavha + «•»
 * bandlar, bir xil balandlik); `rows` bilan — UCH ustun (mezon | chap |
 * o'ng), qator soni = `rows`, yo'q qiymat «—». `figureSpecFromLlm`: ≤6
 * band, `rows` ≤6 va bandlar qator soniga kesiladi.
 */

const COLS: FigureSpec = {
  kind: "compare",
  left: { title: "An’anaviy", items: ["Jadval bo‘yicha", "Qo‘lda hisobot", "Katta zaxira"] },
  right: { title: "Taklif", items: ["Holatga qarab", "Avtomatik hisobot", "Zaxira talab bo‘yicha", "Bashorat"] },
};
const ROWS: FigureSpec = {
  kind: "compare",
  rows: ["Qaror asosi", "Aralashuv vaqti", "Xarajat"],
  left: { title: "An’anaviy", items: ["Tajriba", "Nosozlikdan keyin", "Yuqori"] },
  right: { title: "Taklif", items: ["Ma’lumot", "Nosozlikdan oldin"] },
};

const distinctX = (l: FigureLayout, pred: (id: string) => boolean) => [...new Set(l.nodes.filter((n) => pred(n.id)).map((n) => Math.round(n.x)))].sort((a, b) => a - b);

test("compare (ustunlar): ikki ustun yonma-yon, bir xil balandlik, sarlavha bo'yalgan qalin, bandlar «•» bilan sarlavha ostida, kanvas 160 mm", () => {
  const l = layoutFigure(COLS);
  assert.ok(l);
  assert.equal(l.kind, "compare");
  assert.equal(l.w, CANVAS_W);
  const cols = l.prims.filter((p): p is Extract<typeof p, { k: "rect" }> => p.k === "rect");
  assert.equal(cols.length, 2, "ikki ustun ramkasi");
  assert.ok(cols[0].x + cols[0].w < cols[1].x, "chap ustun o'ngdan oldin, oraliq bilan");
  assert.ok(Math.abs(cols[0].h - cols[1].h) < 0.01 && Math.abs(cols[0].w - cols[1].w) < 0.01, "ustunlar bir xil");
  assert.ok(Math.abs(cols[1].x + cols[1].w - (CANVAS_W - 10)) < 0.5, "o'ng ustun kanvas chetigacha");
  const h0 = l.nodes.find((n) => n.id === "h0")!;
  const h1 = l.nodes.find((n) => n.id === "h1")!;
  assert.equal(h0.lines[0], "An’anaviy");
  assert.equal(h1.lines[0], "Taklif");
  assert.ok(h0.bold && h1.bold && h0.fill === COMPARE_HEAD_FILL && h1.fill === COMPARE_HEAD_FILL);
  const left = l.nodes.filter((n) => n.id.startsWith("c0i"));
  const right = l.nodes.filter((n) => n.id.startsWith("c1i"));
  assert.equal(left.length, 3);
  assert.equal(right.length, 4);
  for (const it of [...left, ...right]) {
    assert.match(it.lines[0], /^• /);
    assert.equal(it.align, "start");
  }
  for (const it of left) assert.ok(it.y >= h0.y + h0.h && it.x >= cols[0].x && it.x + it.w <= cols[0].x + cols[0].w + 0.5, `${it.id} chap ustunda`);
  for (const it of right) assert.ok(it.x >= cols[1].x, `${it.id} o'ng ustunda`);
  const last = right[right.length - 1];
  assert.ok(last.y + last.h <= cols[1].y + cols[1].h, "oxirgi band ramka ichida");
  assert.deepEqual(distinctX(l, (id) => id.startsWith("h")).length, 2, "2 ustun");
  for (const n of l.nodes) assert.ok(n.x >= 0 && n.y >= 0 && n.x + n.w <= l.w + 0.5 && n.y + n.h <= l.h + 0.5, "kanvas ichida");
});

test("compare (rows): UCH ustun — mezon | chap | o'ng; qator soni = rows; yo'q qiymat «—»; mezon katagi bo'yalgan qalin; sarlavha qatori bo'yalgan", () => {
  const l = layoutFigure(ROWS)!;
  assert.deepEqual(distinctX(l, (id) => /^r\d+c\d$/.test(id)).length, 3, "3 ustun (mutatsiya: ustun soni o'zgarsa qizaradi)");
  const rows = new Set(l.nodes.filter((n) => /^r\d+c/.test(n.id)).map((n) => n.id.match(/^r(\d+)/)![1]));
  assert.equal(rows.size, 3, "3 qator");
  const cell = (r: number, c: number) => l.nodes.find((n) => n.id === `r${r}c${c}`)!;
  assert.equal(cell(0, 0).lines[0], "Qaror asosi");
  assert.equal(cell(0, 1).lines[0], "Tajriba");
  assert.equal(cell(0, 2).lines[0], "Ma’lumot");
  assert.equal(cell(2, 2).lines[0], "—", "o'ng tomonda 3-qiymat yo'q → «—»");
  assert.equal(cell(2, 1).lines[0], "Yuqori");
  for (let r = 0; r < 3; r++) {
    assert.ok(cell(r, 0).bold && cell(r, 0).fill === COMPARE_CRIT_FILL, "mezon katagi");
    assert.ok(!cell(r, 1).bold && !cell(r, 1).fill, "qiymat katagi oddiy");
    assert.ok(cell(r, 0).x < cell(r, 1).x && cell(r, 1).x < cell(r, 2).x, "ustunlar chapdan o'ngga");
    assert.ok(Math.abs(cell(r, 0).y - cell(r, 2).y) < 0.01 && Math.abs(cell(r, 0).h - cell(r, 2).h) < 0.01, "qator kataklari bir balandlikda");
    if (r) assert.ok(Math.abs(cell(r, 0).y - (cell(r - 1, 0).y + cell(r - 1, 0).h)) < 0.01, "qatorlar tutash");
  }
  const heads = [0, 1, 2].map((c) => l.nodes.find((n) => n.id === `h${c}`)!);
  assert.deepEqual(heads.map((h) => h.lines[0] ?? ""), ["", "An’anaviy", "Taklif"]);
  assert.ok(heads.every((h) => h.fill === COMPARE_HEAD_FILL && h.bold));
  assert.ok(Math.abs(heads[0].y + heads[0].h - cell(0, 0).y) < 0.01, "sarlavha qatori ostida birinchi qator");
  assert.ok(cell(0, 0).w < cell(0, 1).w, "mezon ustuni torroq");
  assert.equal(l.prims.filter((p) => p.k === "rect").length, 0, "rows rejimida alohida ramka prim yo'q — kataklarning o'zi ramka");
});

test("compare: bandlar ≤6 (7 → 6), rows ≤6, bandlar rows soniga kesiladi; bo'sh sarlavha/bandsiz → null", () => {
  assert.equal(FIGURE_LIMITS.compareItems, 6);
  const seven = compareData({ kind: "compare", left: { title: "L", items: ["1", "2", "3", "4", "5", "6", "7"] }, right: { title: "R", items: ["a"] } })!;
  assert.equal(seven.left.items.length, 6);
  const d = compareData({ kind: "compare", rows: ["r1", "r2", "", "r3", "r4", "r5", "r6", "r7"], left: { title: "L", items: ["1", "2", "3", "4", "5", "6", "7", "8"] }, right: { title: "R", items: [] } })!;
  assert.deepEqual(d.rows, ["r1", "r2", "r3", "r4", "r5", "r6"]);
  assert.equal(d.left.items.length, 6, "bandlar qator soniga kesiladi");
  assert.equal(compareData({ kind: "compare", left: { title: "", items: ["1"] }, right: { title: "R", items: ["a"] } }), null);
  assert.equal(compareData({ kind: "compare", left: { title: "L", items: [] }, right: { title: "R", items: [] } }), null);
  assert.equal(layoutFigure({ kind: "compare", left: { title: "L", items: [] }, right: { title: "R", items: [] } }), null);
  assert.ok(layoutFigure({ kind: "compare", rows: ["a", "b"], left: { title: "L", items: ["1"] }, right: { title: "R", items: [] } }), "faqat bir tomonda band bo'lsa ham chiziladi («—» bilan)");
});

test("compare: SVG — bo'yalgan sarlavhalar, «•» bandlar, rows rejimida 3 ustunli ramka, to'g'ri XML", () => {
  const svg = figureSvg(layoutFigure(COLS)!);
  const doc = new JSDOM(svg, { contentType: "image/svg+xml" }).window.document;
  assert.equal([...doc.querySelectorAll("rect")].filter((r) => r.getAttribute("fill") === COMPARE_HEAD_FILL).length, 2);
  const text = [...doc.querySelectorAll("text")].map((t) => t.textContent ?? "").join(" ");
  for (const s of ["An’anaviy", "Taklif", "• Jadval bo‘yicha", "• Bashorat"]) assert.ok(text.includes(s), `«${s}» SVG'da`);
  assert.equal(doc.querySelectorAll("polyline").length, 0, "o'q yo'q");
  const rows = figureSvg(layoutFigure(ROWS)!);
  const rdoc = new JSDOM(rows, { contentType: "image/svg+xml" }).window.document;
  assert.equal([...rdoc.querySelectorAll("rect")].filter((r) => r.getAttribute("fill") === COMPARE_CRIT_FILL).length, 3, "3 mezon katagi");
  assert.equal([...rdoc.querySelectorAll("rect")].filter((r) => r.getAttribute("stroke") === "#000").length, 12, "3 sarlavha + 3×3 katak = 12 ramka");
  assert.ok([...rdoc.querySelectorAll("text")].some((t) => t.textContent === "—"), "«—» chizilgan");
});

test("compare: figureSpecFromLlm — ≤6 band, rows bilan bandlar qator soniga; tomon sarlavhasiz → null; fallback (ustun/rows)", () => {
  const s = figureSpecFromLlm({ kind: "compare", left: { title: "L", items: ["1", "2", "3", "4", "5", "6", "7"] }, right: { title: "R", items: ["a", ""] } }, {});
  assert.deepEqual(s, { kind: "compare", left: { title: "L", items: ["1", "2", "3", "4", "5", "6"] }, right: { title: "R", items: ["a"] } });
  const r = figureSpecFromLlm({ kind: "compare", rows: ["k1", "k2"], left: { title: "L", items: ["1", "2", "3"] }, right: { title: "R", items: ["a", "b", "c"] } }, {});
  assert.deepEqual(r, { kind: "compare", left: { title: "L", items: ["1", "2"] }, right: { title: "R", items: ["a", "b"] }, rows: ["k1", "k2"] });
  assert.equal(figureSpecFromLlm({ kind: "compare", left: { items: ["1"] }, right: { title: "R", items: ["a"] } }, {}), null);
  assert.equal(figureSpecFromLlm({ kind: "compare", left: { title: "L", items: [] }, right: { title: "R", items: [] } }, {}), null);
  const li = (spec: FigureSpec) => figureFallbackBlocks({ id: "f", kind: "scheme", caption: "", spec, w: 0, h: 0 }, "uz").filter((b) => b.kind === "li").map((b) => b.text);
  assert.deepEqual(li(COLS), ["An’anaviy: Jadval bo‘yicha, Qo‘lda hisobot, Katta zaxira", "Taklif: Holatga qarab, Avtomatik hisobot, Zaxira talab bo‘yicha, Bashorat"]);
  assert.deepEqual(li(ROWS), ["Qaror asosi: An’anaviy — Tajriba; Taklif — Ma’lumot", "Aralashuv vaqti: An’anaviy — Nosozlikdan keyin; Taklif — Nosozlikdan oldin", "Xarajat: An’anaviy — Yuqori; Taklif — —"]);
});
