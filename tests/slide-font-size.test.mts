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
