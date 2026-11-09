import assert from "node:assert/strict";
import { test } from "node:test";
import { prettyFormula, prettyFormulasDeep } from "../lib/generation/formula-text.ts";

function cases(pairs: [string, string][]) {
  for (const [input, want] of pairs) assert.equal(prettyFormula(input), want, input);
}

test("chemistry: LaTeX subscripts and bare counts", () => {
  cases([
    ["C_n H_2n+1 COOH", "CₙH₂ₙ₊₁COOH"],
    ["C_nH_{2n+1}COOH", "CₙH₂ₙ₊₁COOH"],
    ["HOOC-(CH2)_n-COOH", "HOOC-(CH₂)ₙ-COOH"],
    ["C6H8O7 kabi turlari", "C₆H₈O₇ kabi turlari"],
    ["H2SO4 va Ca(OH)2", "H₂SO₄ va Ca(OH)₂"],
    ["CO2, O2, NaCl, MgCl2, Al2(SO4)3", "CO₂, O₂, NaCl, MgCl₂, Al₂(SO₄)₃"],
    ["2H2 + O2 -> 2H2O", "2H₂ + O₂ -> 2H₂O"],
    ["Ca^{2+} va Na^+ ionlari", "Ca²⁺ va Na⁺ ionlari"],
    ["SO_4^{2-}", "SO₄²⁻"],
    ["CO2-emissiyasi", "CO₂-emissiyasi"],
    ["\\mathrm{H_{2}O}", "H₂O"],
  ]);
});

test("math, physics and geometry", () => {
  cases([
    ["x^2 + y^2 = r^2", "x² + y² = r²"],
    ["a^2+b^2=c^2", "a²+b²=c²"],
    ["f(x)=x^2+1", "f(x)=x²+1"],
    ["x^2-y^2", "x²-y²"],
    ["2^n-1", "2ⁿ-1"],
    ["E = mc^2", "E = mc²"],
    ["S = v_0 t + at^2/2", "S = v₀ t + at²/2"],
    ["a_1+a_2", "a₁+a₂"],
    ["x_i-x_j", "xᵢ-xⱼ"],
    ["a_n+b_n", "aₙ+bₙ"],
    ["x_i^2", "xᵢ²"],
    ["a^(n+1)", "aⁿ⁺¹"],
    ["10^{-3} m/s^2", "10⁻³ m/s²"],
    ["$a \\cdot b \\to c$", "a · b → c"],
    ["3\\times10^8 m/s", "3×10⁸ m/s"],
    ["\\sqrt{2} va \\sqrt{x^2+y^2}", "√2 va √(x²+y²)"],
    ["\\frac{a+b}{2} va \\frac{\\pi}{2}", "(a+b)/2 va π/2"],
    ["\\sin^2\\alpha + \\cos^2\\alpha = 1", "sin²α + cos²α = 1"],
    ["\\angle ABC = 90^\\circ", "∠ ABC = 90°"],
    ["\\triangle ABC \\cong \\triangle DEF", "△ ABC ≅ △ DEF"],
    ["a \\perp b, c \\parallel d", "a ⊥ b, c ∥ d"],
    ["\\lambda_1 \\le \\lambda_2", "λ₁ ≤ λ₂"],
    ["\\Delta H^\\circ < 0", "Δ H° < 0"],
    ["F_{ish} = \\mu N", "Fᵢₛₕ = μ N"],
  ]);
});

test("prose, code, links and product names stay", () => {
  for (const s of [
    "A4 qog'oz", "B12 vitamini", "MP3 fayl", "H1N1 virusi", "H3N2", "2026-yil", "K2 cho'qqisi", "In 1990", "x_y_z mavzu",
    "PS5", "CSS3", "B2B va B2C", "P2P", "Y2K", "W3C", "I2C", "FC25", "HP15", "ISO9001", "ISO 9001", "GPT-4", "COVID-19",
    "F2 tugmasi", "Galaxy S8", "KS2 dasturi", "API_2", "iPhone 15", "5G", "N95",
    "max_len", "file_name", "n_samples", "is_open", "item_2", "image_2.png", "test_1.py", "$user_name = $_POST['x'];",
    "narxi $5 va $10 x_y $20",
    "https://en.wikipedia.org/wiki/Windows_11", "https://example.com/a?id=ab_2", "user_1@gmail.com", "www.CO2.org/H2O",
    "C:\\total\\to\\path",
  ]) {
    assert.equal(prettyFormula(s), s, s);
  }
});

test("a list of formulas keeps its spaces", () => {
  cases([
    ["H2 O2 N2", "H₂ O₂ N₂"],
    ["Issiqxona gazlari: CO2 CH4 N2O", "Issiqxona gazlari: CO₂ CH₄ N₂O"],
  ]);
});

test("deep walk skips ids, layout, links and image hints; a parsed __proto__ stays an own key", () => {
  const out = prettyFormulasDeep({
    layout: "table",
    imageHint: "H2O_x",
    refs: [{ title: "CO2 haqida", source: "H2O tadqiqoti, 2020" }],
    rows: [["C6H12O6", "x^2"]],
  });
  assert.deepEqual(out, {
    layout: "table",
    imageHint: "H2O_x",
    refs: [{ title: "CO₂ haqida", source: "H2O tadqiqoti, 2020" }],
    rows: [["C₆H₁₂O₆", "x²"]],
  });
  const proto = prettyFormulasDeep(JSON.parse('{"__proto__":{"layout":"quote"}}') as Record<string, unknown>);
  assert.equal((proto as { layout?: string }).layout, undefined);
});
