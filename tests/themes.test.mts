import test from "node:test";
import assert from "node:assert/strict";
import { SLIDE_THEMES, contrastRatio } from "../lib/generation/slide-themes.ts";
import { SLIDE_THEME_IDS } from "../lib/generation/slide-types.ts";

/**
 * Tema palitralari o'lchanadi, ko'z bilan tanlanmaydi.
 *
 * 15 ta tema qo'lda yozilgan va hech qachon tekshirilmagan edi: `atlas`
 * (standart tema) ning oltin aksenti krem fon ustida 2.20 kontrast berardi —
 * proyektorda raqamlar ko'rinmasdi. Bu test har bir juftni WCAG 2.1
 * bo'yicha o'lchaydi.
 */

const AA = 4.5;

test("barcha temalar ro'yxatda va takrorlanmaydi", () => {
  assert.equal(SLIDE_THEMES.length, SLIDE_THEME_IDS.length);
  assert.equal(new Set(SLIDE_THEMES.map((t) => t.id)).size, SLIDE_THEMES.length);
});

test("tana matni fon ustida WCAG AA dan o'tadi", () => {
  for (const t of SLIDE_THEMES) {
    assert.ok(contrastRatio(t.text, t.bg) >= AA, `${t.id}: text/bg = ${contrastRatio(t.text, t.bg).toFixed(2)}`);
    assert.ok(
      contrastRatio(t.text, t.surface) >= AA,
      `${t.id}: text/surface = ${contrastRatio(t.text, t.surface).toFixed(2)}`,
    );
    assert.ok(
      contrastRatio(t.titleText, t.titleBg) >= AA,
      `${t.id}: titleText/titleBg = ${contrastRatio(t.titleText, t.titleBg).toFixed(2)}`,
    );
  }
});

test("ikkilamchi matn ham o'qiladi", () => {
  for (const t of SLIDE_THEMES) {
    assert.ok(contrastRatio(t.muted, t.bg) >= AA, `${t.id}: muted/bg = ${contrastRatio(t.muted, t.bg).toFixed(2)}`);
    assert.ok(
      contrastRatio(t.titleMuted, t.titleBg) >= AA,
      `${t.id}: titleMuted/titleBg = ${contrastRatio(t.titleMuted, t.titleBg).toFixed(2)}`,
    );
  }
});

test("aksent MATN varianti (accentInk) fon va kartada o'qiladi", () => {
  for (const t of SLIDE_THEMES) {
    assert.ok(
      contrastRatio(t.accentInk, t.bg) >= AA,
      `${t.id}: accentInk/bg = ${contrastRatio(t.accentInk, t.bg).toFixed(2)}`,
    );
    assert.ok(
      contrastRatio(t.accentInk, t.surface) >= AA,
      `${t.id}: accentInk/surface = ${contrastRatio(t.accentInk, t.surface).toFixed(2)}`,
    );
  }
});

test("kontrast formulasi ma'lum qiymatlarga mos", () => {
  assert.equal(Math.round(contrastRatio("#000000", "#FFFFFF")), 21);
  assert.equal(Math.round(contrastRatio("#FFFFFF", "#FFFFFF")), 1);
});
