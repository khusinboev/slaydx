import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import type { Figure, FigureSpec } from "../lib/generation/article/types.ts";
import { layoutFigure } from "../lib/generation/figures/layout.ts";
import { arcPoints } from "../lib/generation/figures/model.ts";
import { figureSvg } from "../lib/generation/figures/svg.ts";
import { figurePng, svgWidthPx, targetWidthPx } from "../lib/generation/figures/png.ts";
import { buildFigure, figureFallbackBlocks, noDataLabel } from "../lib/generation/figures/index.ts";

/**
 * Maqola 2 (AUDIT-17) WP3 — HAQIQIY `sharp`: PNG imzosi, 1890 px @ 160 mm /
 * 300 dpi, matn/chiziqlar chizilgani (oq bo'lmagan piksel ulushi), va
 * `buildFigure` shartnomasi (`url` data PNG / `fallbackBlocks`).
 *
 * `scripts/heavy.sh` ostida yurgiziladi (libvips ~100–200 MB).
 */

const FLOW: FigureSpec = {
  kind: "flow",
  direction: "TB",
  nodes: [
    { id: "a", label: "Boshlash", kind: "start" },
    { id: "b", label: "Ma’lumot yig‘ish", kind: "data" },
    { id: "c", label: "Tahlil" },
    { id: "d", label: "Yakun", kind: "end" },
  ],
  edges: [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
    { from: "c", to: "d" },
  ],
};

async function darkShare(png: Buffer): Promise<number> {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  let dark = 0;
  for (let i = 0; i < data.length; i += info.channels) if (data[i] < 200 || data[i + 1] < 200 || data[i + 2] < 200) dark++;
  return dark / (info.width * info.height);
}

test("png: 160 mm @ 300 dpi = 1890 px; PNG imzosi; balandlik nisbat bilan; alfa yo'q", async () => {
  assert.equal(targetWidthPx(160, 300), 1890);
  assert.equal(targetWidthPx(), 1890);
  const l = layoutFigure(FLOW)!;
  const svg = figureSvg(l);
  const out = await figurePng(svg);
  assert.ok(out);
  assert.deepEqual([...out.png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "PNG imzosi");
  assert.equal(out.w, 1890);
  const meta = await sharp(out.png).metadata();
  assert.equal(meta.width, 1890);
  assert.equal(meta.format, "png");
  assert.equal(meta.hasAlpha, false);
  const expectH = Math.round((l.h / svgWidthPx(svg)!) * 1890);
  assert.ok(Math.abs(meta.height! - expectH) <= 2, `balandlik ${meta.height} ≈ ${expectH}`);
  assert.equal(out.h, meta.height);
  assert.ok(out.png.length < 400 * 1024, `hajm ${Math.round(out.png.length / 1024)} KB < 400 KB`);
});

test("png: matn va chiziqlar haqiqatan chiziladi — oq bo'lmagan piksel ulushi >1%", async () => {
  const out = (await figurePng(figureSvg(layoutFigure(FLOW)!)))!;
  const share = await darkShare(out.png);
  assert.ok(share > 0.01, `qora ulush ${(share * 100).toFixed(2)}% > 1%`);
  assert.ok(share < 0.5, "asosan oq fon");
  // Bo'sh maket (matnsiz) — deyarli oq.
  const blank = (await figurePng(figureSvg({ kind: "flow", w: 605, h: 100, fontSize: 14, nodes: [], edges: [], texts: [], prims: [], patterns: [], mm: { w: 160, h: 26 } })))!;
  assert.ok((await darkShare(blank.png)) < 0.001);
});

test("png (AUDIT-18): cycle — yoy o'qlar va matn haqiqatan chiziladi (sharp), 1890 px, taxminan kvadrat; buildFigure url beradi", async () => {
  const cycle: FigureSpec = { kind: "cycle", center: "Sikl", steps: [{ label: "Reja" }, { label: "Bajarish" }, { label: "Tekshirish" }, { label: "Tuzatish" }] };
  const l = layoutFigure(cycle)!;
  const out = (await figurePng(figureSvg(l)))!;
  assert.equal(out.w, 1890);
  assert.ok(out.h > 500 && out.h <= 1890, `balandlik ${out.h}`);
  const share = await darkShare(out.png);
  assert.ok(share > 0.005 && share < 0.3, `qora ulush ${(share * 100).toFixed(2)}%`);
  // Yoy o'qi haqiqatan chizilgan: har yoyning o'rta nuqtasi atrofida (±4 px @300 dpi) qora piksel bor.
  const { data, info } = await sharp(out.png).raw().toBuffer({ resolveWithObject: true });
  const k = 1890 / l.w;
  const arcs = l.prims.filter((p): p is Extract<typeof p, { k: "arc" }> => p.k === "arc");
  assert.equal(arcs.length, 4);
  for (const a of arcs) {
    const mid = arcPoints(a, 2)[1];
    const cx = Math.round(mid.x * k);
    const cy = Math.round(mid.y * k);
    let dark = 0;
    for (let y = cy - 4; y <= cy + 4; y++) for (let x = cx - 4; x <= cx + 4; x++) if (data[(y * info.width + x) * info.channels] < 128) dark++;
    assert.ok(dark >= 3, `yoy o'rtasida (${cx},${cy}) qora piksel: ${dark}`);
  }
  const built = await buildFigure({ id: "f9", kind: "scheme", caption: "Sikl", spec: cycle, w: 0, h: 0 }, { lang: "uz" });
  assert.ok(built.url?.startsWith("data:image/png;base64,"));
  assert.equal(built.fallbackBlocks, undefined);
});

test("png: dpi/kenglik opsiyalari; buzuq SVG → null", async () => {
  const svg = figureSvg(layoutFigure({ kind: "process", steps: ["A", "B"] })!);
  const small = (await figurePng(svg, { widthMm: 80, dpi: 150 }))!;
  assert.equal(small.w, Math.round((80 / 25.4) * 150));
  assert.equal(await figurePng("<svg xmlns='http://www.w3.org/2000/svg'><rect"), null);
  assert.equal(await figurePng("hech narsa"), null);
  assert.equal(svgWidthPx("<svg></svg>"), null);
});

test("buildFigure: url = data:image/png;base64, w=1890, fallback yo'q; kirish o'zgarmaydi", async () => {
  const fig: Figure = { id: "f1", kind: "scheme", caption: "Sxema", spec: FLOW, w: 0, h: 0, fallbackBlocks: [{ kind: "p", text: "eski" }] };
  const snapshot = JSON.stringify(fig);
  const out = await buildFigure(fig, { lang: "uz" });
  assert.equal(JSON.stringify(fig), snapshot, "kirish mutatsiya qilinmadi");
  assert.ok(out.url?.startsWith("data:image/png;base64,"));
  assert.equal(out.w, 1890);
  assert.ok(out.h > 100);
  assert.equal(out.fallbackBlocks, undefined, "muvaffaqiyatda eski fallback olib tashlanadi");
  const bytes = Buffer.from(out.url!.slice("data:image/png;base64,".length), "base64");
  assert.equal((await sharp(bytes).metadata()).width, 1890);
});

test("buildFigure: sikl → url yo'q, fallbackBlocks raqamli ro'yxat «A → B», w/h=0", async () => {
  const cyc: FigureSpec = {
    kind: "flow",
    direction: "TB",
    nodes: [
      { id: "a", label: "Alfa" },
      { id: "b", label: "Beta" },
      { id: "c", label: "Yolg‘iz" },
    ],
    edges: [
      { from: "a", to: "b", label: "keyin" },
      { from: "b", to: "a" },
    ],
  };
  const out = await buildFigure({ id: "f2", kind: "scheme", caption: "Sikl", spec: cyc, w: 1, h: 1, url: "data:old", assetId: "x" }, { lang: "uz" });
  assert.equal(out.url, undefined);
  assert.equal(out.assetId, undefined);
  assert.equal(out.w, 0);
  assert.equal(out.h, 0);
  assert.ok(out.fallbackBlocks && out.fallbackBlocks.length >= 3);
  assert.deepEqual(out.fallbackBlocks[0], { kind: "p", text: "Sikl:" });
  const items = out.fallbackBlocks.filter((b) => b.kind === "li").map((b) => b.text);
  assert.deepEqual(items, ["Alfa → Beta (keyin)", "Beta → Alfa", "Yolg‘iz"]);
});

test("buildFigure: chart dataSource ≠ user → fallback + source «Ma’lumot berilmagan», RAQAM CHIQMAYDI", async () => {
  const spec = { kind: "chart", chart: "bar", dataSource: "model", series: [{ name: "S", values: [12, 34] }], categories: ["A", "B"] } as unknown as FigureSpec;
  const out = await buildFigure({ id: "f3", kind: "chart", caption: "Grafik", spec, w: 0, h: 0 }, { lang: "uz" });
  assert.equal(out.url, undefined);
  assert.equal(out.source, "Ma’lumot berilmagan");
  assert.equal(noDataLabel("uz"), "Ma’lumot berilmagan");
  assert.equal(noDataLabel("en"), "Data not provided");
  const text = (out.fallbackBlocks ?? []).map((b) => b.text).join(" ");
  assert.ok(text.includes("Ma’lumot berilmagan"));
  assert.ok(text.includes("A") && text.includes("B"), "kategoriyalar bor");
  assert.ok(!/\b12\b|\b34\b/.test(text), "uydirma raqamlar chiqmaydi");
  // dataSource umuman yo'q — ham fallback.
  const noSrc = { kind: "chart", chart: "bar", series: [{ name: "S", values: [1] }], categories: ["A"] } as unknown as FigureSpec;
  const out2 = await buildFigure({ id: "f4", kind: "chart", caption: "G", spec: noSrc, w: 0, h: 0 }, { lang: "ru" });
  assert.equal(out2.source, "Данные не предоставлены");
  assert.equal(out2.url, undefined);
});

test("buildFigure: chart user → PNG; fallback matni process/tree/prisma/chart uchun", async () => {
  const chart: FigureSpec = { kind: "chart", chart: "pie", dataSource: "user", series: [{ name: "S", values: [3, 1] }], categories: ["A", "B"] };
  const out = await buildFigure({ id: "f5", kind: "chart", caption: "Pie", spec: chart, w: 0, h: 0 }, { lang: "uz" });
  assert.ok(out.url?.startsWith("data:image/png;base64,"));
  assert.equal(out.source, undefined, "user manbasida source qo'shilmaydi");
  const li = (f: Figure) => figureFallbackBlocks(f, "uz").filter((b) => b.kind === "li").map((b) => b.text);
  assert.deepEqual(li({ id: "p", kind: "scheme", caption: "", spec: { kind: "process", steps: ["Bir", "Ikki"] }, w: 0, h: 0 }), ["Bir", "Ikki"]);
  assert.deepEqual(li({ id: "t", kind: "scheme", caption: "", spec: { kind: "tree", root: "R", children: [{ label: "A", children: [{ label: "A1" }] }, { label: "B" }] }, w: 0, h: 0 }), ["R", "– A", "– – A1", "– B"]);
  const pr = li({ id: "pr", kind: "scheme", caption: "", spec: { kind: "prisma", identified: 10, screened: 8, excludedScreen: 3, eligible: 5, excludedElig: 1, included: 4 }, w: 0, h: 0 });
  assert.equal(pr.length, 4);
  assert.match(pr[0], /Identifikatsiya.*\(n = 10\)/);
  assert.match(pr[3], /Kiritilgan.*\(n = 4\)/);
  assert.deepEqual(li({ id: "c", kind: "chart", caption: "", spec: chart, w: 0, h: 0 }), ["A: 3", "B: 1"]);
  // Sarlavha bo'lsa — birinchi blok «Sarlavha:».
  assert.deepEqual(figureFallbackBlocks({ id: "p", kind: "scheme", caption: "Bosqichlar", spec: { kind: "process", steps: ["X"] }, w: 0, h: 0 }, "uz")[0], { kind: "p", text: "Bosqichlar:" });
});
