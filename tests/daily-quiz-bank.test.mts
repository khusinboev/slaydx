import test from "node:test";
import assert from "node:assert/strict";

/**
 * The daily quiz question bank (lib/daily-quiz/questions.ts, owner request 16): exactly 150 questions,
 * every one well-formed, answer positions balanced, Uzbek Latin with the current alphabet.
 *
 * Mutations (each turned a test red, then restored): a duplicated question; two equal options; `answer: 4`;
 * 40 answers moved to position A (distribution); a 230-character question; an ASCII `o'` in a text.
 */

const { DAILY_QUESTIONS } = await import("../lib/daily-quiz/questions.ts");

test("the bank has exactly 150 questions with unique ids and unique texts", () => {
  assert.equal(DAILY_QUESTIONS.length, 150);
  assert.equal(new Set(DAILY_QUESTIONS.map((q) => q.id)).size, 150, "ids are unique");
  assert.equal(new Set(DAILY_QUESTIONS.map((q) => q.q.trim().toLowerCase())).size, 150, "question texts are unique");
  for (const q of DAILY_QUESTIONS) assert.match(q.id, /^dq-\d{3}$/, q.id);
});

test("every question: 4 distinct non-empty options, an in-range answer, text and explanation within limits", () => {
  for (const q of DAILY_QUESTIONS) {
    assert.equal(q.options.length, 4, `${q.id}: 4 options`);
    for (const o of q.options) assert.ok(typeof o === "string" && o.trim().length > 0 && o.length <= 100, `${q.id}: option "${o}"`);
    assert.equal(new Set(q.options.map((o) => o.trim().toLowerCase())).size, 4, `${q.id}: options are distinct`);
    assert.ok(Number.isInteger(q.answer) && q.answer >= 0 && q.answer <= 3, `${q.id}: answer in range`);
    assert.ok(q.q.length >= 10 && q.q.length <= 220, `${q.id}: question length ${q.q.length}`);
    assert.ok(q.explain.trim().length >= 10 && q.explain.length <= 300, `${q.id}: explanation length ${q.explain.length}`);
    // The explanation is the reason, not a bare repeat of the right option.
    assert.notEqual(q.explain.trim(), q.options[q.answer].trim(), q.id);
  }
});

test("answer positions are balanced: each of A-D holds 20-30 % of the answers", () => {
  const count = [0, 0, 0, 0];
  for (const q of DAILY_QUESTIONS) count[q.answer]++;
  for (let i = 0; i < 4; i++) {
    const share = count[i] / DAILY_QUESTIONS.length;
    assert.ok(share >= 0.2 && share <= 0.3, `position ${"ABCD"[i]} holds ${(share * 100).toFixed(1)} % (${count})`);
  }
});

test("texts use the current Uzbek Latin alphabet: oʻ / gʻ with U+02BB, no ASCII or curly apostrophe after o / g", () => {
  const texts = DAILY_QUESTIONS.flatMap((q) => [q.q, q.explain, ...q.options]);
  for (const s of texts) {
    assert.ok(!/[oOgG]['‘’ʼ`]/.test(s), `wrong apostrophe after o/g in: ${s}`);
    assert.ok(!s.includes("'"), `ASCII apostrophe in: ${s}`);
    assert.ok(!/\s{2,}/.test(s) && s === s.trim(), `stray whitespace in: ${JSON.stringify(s)}`);
    assert.ok(!/TODO|FIXME|lorem/i.test(s), s);
  }
  assert.ok(texts.some((s) => s.includes("ʻ")), "the bank actually uses U+02BB");
});

test("the explanation of every numeric multiple-choice question mentions the right option's number", () => {
  // A cheap consistency net for arithmetic items: when the right option is a plain number, that number
  // must appear in the explanation (a wrong answer key would usually contradict its own explanation).
  for (const q of DAILY_QUESTIONS) {
    const right = q.options[q.answer].trim();
    if (!/^\d+([ ,]\d+)*$/.test(right)) continue;
    const digits = right.replace(/\s/g, "");
    const haystack = q.explain.replace(/(\d) (?=\d{3}\b)/g, "$1");
    assert.ok(haystack.includes(digits) || q.explain.includes(right), `${q.id}: explanation does not mention ${right}: ${q.explain}`);
  }
});
