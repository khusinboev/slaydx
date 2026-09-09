import test from "node:test";
import assert from "node:assert/strict";
import { applyDocOps, inverseOps, parseDocOps, sanitizeSlideModel, FONT_MIN, FONT_MAX } from "../lib/generation/slide-edit.ts";
import { planSlide } from "../lib/generation/slide-layout.ts";
import { getSlideTheme } from "../lib/generation/slide-themes.ts";
import { bodyRules } from "../lib/generation/slide-audience.ts";
import { TOOL_BY_ID } from "../lib/tools.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import type { AcademicDoc } from "../lib/generation/types.ts";
import type { SlideModel } from "../lib/generation/slide-types.ts";

/**
 * Shrift o'lchami (`style` op → `SlideModel.fontSize` → `planSlide`).
 * Bitta joyda qo'llanadi — PPTX ham, ko'ruvchi ham bir xil o'lchamni oladi.
 */
const meta = extractMeta(TOOL_BY_ID.slide, { topic: "Suv aylanishi" });
const slide = (): SlideModel => ({ id: "s0", layout: "bullets", title: "Suv aylanishi", bullets: ["Bug‘lanish", "Kondensatsiya", "Yog‘in"] });
const doc = (): AcademicDoc => ({ meta, titlePage: false, toc: false, sections: [], slides: [slide()], slideTemplate: "lecture", slideTheme: "atlas" });
const ctx = { genId: "a1b2c3d4-0000-4000-8000-000000000001" };
const theme = getSlideTheme("atlas");
const bodyType = bodyRules(meta, "lecture");

test("style op: sarlavha shrifti planSlide qatlamiga tushadi, aylanma teskari", () => {
  const r = applyDocOps(doc(), [{ op: "style", index: 0, src: { f: "title" }, size: 44 }], ctx);
  assert.ok(r.ok);
  const s = r.doc.slides![0];
  assert.equal(s.fontSize?.['{"f":"title"}'], 44);
  const before = planSlide(slide(), theme, "classic", 1, 10, "auto", "lecture", { bodyType });
  const after = planSlide(s, theme, "classic", 1, 10, "auto", "lecture", { bodyType });
  const t0 = before.layers.find((l) => l.t === "text" && l.src?.f === "title");
  const t1 = after.layers.find((l) => l.t === "text" && l.src?.f === "title");
  assert.ok(t0 && t0.t === "text" && t1 && t1.t === "text");
  assert.equal(t1.size, 44);
  assert.notEqual(t0.size, 44);
  // Boshqa qatlamlar o'zgarmaydi (bandlar)
  const b0 = before.layers.find((l) => l.t === "text" && l.srcLines);
  const b1 = after.layers.find((l) => l.t === "text" && l.srcLines);
  assert.ok(b0 && b0.t === "text" && b1 && b1.t === "text");
  assert.equal(b1.size, b0.size);
  // Teskari op standartga qaytaradi
  const inv = inverseOps(doc(), [{ op: "style", index: 0, src: { f: "title" }, size: 44 }], ctx);
  const back = applyDocOps(r.doc, inv, ctx);
  assert.ok(back.ok);
  assert.deepEqual(back.doc.slides![0].fontSize, undefined);
});

test("style op: bandlar ro'yxati (srcLines) birinchi qator kaliti bilan", () => {
  const r = applyDocOps(doc(), [{ op: "style", index: 0, src: { f: "bullets", i: 0 }, size: 30 }], ctx);
  assert.ok(r.ok);
  const plan = planSlide(r.doc.slides![0], theme, "classic", 1, 10, "auto", "lecture", { bodyType });
  const b = plan.layers.find((l) => l.t === "text" && l.srcLines);
  assert.ok(b && b.t === "text");
  assert.equal(b.size, 30);
});

test("style op: chegara va null (standartga qaytarish)", () => {
  assert.equal(applyDocOps(doc(), [{ op: "style", index: 0, src: { f: "title" }, size: FONT_MAX + 1 }], ctx).ok, false);
  assert.equal(applyDocOps(doc(), [{ op: "style", index: 0, src: { f: "title" }, size: FONT_MIN - 1 }], ctx).ok, false);
  const set = applyDocOps(doc(), [{ op: "style", index: 0, src: { f: "title" }, size: 40 }, { op: "style", index: 0, src: { f: "title" }, size: null }], ctx);
  assert.ok(set.ok);
  assert.equal(set.doc.slides![0].fontSize, undefined);
});

test("parseDocOps va sanitize: fontSize faqat oraliqdagi sonlar bilan o'tadi", () => {
  const p = parseDocOps([{ op: "style", index: 0, src: { f: "title" }, size: 20 }, { op: "style", index: 0, src: { f: "title" }, size: null }]);
  assert.ok(p.ok && p.ops.length === 2);
  assert.equal(parseDocOps([{ op: "style", index: 0, src: { f: "title" }, size: "20" }]).ok, false);
  const s = sanitizeSlideModel({ ...slide(), fontSize: { '{"f":"title"}': 40, '{"f":"subtitle"}': 500, x: "a" } }, ctx.genId, bodyType);
  assert.deepEqual(s?.fontSize, { '{"f":"title"}': 40 });
});

// ══════════════════════════════════ Shrift OILASI (`style.font` → `SlideModel.font` → `layer.font`)

/** Sarlavha qatlami (tekshiruvlar uchun). */
function titleLayer(s: SlideModel) {
  const plan = planSlide(s, theme, "classic", 1, 10, "auto", "lecture", { bodyType });
  const t = plan.layers.find((l) => l.t === "text" && l.src?.f === "title");
  assert.ok(t && t.t === "text", "sarlavha qatlami topilmadi");
  return t;
}

test("style op: font → modelga id, qatlamga face (PPTX fontFace va ko'ruvchi bir xil o'qiydi)", () => {
  const r = applyDocOps(doc(), [{ op: "style", index: 0, src: { f: "title" }, font: "georgia" }], ctx);
  assert.ok(r.ok);
  const s = r.doc.slides![0];
  assert.deepEqual(s.font, { '{"f":"title"}': "georgia" });
  assert.equal(s.fontSize, undefined, "faqat oila o'zgardi — o'lcham xaritasi paydo bo'lmasin");
  assert.equal(titleLayer(s).font, "Georgia");
  assert.equal(titleLayer(slide()).font, undefined, "tanlanmagan qatlamda face yo'q — PPTX standart Arial oladi");
  // Teskari op (`set`) oilani ham qaytaradi.
  const inv = inverseOps(doc(), [{ op: "style", index: 0, src: { f: "title" }, font: "georgia" }], ctx);
  const back = applyDocOps(r.doc, inv, ctx);
  assert.ok(back.ok);
  assert.equal(back.doc.slides![0].font, undefined);
});

test("style op: kengroq shrift o'lchamni KICHRAYTIRADI, tor shrift kattalashtirmaydi, tanlangan o'lchamga tegmaydi", () => {
  const base = titleLayer(slide()).size;
  const verdana = applyDocOps(doc(), [{ op: "style", index: 0, src: { f: "title" }, font: "verdana" }], ctx);
  assert.ok(verdana.ok);
  const vSize = titleLayer(verdana.doc.slides![0]).size;
  // Verdana em 0.63 > Arial 0.55 → 0.55/0.63 ≈ 0.87.
  assert.equal(vSize, Math.round(base * (0.55 / 0.63)), "kengroq shrift qutidan chiqmasin");
  assert.ok(vSize < base);

  const times = applyDocOps(doc(), [{ op: "style", index: 0, src: { f: "title" }, font: "times" }], ctx);
  assert.ok(times.ok);
  assert.equal(titleLayer(times.doc.slides![0]).size, base, "tor shrift KATTALASHTIRILMAYDI — balandlik byudjeti shu o'lcham uchun");

  const both = applyDocOps(
    doc(),
    [
      { op: "style", index: 0, src: { f: "title" }, size: 40 },
      { op: "style", index: 0, src: { f: "title" }, font: "verdana" },
    ],
    ctx,
  );
  assert.ok(both.ok);
  assert.equal(titleLayer(both.doc.slides![0]).size, 40, "foydalanuvchi tanlagan o'lcham qayta hisoblanmaydi");
  assert.equal(titleLayer(both.doc.slides![0]).font, "Verdana");
});

test("style op: bitta op da ham o'lcham, ham oila; null oilani o'chiradi; noma'lum id / bo'sh op — rad", () => {
  const r = applyDocOps(doc(), [{ op: "style", index: 0, src: { f: "title" }, size: 36, font: "cambria" }], ctx);
  assert.ok(r.ok);
  assert.deepEqual(r.doc.slides![0].fontSize, { '{"f":"title"}': 36 });
  assert.deepEqual(r.doc.slides![0].font, { '{"f":"title"}': "cambria" });
  const cleared = applyDocOps(r.doc, [{ op: "style", index: 0, src: { f: "title" }, font: null }], ctx);
  assert.ok(cleared.ok);
  assert.equal(cleared.doc.slides![0].font, undefined, "oxirgi oila o'chsa kalit ham yo'qoladi");
  assert.deepEqual(cleared.doc.slides![0].fontSize, { '{"f":"title"}': 36 }, "o'lcham joyida qoladi");
  assert.equal(applyDocOps(doc(), [{ op: "style", index: 0, src: { f: "title" }, font: "comic" as never }], ctx).ok, false, "reyestrdan tashqari shrift");
  assert.equal(applyDocOps(doc(), [{ op: "style", index: 0, src: { f: "title" } }], ctx).ok, false, "na o'lcham, na oila — bo'sh op");
});

test("parseDocOps va sanitize: font faqat reyestr id lari bilan o'tadi", () => {
  const p = parseDocOps([
    { op: "style", index: 0, src: { f: "title" }, font: "tahoma" },
    { op: "style", index: 0, src: { f: "title" }, font: null },
    { op: "style", index: 0, src: { f: "bullets", i: 0 }, size: 20, font: "arial" },
  ]);
  assert.ok(p.ok && p.ops.length === 3);
  assert.deepEqual(p.ops[0], { op: "style", index: 0, src: { f: "title" }, font: "tahoma" }, "size berilmasa kalit ham bo'lmaydi");
  assert.equal(parseDocOps([{ op: "style", index: 0, src: { f: "title" }, font: "Tahoma" }]).ok, false, "face nomi id emas");
  assert.equal(parseDocOps([{ op: "style", index: 0, src: { f: "title" } }]).ok, false, "bo'sh style");
  assert.equal(parseDocOps([{ op: "style", index: 0, src: { f: "yo‘q" }, size: 20 }]).ok, false, "manba kanonik tekshiruvdan o'tmaydi");
  const s = sanitizeSlideModel({ ...slide(), font: { '{"f":"title"}': "georgia", '{"f":"subtitle"}': "comic", x: 5 } }, ctx.genId, bodyType);
  assert.deepEqual(s?.font, { '{"f":"title"}': "georgia" });
});
