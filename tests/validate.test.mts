import test from "node:test";
import assert from "node:assert/strict";

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const { sanitizeValues, MAX_FIELD, MAX_SOURCE } = await import("../lib/server/validate.ts");

/**
 * Kirish tozalash — bu chegara pul bilan bog'liq: cheklovsiz matn
 * to'g'ridan-to'g'ri LLM ga ketsa, bitta so'rov katta hisob keltiradi.
 */

test("obyekt bo'lmagan kirish rad etiladi", () => {
  assert.equal(sanitizeValues(null), null);
  assert.equal(sanitizeValues("salom"), null);
  assert.equal(sanitizeValues([1, 2, 3]), null);
  assert.equal(sanitizeValues(42), null);
});

test("faqat oddiy turlar o'tadi", () => {
  const out = sanitizeValues({
    topic: "Mavzu",
    pages: 5,
    titleSlide: true,
    nothing: null,
    nested: { evil: true },
    list: [1, 2],
    fn: undefined,
  });
  assert.deepEqual(out, { topic: "Mavzu", pages: 5, titleSlide: true, nothing: null });
});

test("prototype ifloslantirish kalitlari o'tmaydi", () => {
  const out = sanitizeValues({ "__proto__": "x", "constructor.x": "y", "a-b": "z", ok: "1" });
  assert.deepEqual(Object.keys(out!), ["ok"]);
});

test("uzun matn kesiladi", () => {
  const out = sanitizeValues({ topic: "a".repeat(MAX_FIELD + 5_000) });
  assert.equal(String(out!.topic).length, MAX_FIELD);
});

test("manba matni uchun kengroq chegara", () => {
  const out = sanitizeValues({ sourceText: "b".repeat(MAX_SOURCE + 10_000) });
  assert.equal(String(out!.sourceText).length, MAX_SOURCE);
  assert.ok(MAX_SOURCE > MAX_FIELD);
});

test("nol bayt olib tashlanadi (Postgres text ga yozilmaydi)", () => {
  const out = sanitizeValues({ topic: "a\0b\0c" });
  assert.equal(out!.topic, "abc");
});

test("NaN va Infinity 0 ga aylanadi", () => {
  const out = sanitizeValues({ a: NaN, b: Infinity, c: -Infinity, d: 7 });
  assert.deepEqual(out, { a: 0, b: 0, c: 0, d: 7 });
});

test("kalitlar soni cheklanadi", () => {
  const big: Record<string, string> = {};
  for (let i = 0; i < 500; i++) big[`k${i}`] = "v";
  assert.ok(Object.keys(sanitizeValues(big)!).length <= 80);
});
