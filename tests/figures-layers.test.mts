import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { FIGURE_LIMITS, type FigureSpec } from "../lib/generation/article/types.ts";
import { CANVAS_W, layoutFigure, type FigureLayout } from "../lib/generation/figures/layout.ts";
import { LAYER_TITLE_FILL, layersData, layoutLayers } from "../lib/generation/figures/layout-layers.ts";
import { figureSvg } from "../lib/generation/figures/svg.ts";
import { figureFallbackBlocks } from "../lib/generation/figures/index.ts";
import { figureSpecFromLlm } from "../lib/generation/article/engine.ts";

/**
 * Maqola 3 (AUDIT-18) WP-B — QATLAMLI ARXITEKTURA (`layers`).
 *
 * Maket: qatlamlar yuqoridan pastga kirish tartibida (layers[0] eng tepada),
 * tasmalar butun kenglikda, bandlar tasma ichida va bir-biriga tegmaydi,
 * qatlamlar orasida ikki tomonlama o'q (`arrowStart`), kanvas ichida.
 * `figureSpecFromLlm`: 2–7 qatlam, ≤4 band, bo'sh yorliq tashlanadi.
 */

const SPEC: FigureSpec = {
  kind: "layers",
  layers: [
    { label: "Ilova", items: ["Veb", "Mobil"] },
    { label: "Xizmatlar", items: ["API", "Auth", "Tahlil"] },
    { label: "Ma’lumotlar", items: ["PostgreSQL"] },
    { label: "Fizik qatlam" },
  ],
};

function layer(l: FigureLayout, i: number) {
  const n = l.nodes.find((x) => x.id === `L${i}`);
  assert.ok(n, `qatlam L${i}`);
  return n;
}

function inCanvas(l: FigureLayout) {
  for (const n of l.nodes) assert.ok(n.x >= 0 && n.y >= 0 && n.x + n.w <= l.w + 0.5 && n.y + n.h <= l.h + 0.5, `tugun ${n.id} kanvas ichida`);
  for (const p of l.prims) if (p.k === "rect") assert.ok(p.x >= 0 && p.x + p.w <= l.w + 0.5 && p.y >= 0 && p.y + p.h <= l.h + 0.5, "tasma kanvas ichida");
}

test("layers: 4 qatlam yuqoridan pastga kirish tartibida, tasmalar butun kenglikda, kanvas 160 mm", () => {
  const l = layoutFigure(SPEC);
  assert.ok(l);
  assert.equal(l.kind, "layers");
  assert.equal(l.w, CANVAS_W);
  assert.equal(l.mm.w, 160);
  inCanvas(l);
  const ys = [0, 1, 2, 3].map((i) => layer(l, i).y);
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] > ys[i - 1] + 20, `qatlam ${i} oldingisidan pastda`);
  // Birinchi (ilova) TEPADA, oxirgi (fizik) PASTDA — mutatsiya: tartib teskari bo'lsa qizaradi.
  assert.ok(layer(l, 0).y < layer(l, 3).y);
  assert.equal(layer(l, 0).lines.join(" "), "Ilova");
  assert.equal(layer(l, 3).lines.join(" "), "Fizik qatlam");
  const bands = l.prims.filter((p) => p.k === "rect");
  assert.equal(bands.length, 4);
  for (const b of bands) if (b.k === "rect") assert.ok(Math.abs(b.w - (CANVAS_W - 20)) < 0.5, "tasma ichki kenglikda");
});

test("layers: bandlar tasma ichida, o'zaro tegmaydi, sarlavha katagi bo'yalgan; bandsiz qatlamda sarlavha markazda", () => {
  const l = layoutFigure(SPEC)!;
  const bands = l.prims.filter((p): p is Extract<typeof p, { k: "rect" }> => p.k === "rect");
  for (let i = 0; i < 4; i++) {
    const t = layer(l, i);
    assert.equal(t.fill, LAYER_TITLE_FILL, "sarlavha katagi bo'yalgan");
    assert.equal(t.bold, true);
    const items = l.nodes.filter((n) => n.id.startsWith(`L${i}i`));
    const band = bands[i];
    for (const it of items) {
      assert.ok(it.x >= t.x + t.w && it.x + it.w <= band.x + band.w + 0.5, `band ${it.id} sarlavhadan o'ngda va tasma ichida`);
      assert.ok(it.y >= band.y && it.y + it.h <= band.y + band.h + 0.5, `band ${it.id} tasma balandligida`);
      assert.equal(it.shape, "rounded");
    }
    for (let a = 0; a < items.length; a++) for (let b = a + 1; b < items.length; b++) assert.ok(items[a].x + items[a].w < items[b].x, "bandlar kesishmaydi");
  }
  assert.equal(l.nodes.filter((n) => n.id.startsWith("L1i")).length, 3);
  assert.equal(l.nodes.filter((n) => n.id.startsWith("L3i")).length, 0);
  // Hamma qatlam bandsiz — sarlavha tasma markazida (`none`, butun kenglik).
  const plain = layoutFigure({ kind: "layers", layers: [{ label: "A" }, { label: "B" }] })!;
  assert.equal(layer(plain, 0).shape, "none");
  assert.ok(Math.abs(layer(plain, 0).w - (CANVAS_W - 20)) < 0.5);
});

test("layers: qatlamlar orasida ikki tomonlama o'q (arrow + arrowStart), `arrows:false` — o'qsiz va zichroq", () => {
  const l = layoutFigure(SPEC)!;
  assert.equal(l.edges.length, 3);
  for (const e of l.edges) {
    assert.equal(e.arrow, true);
    assert.equal(e.arrowStart, true);
    assert.equal(e.points.length, 2);
    assert.ok(Math.abs(e.points[0].x - e.points[1].x) < 0.01, "vertikal");
    assert.ok(e.points[1].y - e.points[0].y > 15, "ko'rinadigan uzunlik");
  }
  // O'q oraliqda: oldingi tasma ostidan keyingi tasma tepasigacha.
  const e0 = l.edges[0];
  assert.ok(e0.points[0].y >= layer(l, 0).y + layer(l, 0).h && e0.points[1].y <= layer(l, 1).y);
  const plain = layoutFigure({ ...SPEC, arrows: false } as FigureSpec)!;
  assert.equal(plain.edges.length, 0);
  assert.ok(plain.h < l.h, "o'qsiz maket pastroq");
});

test("layers: 7 qatlam (chegara) bo'ladi, 1 qatlam → null, 8-qatlam kesiladi (layersData); balandlik qatlam soniga qarab", () => {
  const mk = (n: number): FigureSpec => ({ kind: "layers", layers: Array.from({ length: n }, (_, i) => ({ label: `Q${i + 1}`, items: ["a", "b"] })) });
  assert.equal(FIGURE_LIMITS.layersMax, 7);
  assert.equal(FIGURE_LIMITS.layersMin, 2);
  const l7 = layoutLayers(mk(7) as Extract<FigureSpec, { kind: "layers" }>)!;
  assert.equal(l7.prims.filter((p) => p.k === "rect").length, 7);
  assert.equal(layoutFigure(mk(1)), null);
  assert.equal(layersData(mk(8) as Extract<FigureSpec, { kind: "layers" }>)!.length, 7);
  assert.ok(layoutFigure(mk(3))!.h < layoutFigure(mk(6))!.h);
  // 5 band → 4 ga kesiladi; bo'sh yorliq tashlanadi.
  const d = layersData({ kind: "layers", layers: [{ label: "A", items: ["1", "2", "3", "4", "5"] }, { label: "  " }, { label: "B" }] })!;
  assert.equal(d.length, 2);
  assert.equal(d[0].items.length, FIGURE_LIMITS.layerItems);
  assert.equal(layoutFigure({ kind: "layers", layers: [] as never }), null);
});

test("layers: SVG — ikkala uch (marker-end + marker-start arrow-rev), barcha yorliqlar matnda, to'g'ri XML", () => {
  const svg = figureSvg(layoutFigure(SPEC)!);
  const doc = new JSDOM(svg, { contentType: "image/svg+xml" }).window.document;
  assert.ok(doc.querySelector("defs > marker#arrow-rev"), "teskari marker aniqlangan");
  const two = [...doc.querySelectorAll("polyline[marker-start]")];
  assert.equal(two.length, 3);
  assert.ok(two.every((p) => p.getAttribute("marker-start") === "url(#arrow-rev)" && p.getAttribute("marker-end") === "url(#arrow)"));
  const text = [...doc.querySelectorAll("text")].map((t) => t.textContent ?? "").join(" ");
  for (const s of ["Ilova", "Veb", "Mobil", "Xizmatlar", "API", "PostgreSQL", "Fizik qatlam"]) assert.ok(text.includes(s), `«${s}» SVG'da`);
  assert.equal([...doc.querySelectorAll("rect")].filter((r) => r.getAttribute("fill") === LAYER_TITLE_FILL).length, 4, "4 bo'yalgan sarlavha");
});

test("layers: figureSpecFromLlm — 2–7 qatlam, ≤4 band, bo'sh yorliq tashlanadi, arrows:false saqlanadi; fallback ro'yxati yuqoridan pastga", () => {
  const raw = { kind: "layers", layers: [{ label: "A", items: ["1", "2", "3", "4", "5", ""] }, { label: "" }, { label: "B" }, { label: "C", items: "x" }], arrows: false };
  const s = figureSpecFromLlm(raw, {});
  assert.ok(s && s.kind === "layers");
  assert.equal(s.layers.length, 3);
  assert.deepEqual(s.layers[0], { label: "A", items: ["1", "2", "3", "4"] });
  assert.deepEqual(s.layers[2], { label: "C" });
  assert.equal(s.arrows, false);
  assert.equal(figureSpecFromLlm({ kind: "layers", layers: [{ label: "A" }] }, {}), null, "1 qatlam — sxema emas");
  const nine = figureSpecFromLlm({ kind: "layers", layers: Array.from({ length: 9 }, (_, i) => ({ label: `L${i}` })) }, {});
  assert.ok(nine && nine.kind === "layers" && nine.layers.length === 7, "9 → 7 ga kesiladi");
  const li = figureFallbackBlocks({ id: "f", kind: "scheme", caption: "Arxitektura", spec: SPEC, w: 0, h: 0 }, "uz");
  assert.deepEqual(li[0], { kind: "p", text: "Arxitektura:" });
  assert.deepEqual(
    li.filter((b) => b.kind === "li").map((b) => b.text),
    ["Ilova: Veb, Mobil", "Xizmatlar: API, Auth, Tahlil", "Ma’lumotlar: PostgreSQL", "Fizik qatlam"],
  );
});
