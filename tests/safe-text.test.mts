import test from "node:test";
import assert from "node:assert/strict";

/**
 * YOLG'IZ SURROGAT / NUL — JSONB va TEXT yozuvlarini buzmasin (AUDIT prod-readiness C03: BEB-01, BEA-02).
 *
 * `.slice(0, n)` UTF-16 kod birligi bo'yicha kesadi: emoji (yoki har qanday
 * U+10000+ belgi) aynan chegarada tursa, natijada YOLG'IZ yuqori surrogat
 * qoladi. `JSON.stringify` uni `\ud83d` escape'i qilib chiqaradi, Postgres
 * `jsonb` esa buni rad etadi (22P02), `\u0000`ni ham (22P05); `text` ustuni
 * xom NUL ni rad etadi (22021). Natija: `completeJob` fayl saqlangandan
 * KEYIN yiqilardi → FAILED + to'liq qaytarish, fayl esa yuklab olinardi.
 *
 * Bu fayl BAZASIZ: yordamchilarning o'zi (`toJsonb`, `safeSlice`,
 * `cleanText`) va ularni ishlatadigan kesish joylari (`extractMeta`,
 * `clipTo`, `splitCsv`) qulflanadi. Baza bilan to'liq yo'l —
 * `tests/jsonb-writes.test.mts`.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const { toJsonb } = await import("../lib/server/jsonb.ts");
const { safeSlice, cleanText } = await import("../lib/generation/safe-text.ts");
const { extractMeta } = await import("../lib/generation/meta.ts");
const { TOOL_BY_ID } = await import("../lib/tools.ts");
const { clipTo } = await import("../lib/generation/slide-limits.ts");
const { splitCsv } = await import("../lib/generation/slide-params.ts");
const { ARTICLE_LIMITS } = await import("../lib/generation/article/types.ts");

const EMOJI = "😀"; // U+1F600 — ikki UTF-16 kod birligi (yuqori + quyi surrogat)
const HIGH = "\ud83d";
/** Postgres `jsonb` rad etadigan ketma-ketliklar: yolg'iz surrogat escape'i va `\u0000`. */
const PG_BAD_JSON = /\\ud[89ab][0-9a-f]{2}(?!\\ud[c-f][0-9a-f]{2})|(?<!\\ud[89ab][0-9a-f]{2})\\ud[c-f][0-9a-f]{2}|\\u0000/i;

test("safeSlice: chegaradagi emoji YARIM qolmaydi, qolgan holda .slice bilan bir xil", () => {
  const s = "a".repeat(79) + EMOJI;
  assert.equal(s.slice(0, 80).isWellFormed(), false, "shart: oddiy .slice juftlikni yoradi");
  const cut = safeSlice(s, 80);
  // MUTATSIYA: safeSlice oddiy `.slice` ga qaytarilsa — bu qator qizaradi.
  assert.equal(cut.isWellFormed(), true);
  assert.equal(cut, "a".repeat(79));
  assert.equal(safeSlice(s, 81), s, "butun juftlik sig'sa — saqlanadi");
  assert.equal(safeSlice("salom", 3), "sal");
  assert.equal(safeSlice("salom", 99), "salom");
  assert.equal(safeSlice("", 5), "");
});

test("cleanText: NUL olib tashlanadi, yolg'iz surrogat U+FFFD ga, toza matn o'zgarmaydi", () => {
  assert.equal(cleanText("a\u0000b"), "ab");
  assert.equal(cleanText(`x${HIGH}`), "x\ufffd");
  assert.equal(cleanText(`\ude00y`), "\ufffdy");
  const clean = `Salom ${EMOJI} dunyo`;
  assert.equal(cleanText(clean), clean);
});

test("toJsonb: har qatordagi yolg'iz surrogat va NUL (kalitlarda ham) Postgres qabul qiladigan JSON ga aylanadi", () => {
  const doc = {
    meta: { position: ("A".repeat(79) + EMOJI).slice(0, 80), note: "a\u0000b" },
    sections: [{ title: `t${HIGH}`, body: ["ok", `\ude00x`, 3, null, true] }],
    [`k${HIGH}`]: "v",
    "k\u0000z": 1,
  };
  const raw = JSON.stringify(doc);
  assert.match(raw, PG_BAD_JSON, "shart: oddiy JSON.stringify Postgres rad etadigan escape chiqaradi");
  const out = toJsonb(doc);
  // MUTATSIYA: replacer olib tashlansa (oddiy JSON.stringify) — bu qator qizaradi.
  assert.doesNotMatch(out, PG_BAD_JSON);
  const back = JSON.parse(out);
  assert.equal(back.meta.position, "A".repeat(79) + "\ufffd");
  assert.equal(back.meta.note, "ab");
  assert.equal(back.sections[0].title, "t\ufffd");
  assert.deepEqual(back.sections[0].body, ["ok", "\ufffdx", 3, null, true]);
  // MUTATSIYA: kalitlarni tozalash olib tashlansa — bu ikki qator qizaradi.
  assert.equal(back["k\ufffd"], "v");
  assert.equal(back.kz, 1);
});

test("toJsonb: toza qiymat uchun JSON.stringify bilan BAYTMA-BAYT bir xil (mavjud yozuvlar o'zgarmaydi)", () => {
  const samples: unknown[] = [
    { a: 1, b: [1, "x", { c: `emoji ${EMOJI}` }], d: null, e: "o‘zbek" },
    [],
    "matn",
    null,
    { nested: { deep: { deeper: ["1", 2, false] } } },
    { when: new Date(0) }, // toJSON ham hurmat qilinadi
  ];
  for (const v of samples) assert.equal(toJsonb(v), JSON.stringify(v));
});

test("extractMeta: `position` 79 belgi + emoji — natija to'g'ri shakllangan (BEB-01 aynan shu maydon)", () => {
  const tool = TOOL_BY_ID["resume"];
  const meta = extractMeta(tool, { topic: "Sinov", position: "A".repeat(79) + EMOJI });
  // MUTATSIYA: meta.ts da `safeSlice` o'rniga `.slice(0, 80)` qaytarilsa — qizaradi.
  assert.equal(meta.position.isWellFormed(), true, `position yolg'iz surrogat bilan tugadi: ${JSON.stringify(meta.position)}`);
  assert.equal(meta.position, "A".repeat(79));
});

test("extractMeta: `sourceText` va `udk` chegarasida ham juftlik yorilmaydi", () => {
  const article = TOOL_BY_ID["article"];
  const meta = extractMeta(article, {
    topic: "Sinov",
    sourceText: "s".repeat(23_999) + EMOJI,
    udk: "1".repeat(ARTICLE_LIMITS.udkChars - 1) + EMOJI,
  });
  assert.equal(meta.sourceText.isWellFormed(), true);
  assert.equal(meta.udk.isWellFormed(), true);
});

test("clipTo / splitCsv: emoji kesish nuqtasida bo'lsa ham natija to'g'ri shakllangan", () => {
  // clipTo(t, n) → t.slice(0, n-1) + «…»: n-2 da harf, n-1 da emoji boshi.
  const t = "b".repeat(8) + EMOJI + "tail tail tail";
  const clipped = clipTo(t, 10);
  // MUTATSIYA: slide-limits.ts clipTo `.slice` ga qaytarilsa — qizaradi.
  assert.equal(clipped.isWellFormed(), true, JSON.stringify(clipped));
  const items = splitCsv("c".repeat(9) + EMOJI + ",ikkinchi", 5, 10);
  // MUTATSIYA: slide-params.ts splitCsv `.slice` ga qaytarilsa — qizaradi.
  assert.ok(items.every((s) => s.isWellFormed()), JSON.stringify(items));
});
