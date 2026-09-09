import test from "node:test";
import assert from "node:assert/strict";
import { FONT_BY_ID, SLIDE_FONTS, fontCss, isSlideFontId } from "../lib/generation/slide-fonts.ts";
import { PPTX_FONT, SLIDE_FONT } from "../lib/generation/slide-layout.ts";

/**
 * Shrift reyestri — PPTX `fontFace` va ko'ruvchi `font-family` BITTA
 * ro'yxatdan. Reyestr buzilsa (takror id, bo'sh face) tanlov faylga
 * boshqacha, ekranga boshqacha tushardi.
 */

test("reyestr: 8 ta shrift, id lar takrorlanmaydi, face va css bo'sh emas", () => {
  assert.equal(SLIDE_FONTS.length, 8);
  assert.equal(new Set(SLIDE_FONTS.map((f) => f.id)).size, 8, "id takrorlanmasin");
  assert.equal(new Set(SLIDE_FONTS.map((f) => f.face)).size, 8, "face takrorlanmasin");
  for (const f of SLIDE_FONTS) {
    assert.ok(f.face.length > 0 && f.css.length > 0 && f.label.length > 0, `${f.id}: maydonlar bo'sh`);
    assert.ok(f.em > 0.4 && f.em < 0.75, `${f.id}: em ${f.em} haqiqiy oraliqdan tashqarida`);
    assert.ok(f.css.includes(f.face), `${f.id}: css ro'yxati face bilan boshlanishi kerak`);
  }
});

test("standart shrift (Arial) — maketning SLIDE_FONT/PPTX_FONT bilan AYNAN bir xil", () => {
  // Standart tanlov va «tanlanmagan» holat bir xil ko'rinishi kerak — aks
  // holda «Arial» ni tanlagan foydalanuvchi boshqa ro'yxat olardi.
  assert.equal(FONT_BY_ID.arial.css, SLIDE_FONT);
  assert.equal(FONT_BY_ID.arial.face, PPTX_FONT);
});

test("isSlideFontId: faqat reyestr id lari, prototip kalitlari emas", () => {
  assert.equal(isSlideFontId("georgia"), true);
  assert.equal(isSlideFontId("Georgia"), false, "id kichik harfda — face emas");
  assert.equal(isSlideFontId("comic-sans"), false);
  assert.equal(isSlideFontId("toString"), false, "Object prototipi id emas");
  assert.equal(isSlideFontId(null), false);
  assert.equal(isSlideFontId(3), false);
});

test("fontCss: reyestr face → o'z ro'yxati; begona nom → qo'shtirnoqda + sans-serif; bo'sh → bo'sh", () => {
  assert.equal(fontCss("Georgia"), FONT_BY_ID.georgia.css);
  assert.equal(fontCss("Comic Sans MS"), '"Comic Sans MS", sans-serif');
  assert.equal(fontCss('Ev"il\\'), '"Evil", sans-serif', "qo'shtirnoq/teskari chiziq CSS ga sizmasin");
  assert.equal(fontCss(""), "");
});
