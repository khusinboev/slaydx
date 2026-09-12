import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { FIGURE_LIMITS, type FigureSpec } from "../lib/generation/article/types.ts";
import { CANVAS_W, layoutFigure, type FigureLayout } from "../lib/generation/figures/layout.ts";
import { arcPoints, arcSpan, ellipsePt } from "../lib/generation/figures/model.ts";
import { cycleSteps } from "../lib/generation/figures/layout-cycle.ts";
import { figureSvg } from "../lib/generation/figures/svg.ts";
import { figureFallbackBlocks } from "../lib/generation/figures/index.ts";
import { figureSpecFromLlm } from "../lib/generation/article/engine.ts";

/**
 * Maqola 3 (AUDIT-18) WP-B — SIKL (`cycle`).
 *
 * Maket: birinchi bosqich tepada, keyingilari soat yo'nalishida (2-bosqich
 * o'ngda), `clockwise:false` — teskari (2-bosqich chapda); bloklar bir xil
 * o'lchamda, kesishmaydi; har qo'shni juftlik orasida yoy (`arc` prim) —
 * boshi bir blokdan tashqarida, oxiri keyingisining chetida; yoy yo'nalishi
 * (sweep) aylanish yo'nalishiga mos. `figureSpecFromLlm`: 3–8 bosqich.
 */

const mk = (n: number, extra: Partial<Extract<FigureSpec, { kind: "cycle" }>> = {}): FigureSpec => ({
  kind: "cycle",
  steps: Array.from({ length: n }, (_, i) => ({ label: `Bosqich ${i + 1}` })),
  ...extra,
});

type Arc = Extract<FigureLayout["prims"][number], { k: "arc" }>;
const arcs = (l: FigureLayout): Arc[] => l.prims.filter((p): p is Arc => p.k === "arc");
const node = (l: FigureLayout, i: number) => {
  const n = l.nodes.find((x) => x.id === `c${i}`);
  assert.ok(n, `bosqich c${i}`);
  return n;
};
const center = (n: { x: number; y: number; w: number; h: number }) => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 });
const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test("cycle: 5 bosqich — birinchisi tepada, ikkinchisi o'ngda (soat yo'nalishi), bloklar bir xil o'lchamda va kesishmaydi, kanvas ichida", () => {
  const l = layoutFigure(mk(5));
  assert.ok(l);
  assert.equal(l.kind, "cycle");
  assert.equal(l.w, CANVAS_W);
  const cs = [1, 2, 3, 4, 5].map((i) => center(node(l, i)));
  const top = cs.reduce((a, b) => (b.y < a.y ? b : a));
  assert.deepEqual(top, cs[0], "1-bosqich eng tepada");
  assert.ok(cs[1].x > cs[0].x + 30, "2-bosqich o'ngda (soat yo'nalishi)");
  assert.ok(cs[4].x < cs[0].x - 30, "oxirgi bosqich chapda");
  assert.ok(Math.abs(cs[1].y - cs[4].y) < 1, "simmetriya: 2 va 5 bir balandlikda");
  const ws = new Set(l.nodes.filter((n) => n.id.startsWith("c")).map((n) => Math.round(n.w * 10)));
  assert.equal(ws.size, 1, "bloklar bir xil kenglikda");
  const nodes = l.nodes.filter((n) => n.id.startsWith("c"));
  for (let a = 0; a < nodes.length; a++) for (let b = a + 1; b < nodes.length; b++) assert.ok(!overlaps(nodes[a], nodes[b]), `${nodes[a].id}/${nodes[b].id} kesishmaydi`);
  for (const n of l.nodes) assert.ok(n.x >= 0 && n.y >= 0 && n.x + n.w <= l.w + 0.5 && n.y + n.h <= l.h + 0.5, "kanvas ichida");
  assert.ok(l.mm.h > 40 && l.mm.h <= 160, `balandlik ${l.mm.h} mm — taxminan kvadrat`);
});

test("cycle: har qo'shni juftlik orasida yoy o'q — boshi blokdan tashqarida, oxiri keyingi blok chetida, sweep=1 (soat yo'nalishi)", () => {
  const l = layoutFigure(mk(4))!;
  const as = arcs(l);
  assert.equal(as.length, 4, "4 bosqich → 4 yoy (oxirgisi birinchisiga qaytadi)");
  for (let i = 0; i < 4; i++) {
    const a = as[i];
    assert.equal(a.sweep, 1);
    assert.equal(a.arrow, true);
    const from = node(l, i + 1);
    const to = node(l, ((i + 1) % 4) + 1);
    const p0 = ellipsePt(a.cx, a.cy, a.rx, a.ry, a.a0);
    const p1 = ellipsePt(a.cx, a.cy, a.rx, a.ry, a.a1);
    const inside = (p: { x: number; y: number }, n: typeof from, pad: number) => p.x > n.x - pad && p.x < n.x + n.w + pad && p.y > n.y - pad && p.y < n.y + n.h + pad;
    assert.ok(!inside(p0, from, 0), `yoy ${i} boshi ${from.id} ichida emas`);
    assert.ok(inside(p0, from, 6), `yoy ${i} boshi ${from.id} chetida`);
    assert.ok(!inside(p1, to, 0), `yoy ${i} oxiri ${to.id} ichida emas`);
    assert.ok(inside(p1, to, 6), `yoy ${i} oxiri ${to.id} chetida (o'q uchi tegadi)`);
    assert.ok(arcSpan(a) > 0 && arcSpan(a) < 180, "yoy musbat va yarim aylanadan kichik");
    // Yoy uzunligi ko'rinarli (uch 9 px + tana).
    const pts = arcPoints(a, 8);
    let len = 0;
    for (let k = 1; k < pts.length; k++) len += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y);
    assert.ok(len >= 24, `yoy ${i} uzunligi ${len.toFixed(1)} ≥ 24 px`);
    // Yoy boshqa (uchinchi) bloklarni kesib o'tmaydi.
    for (const other of l.nodes) if (other.id !== from.id && other.id !== to.id) for (const p of pts) assert.ok(!inside(p, other, 0), `yoy ${i} ${other.id} ichidan o'tmaydi`);
  }
});

test("cycle: clockwise=false — 2-bosqich CHAPDA, yoylar sweep=0 (teskari yo'nalish); mutatsiya: yo'nalish teskari bo'lsa qizaradi", () => {
  const l = layoutFigure(mk(4, { clockwise: false }))!;
  const c1 = center(node(l, 1));
  const c2 = center(node(l, 2));
  const c4 = center(node(l, 4));
  assert.ok(c2.x < c1.x - 30, "2-bosqich chapda");
  assert.ok(c4.x > c1.x + 30, "oxirgi bosqich o'ngda");
  for (const a of arcs(l)) {
    assert.equal(a.sweep, 0);
    assert.ok(arcSpan(a) < 0 && arcSpan(a) > -180);
  }
  // Soat yo'nalishida: 1 → 2 yoyi tepadan o'ngga tushadi (oxiri boshidan o'ngda va pastda).
  const cw = arcs(layoutFigure(mk(4))!)[0];
  const p0 = ellipsePt(cw.cx, cw.cy, cw.rx, cw.ry, cw.a0);
  const p1 = ellipsePt(cw.cx, cw.cy, cw.rx, cw.ry, cw.a1);
  assert.ok(p1.x > p0.x && p1.y > p0.y, "soat yo'nalishi: tepadan o'ngga pastga");
  const ccw = arcs(l)[0];
  const q0 = ellipsePt(ccw.cx, ccw.cy, ccw.rx, ccw.ry, ccw.a0);
  const q1 = ellipsePt(ccw.cx, ccw.cy, ccw.rx, ccw.ry, ccw.a1);
  assert.ok(q1.x < q0.x && q1.y > q0.y, "teskari: tepadan chapga pastga");
});

test("cycle: markaz yorlig'i — bloklarga tegmaydi, markazda; 8 bosqich (chegara) bo'ladi, 2 → null, 9 → 8 ga kesiladi", () => {
  const l = layoutFigure(mk(6, { center: "Uzluksiz yaxshilash sikli" }))!;
  const c = l.nodes.find((n) => n.id === "center");
  assert.ok(c);
  assert.equal(c.shape, "none");
  assert.equal(c.bold, true);
  assert.ok(Math.abs(c.x + c.w / 2 - l.w / 2) < 1, "markaz gorizontal o'rtada");
  for (const n of l.nodes) if (n.id !== "center") assert.ok(!overlaps(n, c), `markaz ${n.id} ga tegmaydi`);
  assert.equal(FIGURE_LIMITS.cycleMax, 8);
  assert.equal(FIGURE_LIMITS.cycleMin, 3);
  const l8 = layoutFigure(mk(8))!;
  assert.equal(l8.nodes.filter((n) => n.id.startsWith("c")).length, 8);
  assert.equal(arcs(l8).length, 8);
  assert.equal(layoutFigure(mk(2)), null);
  assert.equal(cycleSteps(mk(9) as Extract<FigureSpec, { kind: "cycle" }>)!.length, 8);
  // Satr ko'rinishidagi bosqich ham qabul (modelda `steps: ["a","b","c"]` kelishi mumkin).
  assert.deepEqual(cycleSteps({ kind: "cycle", steps: ["A", { label: "B" }, " ", "C"] as never }), ["A", "B", "C"]);
});

test("cycle: SVG — yoylar <path d=\"M… A…\"> marker-end bilan, bosqich matnlari, to'g'ri XML", () => {
  const svg = figureSvg(layoutFigure(mk(5, { center: "Markaz" }))!);
  const doc = new JSDOM(svg, { contentType: "image/svg+xml" }).window.document;
  const paths = [...doc.querySelectorAll("path[marker-end]")];
  assert.equal(paths.length, 5);
  for (const p of paths) {
    assert.match(p.getAttribute("d") ?? "", /^M[\d.,-]+ A[\d.,-]+ 0 0 1 [\d.,-]+$/);
    assert.equal(p.getAttribute("fill"), "none");
  }
  const text = [...doc.querySelectorAll("text")].map((t) => t.textContent ?? "").join(" ");
  for (let i = 1; i <= 5; i++) assert.ok(text.includes(`Bosqich ${i}`));
  assert.ok(text.includes("Markaz"));
  assert.equal(doc.querySelectorAll("rect[rx]").length, 5, "5 yumaloq blok");
});

test("cycle: figureSpecFromLlm — 3–8 bosqich, bo'sh tashlanadi, center/clockwise saqlanadi; fallback — oxirgi bosqich birinchisiga qaytadi", () => {
  const s = figureSpecFromLlm({ kind: "cycle", steps: [{ label: "A" }, { label: " " }, "B", { label: "C" }], center: "M", clockwise: false }, {});
  assert.deepEqual(s, { kind: "cycle", steps: [{ label: "A" }, { label: "B" }, { label: "C" }], center: "M", clockwise: false });
  assert.equal(figureSpecFromLlm({ kind: "cycle", steps: [{ label: "A" }, { label: "B" }] }, {}), null, "2 bosqich — sikl emas");
  const ten = figureSpecFromLlm({ kind: "cycle", steps: Array.from({ length: 10 }, (_, i) => ({ label: `S${i}` })) }, {});
  assert.ok(ten && ten.kind === "cycle" && ten.steps.length === 8);
  const t = figureSpecFromLlm({ kind: "cycle", steps: [{ label: "A" }, { label: "B" }, { label: "C" }], clockwise: true }, {});
  assert.ok(t && t.kind === "cycle" && !("clockwise" in t), "standart yo'nalish yozilmaydi");
  const li = figureFallbackBlocks({ id: "f", kind: "scheme", caption: "PDCA", spec: mk(3), w: 0, h: 0 }, "uz").filter((b) => b.kind === "li").map((b) => b.text);
  assert.deepEqual(li, ["Bosqich 1", "Bosqich 2", "Bosqich 3 → Bosqich 1"]);
});
