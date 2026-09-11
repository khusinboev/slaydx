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

test("o'z lug'ati uchun o'rta chegara: MAX_FIELD dan katta, MAX_SOURCE dan kichik", async () => {
  const { MAX_MID } = await import("../lib/server/validate.ts");
  /*
   * `userGlossary` (Tarjimon 2) HAR partiyaning promptiga tushadi, ya'ni
   * uzunligi partiyalar soniga ko'paytiriladi — `MAX_SOURCE` unga
   * ortiqcha. Lekin 4 000 belgi ~100 atama, texnik hujjatga kam.
   */
  assert.ok(MAX_MID > MAX_FIELD && MAX_MID < MAX_SOURCE, `MAX_MID: ${MAX_MID}`);
  const out = sanitizeValues({ userGlossary: "g".repeat(MAX_MID + 1_000) });
  assert.equal(String(out!.userGlossary).length, MAX_MID);
  // Boshqa maydon bu chegarani MERSMAYDI — oddiy maydon oddiy qoladi.
  assert.equal(String(sanitizeValues({ topic: "t".repeat(MAX_MID) })!.topic).length, MAX_FIELD);
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

test("tarjima chegarasi: xato xabari kesilgan matnni tan oladi", async () => {
  const { sanitizeValues } = await import("../lib/server/validate.ts");
  const { preflightError, TOOL_BY_ID, TRANSLATION_MAX_CHARS, MAX_SOURCE_CHARS } = await import(
    "../lib/tools.ts"
  );

  /*
   * AYNAN N-5 (Sprint 14). Uch chegara uch faylda mustaqil turardi:
   *   /api/extract    200 000 → foydalanuvchiga «150 000 belgi» deb yozardi
   *   sanitizeValues   60 000 → shu yerda JIM kesilardi
   *   preflightError   48 000 → «Matn juda uzun: 60 000 belgi» deb rad etardi
   * Xatodagi son foydalanuvchi ko'rgan songa hech qachon mos kelmasdi.
   */

  /*
   * Tarjimon 2 da ikkalasi 200 000 ga TENGLASHTIRILDI. Munosabat `<=`
   * bo'lib qoladi va u hamon mantiqiy shart: xom shift tarjima
   * chegarasidan KICHIK bo'lsa, chegara ichidagi matn ham jim kesilib,
   * «juda uzun» xatosi hech qachon chiqmasdi — foydalanuvchi yarim
   * hujjat tarjimasini to'liq deb olardi.
   */
  assert.ok(
    TRANSLATION_MAX_CHARS <= MAX_SOURCE_CHARS,
    "tarjima chegarasi xom shiftdan katta bo'lmasligi kerak",
  );

  const tool = TOOL_BY_ID.translation;

  // 1) Chegara ichidagi matn o'tadi.
  assert.equal(preflightError(tool, { sourceText: "a".repeat(TRANSLATION_MAX_CHARS) }), null);

  // 2) Chegaradan oz oshgani — ANIQ son bilan rad etiladi.
  const slightly = TRANSLATION_MAX_CHARS + 1;
  const exact = preflightError(tool, { sourceText: "a".repeat(slightly) });
  assert.ok(exact?.includes(slightly.toLocaleString("uz-UZ")), `aniq son kutilgan: ${exact}`);
  assert.ok(!exact?.includes("dan ortiq"), "kesilmagan matnda «dan ortiq» bo'lmasligi kerak");

  assert.ok(
    exact?.includes(TRANSLATION_MAX_CHARS.toLocaleString("uz-UZ")),
    "xabar haqiqiy chegarani aytishi kerak",
  );

  /*
   * 3) Serverga KELIB TUSHGAN yo'l: 250 000 belgi avval `sanitizeValues`
   *    da AYNAN chegaraga kesiladi. Ikkalasi teng bo'lgani uchun natija
   *    o'tadi — va bu to'g'ri: narx ham SHU kesilgan uzunlikdan
   *    hisoblanadi, ya'ni foydalanuvchi olmagan narsasi uchun to'lamaydi.
   *    Ortiqcha matnni klient oldindan ushlaydi (formada to'liq uzunlik
   *    bor, WP4).
   */
  const huge = sanitizeValues({ sourceText: "a".repeat(250_000) });
  assert.ok(huge, "sanitizeValues obyekt qaytarishi kerak");
  assert.equal(String(huge.sourceText).length, MAX_SOURCE_CHARS, "xom shiftda kesilishi kerak");
  assert.equal(preflightError(tool, huge), null, "kesilgan matn aynan chegaraga teng — o'tishi kerak");
});

test("Maqola 2: ARTICLE_JSON_FIELDS (authors/userRefs/keywords/userData) MAX_JSON (24 000) chegarasida", async () => {
  const { MAX_JSON } = await import("../lib/server/validate.ts");
  const { ARTICLE_JSON_FIELDS } = await import("../lib/generation/article-params.ts");

  /*
   * Rezyume bilan bir naqsh (B-3): mualliflar/manbalar/kalit so'zlar/jadval
   * ro'yxatlari JSON SATRI bo'lib keladi — 40 ta manba qatori 4 000
   * belgilik `MAX_FIELD` ga sig'maydi. Ro'yxat `article-params.ts` dan
   * import qilinadi — shu yerda qo'lda qaytarilmaydi, aks holda yangi
   * JSON maydon qo'shilganda jim kesilib qolardi.
   */
  assert.deepEqual([...ARTICLE_JSON_FIELDS].sort(), ["authors", "keywords", "userData", "userRefs"]);

  for (const field of ARTICLE_JSON_FIELDS) {
    const out = sanitizeValues({ [field]: "a".repeat(MAX_JSON + 5_000) });
    assert.equal(String(out![field]).length, MAX_JSON, `${field}: MAX_JSON chegarasida kesilishi kerak`);
  }
  // Oddiy maydon (masalan `udk`) bu kengaytirilgan chegaraga TUSHMAYDI.
  assert.equal(String(sanitizeValues({ udk: "u".repeat(MAX_JSON) })!.udk).length, MAX_FIELD);
});
