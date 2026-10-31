import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hasMath, splitMath } from "../lib/tests/math-text.ts";

/**
 * «Test ishlash» question text with `$…$` formulas (`lib/tests/math-text.ts`). Pure splitting rules, then the whole real bank
 * (`data/tests/bmb-texts.json`): every `$` of every text is a formula delimiter (none is left over as plain text) and the parts
 * always join back into the original.
 *
 * Mutation checks (each broken on purpose, the named test failed, then restored):
 *   1. the digit lookahead `(?!\d)` removed from the regex -> «a price is not a formula» (the `$5-$10` case).
 *   2. the space rules removed (`(?=[^\s$])` and `[^\s$]` -> any char) -> «delimiters need non-space inside».
 *   3. the plain tail after the last formula dropped -> «the parts join back into the text».
 */

const join = (text: string): string => splitMath(text).map((p) => (p.math ? p.source : p.text)).join("");

test("plain text: one plain part, no math", () => {
  assert.deepEqual(splitMath("O‘lchamlari 2m×1m×3m (m³)"), [{ math: false, text: "O‘lchamlari 2m×1m×3m (m³)" }]);
  assert.deepEqual(splitMath(""), []);
  assert.equal(hasMath("oddiy matn"), false);
});

test("formulas are split out in order, text around them kept", () => {
  assert.deepEqual(splitMath("Hisoblang: $\\frac{1}{4}-\\frac{1}{5}$ ni toping, $x^2$"), [
    { math: false, text: "Hisoblang: " },
    { math: true, latex: "\\frac{1}{4}-\\frac{1}{5}", source: "$\\frac{1}{4}-\\frac{1}{5}$" },
    { math: false, text: " ni toping, " },
    { math: true, latex: "x^2", source: "$x^2$" },
  ]);
  assert.deepEqual(splitMath("$\\frac{1}{5}$"), [{ math: true, latex: "\\frac{1}{5}", source: "$\\frac{1}{5}$" }], "an option that is only a formula");
  assert.deepEqual(splitMath("$5$"), [{ math: true, latex: "5", source: "$5$" }], "one character is a formula");
  assert.equal(hasMath("a $b$ c"), true);
});

test("a price is not a formula; an unpaired dollar stays text", () => {
  assert.equal(hasMath("Narx $5 va $10 so‘m"), false, "«$5 va $» would be a formula without the digit rule");
  assert.equal(hasMath("Narx $5-$10 oralig‘ida"), false, "the closing dollar before a digit is a price, not a delimiter");
  assert.equal(hasMath("Narx 5$ va 10$"), false);
  assert.equal(hasMath("faqat bitta $ belgi"), false);
  assert.deepEqual(splitMath("$5 va $10"), [{ math: false, text: "$5 va $10" }]);
});

test("delimiters need non-space inside: «$ a $» is text", () => {
  assert.equal(hasMath("bu $ a $ emas"), false);
  assert.equal(hasMath("bu $a $ emas"), false);
  assert.equal(hasMath("bu $ a$ emas"), false);
  assert.equal(hasMath("bu $a$ ha"), true);
});

test("a formula never spans a second dollar; newlines inside text survive", () => {
  assert.deepEqual(splitMath("$a$ va $b$").filter((p) => p.math).map((p) => p.math && p.latex), ["a", "b"]);
  const parts = splitMath("Birinchi qator\n$x$\nIkkinchi");
  assert.deepEqual(parts.map((p) => (p.math ? p.latex : p.text)), ["Birinchi qator\n", "x", "\nIkkinchi"]);
});

test("the whole bank: no stray dollar, the parts join back into the text", () => {
  const items = JSON.parse(readFileSync(new URL("../data/tests/bmb-texts.json", import.meta.url), "utf8")) as { question_id: number; question: string; options: Record<string, string> }[];
  let formulas = 0;
  for (const it of items) {
    for (const text of [it.question, ...Object.values(it.options)]) {
      assert.equal(join(text), text, `question ${it.question_id}: the parts join back into the text`);
      const parts = splitMath(text);
      formulas += parts.filter((p) => p.math).length;
      const plain = parts.filter((p) => !p.math).map((p) => (p.math ? "" : p.text)).join("");
      assert.ok(!plain.includes("$"), `question ${it.question_id}: a dollar sign left over as plain text in «${text}»`);
    }
  }
  assert.ok(formulas >= 50, `the bank has formulas (${formulas})`);
});
