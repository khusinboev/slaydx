import assert from "node:assert/strict";
import { test } from "node:test";
import { prettyFormula, prettyFormulasDeep } from "../lib/generation/formula-text.ts";

test("LaTeX-style subscripts become one Unicode formula", () => {
  assert.equal(prettyFormula("C_n H_2n+1 COOH"), "CₙH₂ₙ₊₁COOH");
  assert.equal(prettyFormula("C_nH_{2n+1}COOH"), "CₙH₂ₙ₊₁COOH");
  assert.equal(prettyFormula("HOOC-(CH2)_n-COOH"), "HOOC-(CH₂)ₙ-COOH");
});

test("bare counts in real chemical formulas", () => {
  assert.equal(prettyFormula("C6H8O7 kabi turlari"), "C₆H₈O₇ kabi turlari");
  assert.equal(prettyFormula("H2SO4 va Ca(OH)2"), "H₂SO₄ va Ca(OH)₂");
  assert.equal(prettyFormula("CO2, O2, NaCl"), "CO₂, O₂, NaCl");
  assert.equal(prettyFormula("2H2 + O2 -> 2H2O"), "2H₂ + O₂ -> 2H₂O");
});

test("tokens that are not formulas stay", () => {
  for (const s of ["A4 qog'oz", "B12 vitamini", "MP3 fayl", "H1N1 virusi", "2026-yil", "K2 cho'qqisi", "In 1990", "x_y_z mavzu"]) {
    assert.equal(prettyFormula(s), s);
  }
});

test("powers, charges and LaTeX symbols", () => {
  assert.equal(prettyFormula("x^2 + y^2"), "x² + y²");
  assert.equal(prettyFormula("Ca^{2+} ionlari"), "Ca²⁺ ionlari");
  assert.equal(prettyFormula("10^{-3} m/s^2"), "10⁻³ m/s²");
  assert.equal(prettyFormula("$a \\cdot b \\to c$"), "a · b → c");
});

test("deep walk skips layout and image hints", () => {
  const out = prettyFormulasDeep({ layout: "table", imageHint: "H2O_x", rows: [["C6H12O6", "x^2"]] });
  assert.deepEqual(out, { layout: "table", imageHint: "H2O_x", rows: [["C₆H₁₂O₆", "x²"]] });
});
