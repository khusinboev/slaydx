import test from "node:test";
import assert from "node:assert/strict";
import { ARTICLE_LIMITS, type FigureSpec } from "../lib/generation/article/types.ts";
import { CANVAS_W, TREE_MAX_DEPTH, flowGraph, layoutFigure, nodeTextWidth, wrapLabel, type FigureLayout, type LayoutNode } from "../lib/generation/figures/layout.ts";
import { prismaLabels } from "../lib/generation/figures/prisma.ts";

/**
 * Maqola 2 (AUDIT-17) WP3 — sxema maketi (`layoutFigure`).
 *
 * DOM yo'q: rank/tartib/pozitsiya/qirra — sof hisob. Chegara (>14 tugun,
 * >24 qirra, sikl, chuqurlik >4) → `null`, chaqiruvchi fallback beradi.
 */

function chain(n: number, direction: "TB" | "LR" = "TB", kinds: Record<number, "start" | "end" | "decision" | "data"> = {}): FigureSpec {
  const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}`, label: `Qadam ${i + 1}`, ...(kinds[i] ? { kind: kinds[i] } : {}) }));
  const edges = Array.from({ length: n - 1 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}` }));
  return { kind: "flow", direction, nodes, edges };
}

function byId(l: FigureLayout, id: string): LayoutNode {
  const n = l.nodes.find((x) => x.id === id);
  assert.ok(n, `tugun ${id}`);
  return n;
}

function overlaps(a: LayoutNode, b: LayoutNode): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/* ── flow: rank ── */

test("flow TB: zanjir ranklari yuqoridan pastga, kanvas 160 mm", () => {
  const l = layoutFigure(chain(4));
  assert.ok(l);
  assert.equal(l.kind, "flow");
  assert.equal(l.w, CANVAS_W);
  assert.equal(l.mm.w, 160);
  const ys = ["n0", "n1", "n2", "n3"].map((id) => byId(l, id).y);
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] > ys[i - 1] + 20, `rank ${i} pastroq`);
  // Zanjir — hamma bitta ustunda (median tekislash).
  const cx = l.nodes.map((n) => n.x + n.w / 2);
  assert.ok(Math.max(...cx) - Math.min(...cx) < 1, "zanjir tekis ustun");
  assert.equal(l.edges.length, 3);
  for (const e of l.edges) assert.equal(e.arrow, true);
});

test("flow LR: ranklar chapdan o'ngga, balandlik kichik", () => {
  const l = layoutFigure(chain(4, "LR"));
  assert.ok(l);
  const xs = ["n0", "n1", "n2", "n3"].map((id) => byId(l, id).x);
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] > xs[i - 1] + 20);
  const tb = layoutFigure(chain(4, "TB"))!;
  assert.ok(l.h < tb.h / 2, `LR balandligi (${l.h}) TB dan (${tb.h}) ancha kichik`);
  assert.ok(l.mm.h < 60);
});

test("flow: eng uzun yo'l ranki — a→c to'g'ridan-to'g'ri qirra c ni b dan pastda qoldiradi", () => {
  const spec: FigureSpec = {
    kind: "flow",
    direction: "TB",
    nodes: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
      { id: "c", label: "C" },
    ],
    edges: [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
      { from: "a", to: "c" },
    ],
  };
  const l = layoutFigure(spec)!;
  assert.ok(byId(l, "c").y > byId(l, "b").y + 20);
  // Uzun qirra a→c: nuqtalari b tugunini kesib o'tmaydi (virtual koridor).
  const ac = l.edges.find((e) => e.from === "a" && e.to === "c")!;
  const b = byId(l, "b");
  for (const p of ac.points) {
    const inside = p.x > b.x && p.x < b.x + b.w && p.y > b.y && p.y < b.y + b.h;
    assert.ok(!inside, "uzun qirra tugun ichidan o'tmaydi");
  }
  assert.ok(ac.points.length >= 4, "uzun qirra ortogonal burilishlar bilan");
});

test("flow: sikl → null (a→b→a), o'z-o'ziga qirra → null", () => {
  const cyc: FigureSpec = {
    kind: "flow",
    direction: "TB",
    nodes: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ],
    edges: [
      { from: "a", to: "b" },
      { from: "b", to: "a" },
    ],
  };
  assert.equal(layoutFigure(cyc), null);
  assert.equal(flowGraph(cyc), null);
  const self: FigureSpec = { kind: "flow", direction: "TB", nodes: [{ id: "a", label: "A" }], edges: [{ from: "a", to: "a" }] };
  assert.equal(layoutFigure(self), null);
  // Katta sikl (3 tugun) ham.
  const cyc3: FigureSpec = {
    kind: "flow",
    direction: "TB",
    nodes: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
      { id: "c", label: "C" },
    ],
    edges: [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
      { from: "c", to: "a" },
    ],
  };
  assert.equal(layoutFigure(cyc3), null);
});

test("flow: chegaralar — 14 tugun bo'ladi, 15 → null; 24 qirra bo'ladi, 25 → null", () => {
  assert.equal(ARTICLE_LIMITS.figureNodes, 14);
  assert.equal(ARTICLE_LIMITS.figureEdges, 24);
  assert.ok(layoutFigure(chain(14)));
  assert.equal(layoutFigure(chain(15)), null);
  // 7 tugun, ikki qatlam: 24 qirra (to'liq ikki tomonlama 4×6) — bo'ladi; 25 → null.
  const mk = (edgeCount: number): FigureSpec => {
    const nodes = [...Array.from({ length: 4 }, (_, i) => ({ id: `s${i}`, label: `S${i}` })), ...Array.from({ length: 7 }, (_, i) => ({ id: `t${i}`, label: `T${i}` }))];
    const edges: { from: string; to: string }[] = [];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 7; j++) if (edges.length < edgeCount) edges.push({ from: `s${i}`, to: `t${j}` });
    return { kind: "flow", direction: "TB", nodes, edges };
  };
  assert.ok(layoutFigure(mk(24)));
  assert.equal(layoutFigure(mk(25)), null);
});

test("flow: bo'sh/buzuq kirish → null; noma'lum uchli qirra tashlab ketiladi; takror id birlashadi", () => {
  assert.equal(layoutFigure({ kind: "flow", direction: "TB", nodes: [], edges: [] }), null);
  assert.equal(layoutFigure({ kind: "nope" } as unknown as FigureSpec), null);
  assert.equal(layoutFigure(null as unknown as FigureSpec), null);
  const l = layoutFigure({
    kind: "flow",
    direction: "TB",
    nodes: [
      { id: "a", label: "A" },
      { id: "a", label: "A2" },
      { id: "b", label: "B" },
    ],
    edges: [
      { from: "a", to: "b" },
      { from: "a", to: "zzz" },
    ],
  })!;
  assert.equal(l.nodes.length, 2);
  assert.equal(l.edges.length, 1);
});

/* ── flow: shakllar, matn, joylashuv ── */

test("flow: decision → romb, start/end → yumaloq, data → parallelogramm, oddiy → to'rtburchak", () => {
  const l = layoutFigure(chain(4, "TB", { 0: "start", 1: "data", 2: "decision", 3: "end" }))!;
  assert.equal(byId(l, "n0").shape, "rounded");
  assert.equal(byId(l, "n1").shape, "parallelogram");
  assert.equal(byId(l, "n2").shape, "diamond");
  assert.equal(byId(l, "n3").shape, "rounded");
  // Romb matn uchun kengroq: tw/W + th/H ≤ 1 sharti.
  const d = byId(l, "n2");
  const tw = nodeTextWidth(d);
  const th = d.lines.length * (d.size ?? l.fontSize) * 1.25;
  assert.ok(tw / d.w + th / d.h <= 1, "matn romb ichida");
});

test("flow: matn o'rash — ≤2 qator, ≤22 belgi; matn kengligi tugun ichida", () => {
  const long = "Ma’lumotlarni oldindan qayta ishlash va normallashtirish bosqichi";
  const lines = wrapLabel(long);
  assert.ok(lines.length <= 2);
  assert.ok(lines.every((s) => s.length <= Math.ceil(22 * 1.35)));
  assert.ok(lines[lines.length - 1].endsWith("…"), "sig'magan matn «…» bilan");
  assert.deepEqual(wrapLabel("Qisqa"), ["Qisqa"]);
  assert.deepEqual(wrapLabel("Talaba faoliyati ma’lumotlari"), ["Talaba faoliyati", "ma’lumotlari"]);
  // 13 belgili so'z 12 chegarada BO'LINMAYDI (butun qoladi).
  assert.deepEqual(wrapLabel("Foydalanuvchi", 12, 3), ["Foydalanuvchi"]);
  // Juda uzun so'z (URL kabi) qattiq bo'linadi.
  assert.ok(wrapLabel("a".repeat(40), 12, 3).length >= 2);
  assert.deepEqual(wrapLabel("   "), [""]);
  const l = layoutFigure({
    kind: "flow",
    direction: "TB",
    nodes: [
      { id: "a", label: long },
      { id: "b", label: "B" },
    ],
    edges: [{ from: "a", to: "b" }],
  })!;
  for (const n of l.nodes) assert.ok(nodeTextWidth(n) <= n.w, `matn tugunga sig'adi: ${n.id}`);
});

test("flow: bitta qatlamdagi tugunlar ustma-ust tushmaydi; keng qatlam kanvasga sig'adi (masshtab)", () => {
  const nodes = [{ id: "root", label: "Boshlang'ich holat" }, ...Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, label: `Tarmoq ${i + 1} natijasi` }))];
  const edges = Array.from({ length: 6 }, (_, i) => ({ from: "root", to: `c${i}` }));
  const l = layoutFigure({ kind: "flow", direction: "TB", nodes, edges })!;
  for (let i = 0; i < l.nodes.length; i++) for (let j = i + 1; j < l.nodes.length; j++) assert.ok(!overlaps(l.nodes[i], l.nodes[j]), `${l.nodes[i].id} × ${l.nodes[j].id}`);
  for (const n of l.nodes) {
    assert.ok(n.x >= 0 && n.x + n.w <= l.w + 0.01, "kanvas ichida (x)");
    assert.ok(n.y >= 0 && n.y + n.h <= l.h + 0.01, "kanvas ichida (y)");
  }
  assert.ok(l.fontSize < 14.67, "keng qatlam — shrift kichraytirildi");
  assert.ok(l.fontSize > 7, "lekin o'qiladigan darajada");
});

test("flow: qirra manba tubidan chiqib maqsad tepasiga kiradi (TB) / o'ng→chap (LR); yorliq joylashadi", () => {
  const spec: FigureSpec = {
    kind: "flow",
    direction: "TB",
    nodes: [
      { id: "a", label: "A", kind: "decision" },
      { id: "b", label: "B" },
      { id: "c", label: "C" },
    ],
    edges: [
      { from: "a", to: "b", label: "Ha" },
      { from: "a", to: "c", label: "Yo‘q" },
    ],
  };
  const l = layoutFigure(spec)!;
  const a = byId(l, "a");
  const b = byId(l, "b");
  const ab = l.edges.find((e) => e.to === "b")!;
  const first = ab.points[0];
  const last = ab.points[ab.points.length - 1];
  assert.ok(Math.abs(first.x - (a.x + a.w / 2)) < 0.5 && Math.abs(first.y - (a.y + a.h)) < 0.5, "chiqish — manba tubi markazi");
  assert.ok(Math.abs(last.x - (b.x + b.w / 2)) < 0.5 && Math.abs(last.y - b.y) < 0.5, "kirish — maqsad tepasi markazi");
  assert.equal(ab.label, "Ha");
  assert.ok(ab.labelAt && ab.labelAt.y > a.y + a.h && ab.labelAt.y < b.y, "yorliq qatlamlar orasida");
  const lr = layoutFigure({ ...spec, direction: "LR" })!;
  const a2 = byId(lr, "a");
  const e2 = lr.edges[0];
  assert.ok(Math.abs(e2.points[0].x - (a2.x + a2.w)) < 0.5, "LR: chiqish — o'ng chekka");
});

/* ── process ── */

test("process: ≤5 qadam gorizontal (bitta qator), raqamli badge, o'qlar", () => {
  const l = layoutFigure({ kind: "process", steps: ["Bir", "Ikki", "Uch", "To‘rt", "Besh"] })!;
  assert.equal(l.kind, "process");
  assert.equal(l.nodes.length, 5);
  assert.deepEqual(
    l.nodes.map((n) => n.badge),
    ["1", "2", "3", "4", "5"],
  );
  const ys = new Set(l.nodes.map((n) => Math.round(n.y)));
  assert.equal(ys.size, 1, "hammasi bitta qatorda");
  const xs = l.nodes.map((n) => n.x);
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] > xs[i - 1]);
  assert.equal(l.edges.length, 4);
  assert.ok(l.edges.every((e) => e.arrow));
  assert.ok(l.h < 120, `gorizontal — past (${l.h})`);
});

test("process: >5 qadam vertikal (bitta ustun), tartib saqlanadi; 15 qadam → null; bo'sh → null", () => {
  const steps = Array.from({ length: 6 }, (_, i) => `Qadam ${i + 1}`);
  const l = layoutFigure({ kind: "process", steps })!;
  assert.equal(l.nodes.length, 6);
  const xs = new Set(l.nodes.map((n) => Math.round(n.x)));
  assert.equal(xs.size, 1, "bitta ustun");
  for (let i = 1; i < l.nodes.length; i++) assert.ok(l.nodes[i].y > l.nodes[i - 1].y + l.nodes[i - 1].h);
  assert.equal(l.nodes[5].lines[0], "Qadam 6");
  assert.equal(layoutFigure({ kind: "process", steps: Array.from({ length: 15 }, (_, i) => `Q${i}`) }), null);
  assert.equal(layoutFigure({ kind: "process", steps: [] }), null);
  assert.equal(layoutFigure({ kind: "process", steps: ["", "  "] }), null);
  // Bo'sh qadamlar tashlab ketiladi.
  assert.equal(layoutFigure({ kind: "process", steps: ["A", "", "B"] })!.nodes.length, 2);
});

/* ── tree ── */

test("tree: 3 daraja yuqoridan pastga, ota bolalar o'rtasida, qirralar o'qsiz", () => {
  const l = layoutFigure({
    kind: "tree",
    root: "Ildiz",
    children: [
      { label: "Bir", children: [{ label: "Bir.1" }, { label: "Bir.2" }] },
      { label: "Ikki", children: [{ label: "Ikki.1" }] },
      { label: "Uch" },
    ],
  })!;
  assert.equal(l.kind, "tree");
  assert.equal(l.nodes.length, 7);
  const root = l.nodes.find((n) => n.lines[0] === "Ildiz")!;
  const bir = l.nodes.find((n) => n.lines[0] === "Bir")!;
  const bir1 = l.nodes.find((n) => n.lines[0] === "Bir.1")!;
  const bir2 = l.nodes.find((n) => n.lines[0] === "Bir.2")!;
  assert.ok(root.bold, "ildiz qalin");
  assert.ok(root.y < bir.y && bir.y < bir1.y, "darajalar pastga");
  const mid = (bir1.x + bir1.w / 2 + bir2.x + bir2.w / 2) / 2;
  assert.ok(Math.abs(bir.x + bir.w / 2 - mid) < 1, "ota bolalar o'rtasida");
  assert.equal(l.edges.length, 6);
  assert.ok(l.edges.every((e) => !e.arrow), "daraxtda o'q uchi yo'q");
  for (let i = 0; i < l.nodes.length; i++) for (let j = i + 1; j < l.nodes.length; j++) assert.ok(!overlaps(l.nodes[i], l.nodes[j]));
  // Bir darajadagi tugunlar bir xil balandlikda.
  assert.equal(bir1.h, bir2.h);
});

test("tree: chuqurlik >4 → null, 15 tugun → null, bo'sh ildiz → null", () => {
  assert.equal(TREE_MAX_DEPTH, 4);
  const deep: FigureSpec = { kind: "tree", root: "0", children: [{ label: "1", children: [{ label: "2", children: [{ label: "3", children: [{ label: "4" }] }] }] }] };
  assert.equal(layoutFigure(deep), null);
  const ok: FigureSpec = { kind: "tree", root: "0", children: [{ label: "1", children: [{ label: "2", children: [{ label: "3" }] }] }] };
  assert.ok(layoutFigure(ok));
  const wide: FigureSpec = { kind: "tree", root: "R", children: Array.from({ length: 14 }, (_, i) => ({ label: `L${i}` })) };
  assert.equal(layoutFigure(wide), null);
  assert.ok(layoutFigure({ kind: "tree", root: "R", children: Array.from({ length: 13 }, (_, i) => ({ label: `L${i}` })) }));
  assert.equal(layoutFigure({ kind: "tree", root: "  ", children: [] }), null);
});

test("tree: ko'p barg — osilgan rejim yoki masshtab, lekin ustma-ust emas va o'qiladi", () => {
  const l = layoutFigure({
    kind: "tree",
    root: "Tasnif",
    children: [
      { label: "A guruh", children: Array.from({ length: 5 }, (_, i) => ({ label: `A turdagi element ${i + 1}` })) },
      { label: "B guruh", children: Array.from({ length: 5 }, (_, i) => ({ label: `B turdagi element ${i + 1}` })) },
    ],
  })!;
  assert.equal(l.nodes.length, 13);
  for (let i = 0; i < l.nodes.length; i++) for (let j = i + 1; j < l.nodes.length; j++) assert.ok(!overlaps(l.nodes[i], l.nodes[j]));
  assert.ok(l.fontSize >= 9, `shrift o'qiladi (${l.fontSize.toFixed(1)} px)`);
  for (const n of l.nodes) assert.ok(nodeTextWidth(n) <= n.w + 0.01);
});

/* ── prisma ── */

test("prisma: 4 asosiy qator pastga, chetlashtirilganlar o'ngda, raqamlar «(n = …)» matnda", () => {
  const spec: FigureSpec = { kind: "prisma", identified: 1245, screened: 987, excludedScreen: 812, eligible: 175, excludedElig: 143, included: 32, sources: "Scopus, WoS" };
  const l = layoutFigure(spec, { lang: "uz" })!;
  assert.equal(l.kind, "prisma");
  const main = ["p1", "p2", "p3", "p4"].map((id) => byId(l, id));
  for (let i = 1; i < 4; i++) assert.ok(main[i].y > main[i - 1].y + main[i - 1].h, "qatorlar pastga");
  const xs = new Set(main.map((n) => Math.round(n.x)));
  assert.equal(xs.size, 1, "asosiy ustun tekis");
  const nums = (n: LayoutNode) => n.lines.join(" ").replace(/ /g, " ");
  assert.match(nums(main[0]), /\(n = 1245\)/);
  assert.match(nums(main[0]), /Scopus, WoS/);
  assert.match(nums(main[1]), /\(n = 987\)/);
  assert.match(nums(main[2]), /\(n = 175\)/);
  assert.match(nums(main[3]), /\(n = 32\)/);
  const ex2 = byId(l, "p2x");
  const ex3 = byId(l, "p3x");
  assert.ok(ex2.x > main[1].x + main[1].w, "chetlashtirilgan o'ngda");
  assert.match(nums(ex2), /\(n = 812\)/);
  assert.match(nums(ex3), /\(n = 143\)/);
  assert.ok(!byId(l, "p1") || !l.nodes.find((n) => n.id === "p1x"), "1-qatorda chetlashtirilgan yo'q");
  assert.ok(!l.nodes.find((n) => n.id === "p4x"));
  // Bosqich yorliqlari — burilgan matn, uz.
  const stages = l.texts.filter((t) => t.rotate === -90).map((t) => t.text);
  assert.deepEqual(stages, [...prismaLabels("uz").stages]);
  assert.equal(l.edges.length, 5, "3 pastga + 2 o'ngga");
  assert.ok(l.edges.every((e) => e.arrow));
});

test("prisma: yorliqlar ru/en; buzuq raqam (manfiy, kasr, tartib) → null", () => {
  const base = { kind: "prisma" as const, identified: 100, screened: 80, excludedScreen: 50, eligible: 30, excludedElig: 10, included: 20 };
  const ru = layoutFigure(base, { lang: "ru" })!;
  assert.ok(ru.texts.some((t) => t.text === "Скрининг"));
  assert.ok(byId(ru, "p4").lines.join(" ").includes("обзор"));
  const en = layoutFigure(base, { lang: "en" })!;
  assert.ok(en.texts.some((t) => t.text === "Eligibility"));
  assert.equal(layoutFigure({ ...base, included: -1 }), null);
  assert.equal(layoutFigure({ ...base, screened: 80.5 }), null);
  assert.equal(layoutFigure({ ...base, screened: 120 }), null, "screened > identified");
  assert.equal(layoutFigure({ ...base, included: 40 }), null, "included > eligible");
  assert.equal(layoutFigure({ ...base, identified: Number.NaN }), null);
  assert.equal(layoutFigure({ ...base, identified: "abc" as unknown as number }), null);
});
