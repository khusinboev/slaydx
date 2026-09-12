import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { FIGURE_LIMITS, type FigureSpec } from "../lib/generation/article/types.ts";
import { CANVAS_W, layoutFigure, type FigureLayout } from "../lib/generation/figures/layout.ts";
import { MATRIX_TITLE_FILL, bulletLines, matrixData } from "../lib/generation/figures/layout-matrix.ts";
import { wrapToWidth, textWidth } from "../lib/generation/figures/model.ts";
import { figureSvg } from "../lib/generation/figures/svg.ts";
import { figureFallbackBlocks } from "../lib/generation/figures/index.ts";
import { figureSpecFromLlm } from "../lib/generation/article/engine.ts";

/**
 * Maqola 3 (AUDIT-18) WP-B — 2×2 MATRITSA (`matrix`).
 *
 * Maket: 4 kvadrant KIRISH tartibida — q1 yuqori-chap, q2 yuqori-o'ng, q3
 * pastki-chap, q4 pastki-o'ng; kataklar bir xil, panjara tekis; o'qlar
 * ixtiyoriy (`xAxis` pastda o'ngga, `yAxis` chapda yuqoriga, burilgan
 * matn); SWOT — o'qsiz. `figureSpecFromLlm`: AYNAN 4 kvadrant, ≤4 band.
 */

const SPEC: FigureSpec = {
  kind: "matrix",
  xAxis: { low: "Past", high: "Yuqori", label: "Murakkablik" },
  yAxis: { low: "Kam", high: "Ko‘p", label: "Ta’sir" },
  quadrants: [
    { title: "Tezkor g‘alaba", items: ["A1", "A2"] },
    { title: "Strategik", items: ["B1"] },
    { title: "Ikkinchi darajali", items: ["C1", "C2", "C3"] },
    { title: "Qayta ko‘rish" },
  ],
};
const SWOT: FigureSpec = { kind: "matrix", quadrants: [{ title: "S", items: ["s1"] }, { title: "W", items: ["w1"] }, { title: "O", items: ["o1"] }, { title: "T", items: ["t1"] }] };

const q = (l: FigureLayout, i: number) => {
  const n = l.nodes.find((x) => x.id === `q${i}`);
  assert.ok(n, `kvadrant q${i}`);
  return n;
};

test("matrix: kvadrantlar tartibi — q1 yuqori-chap, q2 yuqori-o'ng, q3 pastki-chap, q4 pastki-o'ng; kataklar bir xil; kanvas 160 mm", () => {
  const l = layoutFigure(SPEC);
  assert.ok(l);
  assert.equal(l.kind, "matrix");
  assert.equal(l.w, CANVAS_W);
  const [q1, q2, q3, q4] = [1, 2, 3, 4].map((i) => q(l, i));
  assert.ok(q1.x < q2.x && Math.abs(q1.y - q2.y) < 0.01, "q1 chapda, q2 o'ngda, bir qatorda");
  assert.ok(q3.x < q4.x && Math.abs(q3.y - q4.y) < 0.01, "q3 chapda, q4 o'ngda");
  assert.ok(q3.y > q1.y + 20 && Math.abs(q1.x - q3.x) < 0.01, "q3 q1 ostida");
  assert.ok(Math.abs(q1.x + q1.w - q2.x) < 0.01, "ustunlar tutash");
  assert.equal(q1.lines[0], "Tezkor g‘alaba");
  assert.equal(q4.lines[0], "Qayta ko‘rish");
  for (const n of [q1, q2, q3, q4]) {
    assert.equal(n.bold, true);
    assert.equal(n.fill, MATRIX_TITLE_FILL);
    assert.ok(Math.abs(n.w - q1.w) < 0.01 && Math.abs(n.h - q1.h) < 0.01, "sarlavha yo'lakchalari bir xil");
  }
  const cells = l.prims.filter((p): p is Extract<typeof p, { k: "rect" }> => p.k === "rect");
  assert.equal(cells.length, 4);
  assert.ok(cells.every((c) => Math.abs(c.w - cells[0].w) < 0.01 && Math.abs(c.h - cells[0].h) < 0.01), "kataklar bir xil o'lchamda");
  // Bandlar o'z katagi ichida, sarlavha ostida, chapdan («•»).
  const items = l.nodes.filter((n) => n.id.startsWith("q3i"));
  assert.equal(items.length, 3);
  for (const it of items) {
    assert.ok(it.y >= q3.y + q3.h && it.x >= q3.x && it.x + it.w <= q3.x + q3.w + 0.5, `band ${it.id} q3 ichida, sarlavha ostida`);
    assert.equal(it.align, "start");
    assert.match(it.lines[0], /^• /);
  }
  for (let i = 1; i < items.length; i++) assert.ok(items[i].y >= items[i - 1].y + items[i - 1].h, "bandlar ketma-ket");
  for (const n of l.nodes) assert.ok(n.x >= 0 && n.y >= 0 && n.x + n.w <= l.w + 0.5 && n.y + n.h <= l.h + 0.5, "kanvas ichida");
});

test("matrix: o'qlar — x pastda o'ngga (low chapda, high o'ngda, label o'rtada qalin), y chapda yuqoriga (burilgan, low pastda, high tepada); SWOT o'qsiz va kengroq panjara", () => {
  const l = layoutFigure(SPEC)!;
  const lines = l.prims.filter((p): p is Extract<typeof p, { k: "line" }> => p.k === "line" && Boolean(p.arrow));
  assert.equal(lines.length, 2);
  const cells = l.prims.filter((p): p is Extract<typeof p, { k: "rect" }> => p.k === "rect");
  const gridBottom = Math.max(...cells.map((c) => c.y + c.h));
  const gridLeft = Math.min(...cells.map((c) => c.x));
  const gridTop = Math.min(...cells.map((c) => c.y));
  const xAxis = lines.find((a) => Math.abs(a.y1 - a.y2) < 0.01)!;
  const yAxis = lines.find((a) => Math.abs(a.x1 - a.x2) < 0.01)!;
  assert.ok(xAxis && xAxis.y1 > gridBottom && xAxis.x2 > xAxis.x1, "x o'qi panjara ostida, o'ngga");
  assert.ok(yAxis && yAxis.x1 < gridLeft && yAxis.y2 < yAxis.y1 && Math.abs(yAxis.y2 - gridTop) < 0.5, "y o'qi chapda, yuqoriga");
  const t = (s: string) => l.texts.find((x) => x.text === s)!;
  assert.ok(t("Past").anchor === "start" && t("Yuqori").anchor === "end" && t("Past").x < t("Murakkablik").x && t("Murakkablik").x < t("Yuqori").x, "x: low | label | high");
  assert.equal(t("Murakkablik").bold, true);
  assert.ok(t("Past").y > xAxis.y1, "x yorliqlari chiziq ostida");
  assert.equal(t("Kam").rotate, -90);
  assert.ok(t("Kam").y > t("Ta’sir").y && t("Ta’sir").y > t("Ko‘p").y, "y: low pastda, label o'rtada, high tepada");
  assert.ok(t("Ta’sir").x < t("Kam").x, "y yorlig'i alohida (chaproq) ustunda — low/high bilan ustma-ust tushmaydi");
  assert.ok(t("Kam").x < yAxis.x1 && yAxis.x1 < gridLeft, "burilgan matn o'qdan chapda");
  const swot = layoutFigure(SWOT)!;
  assert.equal(swot.prims.filter((p) => p.k === "line").length, 0, "SWOT — o'qsiz");
  assert.equal(swot.texts.length, 0);
  const swotCells = swot.prims.filter((p): p is Extract<typeof p, { k: "rect" }> => p.k === "rect");
  assert.ok(swotCells[0].w > cells[0].w, "o'qsiz panjara kengroq");
  assert.ok(Math.abs(swotCells[0].x - 10) < 0.5 && Math.abs(swotCells[1].x + swotCells[1].w - (CANVAS_W - 10)) < 0.5, "SWOT panjarasi butun ichki kenglikda");
});

test("matrix: 4 dan boshqa kvadrant soni → null (3 va 5); bo'sh sarlavha tashlanadi; band ≤4; o'q faqat low+high bilan", () => {
  assert.equal(FIGURE_LIMITS.quadrants, 4);
  const three: FigureSpec = { kind: "matrix", quadrants: SWOT.kind === "matrix" ? SWOT.quadrants.slice(0, 3) : [] };
  assert.equal(layoutFigure(three), null);
  const five: FigureSpec = { kind: "matrix", quadrants: SWOT.kind === "matrix" ? [...SWOT.quadrants, { title: "X" }] : [] };
  assert.equal(layoutFigure(five), null);
  assert.equal(matrixData({ kind: "matrix", quadrants: [{ title: "A" }, { title: " " }, { title: "C" }, { title: "D" }, { title: "E" }] })!.quadrants.map((x) => x.title).join(""), "ACDE");
  const d = matrixData({ kind: "matrix", xAxis: { low: "a", high: "" } as never, yAxis: { low: "l", high: "h" }, quadrants: [{ title: "A", items: ["1", "2", "3", "4", "5", ""] }, { title: "B" }, { title: "C" }, { title: "D" }] })!;
  assert.equal(d.xAxis, undefined, "high bo'sh — o'q yo'q");
  assert.deepEqual(d.yAxis, { low: "l", high: "h" });
  assert.equal(d.quadrants[0].items.length, FIGURE_LIMITS.quadrantItems);
});

test("matrix: band o'rash kenglik bo'yicha — «•» birinchi qatorda, davomi chekinish bilan (indent), «…» faqat sig'masa", () => {
  const w = 120;
  const lines = bulletLines("Raqamli infratuzilma yetishmasligi va ma’lumot sifati", w, 14, 2);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^• /);
  assert.ok(!lines[1].startsWith("•") && !lines[1].startsWith(" "), "davom qatorida «•» ham, bo'shliq ham yo'q (chekinish `indent` bilan)");
  for (const ln of lines) assert.ok(textWidth(ln, 14) <= w + 1, `«${ln}» kenglikka sig'adi`);
  assert.match(lines[1], /…$/, "ikki qatorga sig'magan qism «…» bilan");
  assert.deepEqual(wrapToWidth("Qisqa", 200, 14, 2), ["Qisqa"]);
  assert.deepEqual(wrapToWidth("Bir ikki uch", 200, 14, 2), ["Bir ikki uch"]);
  const l = layoutFigure(SWOT)!;
  const item = l.nodes.find((n) => n.id === "q1i0")!;
  assert.ok(item.indent && item.indent > 5, "band tugunida indent");
});

test("matrix: SVG — 4 bo'yalgan sarlavha, burilgan y-o'q matni (transform rotate), ikki o'q chizig'i marker bilan, to'g'ri XML", () => {
  const svg = figureSvg(layoutFigure(SPEC)!);
  const doc = new JSDOM(svg, { contentType: "image/svg+xml" }).window.document;
  assert.equal([...doc.querySelectorAll("rect")].filter((r) => r.getAttribute("fill") === MATRIX_TITLE_FILL).length, 4);
  assert.equal(doc.querySelectorAll("line[marker-end='url(#arrow)']").length, 2);
  const rotated = [...doc.querySelectorAll("text[transform]")].map((t) => t.textContent);
  assert.deepEqual(rotated.sort(), ["Kam", "Ko‘p", "Ta’sir"].sort());
  const text = [...doc.querySelectorAll("text")].map((t) => t.textContent ?? "").join(" ");
  for (const s of ["Tezkor g‘alaba", "Strategik", "• A1", "• C3", "Murakkablik", "Past", "Yuqori"]) assert.ok(text.includes(s), `«${s}» SVG'da`);
  // Davom qatori chekinishi — ikkinchi tspan x birinchisidan o'ngda.
  const long = figureSvg(layoutFigure({ kind: "matrix", quadrants: [{ title: "A", items: ["Juda uzun band matni bu yerda ikki qatorga o‘raladi va davom etadi albatta"] }, { title: "B" }, { title: "C" }, { title: "D" }] })!);
  const m = long.match(/<text text-anchor="start"[^>]*><tspan x="([\d.]+)" y="[\d.]+">• [^<]*<\/tspan><tspan x="([\d.]+)" dy=/);
  assert.ok(m, "ikki qatorli band");
  assert.ok(Number(m![2]) > Number(m![1]) + 5, `davom qatori chekingan: ${m![2]} > ${m![1]}`);
});

test("matrix: figureSpecFromLlm — aynan 4 kvadrant (3/5 → null), o'qlar ixtiyoriy, band ≤4; fallback — o'qlar + kvadrantlar tartibda", () => {
  const s = figureSpecFromLlm({ kind: "matrix", xAxis: { low: "L", high: "H" }, quadrants: [{ title: "A", items: ["1", "2", "3", "4", "5"] }, { title: "B" }, { title: "C", items: [] }, { title: "D" }] }, {});
  assert.deepEqual(s, { kind: "matrix", quadrants: [{ title: "A", items: ["1", "2", "3", "4"] }, { title: "B" }, { title: "C" }, { title: "D" }], xAxis: { low: "L", high: "H" } });
  assert.equal(figureSpecFromLlm({ kind: "matrix", quadrants: [{ title: "A" }, { title: "B" }, { title: "C" }] }, {}), null, "3 kvadrant → null");
  assert.equal(figureSpecFromLlm({ kind: "matrix", quadrants: [{ title: "A" }, { title: "B" }, { title: "C" }, { title: "D" }, { title: "E" }] }, {}), null, "5 kvadrant → null (kesilmaydi — tartib buziladi)");
  assert.equal(figureSpecFromLlm({ kind: "matrix", quadrants: [{ title: "A" }, { title: "" }, { title: "C" }, { title: "D" }] }, {}), null, "bo'sh sarlavha → 3 ta qoladi → null");
  const blocks = figureFallbackBlocks({ id: "f", kind: "scheme", caption: "Matritsa", spec: SPEC, w: 0, h: 0 }, "uz");
  assert.deepEqual(blocks[0], { kind: "p", text: "Matritsa:" });
  assert.deepEqual(blocks[1], { kind: "p", text: "Murakkablik: Past → Yuqori" });
  assert.deepEqual(blocks[2], { kind: "p", text: "Ta’sir: Kam → Ko‘p" });
  assert.deepEqual(
    blocks.filter((b) => b.kind === "li").map((b) => b.text),
    ["Tezkor g‘alaba: A1, A2", "Strategik: B1", "Ikkinchi darajali: C1, C2, C3", "Qayta ko‘rish"],
  );
});
