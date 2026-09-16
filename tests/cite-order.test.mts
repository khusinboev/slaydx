import test from "node:test";
import assert from "node:assert/strict";
import { orderUzReferences, sortKeyOf, uzGroupOf } from "../lib/generation/cite/order.ts";
import type { Reference } from "../lib/generation/types.ts";

/**
 * Adabiyotlar ro'yxati TARTIBI — O'zbekiston qoidasi (AUDIT-19 WP-B):
 * qonun → Prezident hujjatlari → VM → vazirlik → kitob → maqola →
 * statistika → internet; har guruh ichida alifbo (kirill lotinga
 * o'girilib solishtiriladi).
 *
 * Mutatsiyalar (har biri qizardi):
 *   • guruh tartibi teskari qilindi (`UZ_GROUPS` aylantirildi) — «guruh
 *     tartibi» testi yiqildi;
 *   • `sortKeyOf` transliteratsiyasiz qoldirildi — kirill/lotin alifbo testi yiqildi;
 *   • `uzGroupOf` da Prezident hujjatlari «law» guruhiga qo'shildi — 1↔2 testi yiqildi;
 *   • `n` qayta berilmadi (eski `n` qoldi) — raqamlash testi yiqildi.
 */

const ref = (over: Partial<Reference> & { id: string; title: string }): Reference => ({
  authors: [],
  verified: "unverified",
  cited: true,
  ...over,
});

const LAW = ref({ id: "lex:1", kind: "law", title: "Ta’lim to‘g‘risidagi Qonun", docNo: "O‘RQ-563", issuer: "O‘zbekiston Respublikasi", url: "https://lex.uz/docs/1", verified: "lexuz" });
const DECREE = ref({ id: "lex:2", kind: "law", title: "Raqamli O‘zbekiston strategiyasi", docNo: "PF-6079", issuer: "O‘zbekiston Respublikasi Prezidenti", url: "https://lex.uz/docs/2", verified: "lexuz" });
const CABINET = ref({ id: "lex:3", kind: "law", title: "Oliy ta’lim tizimi qarori", docNo: "207-son", issuer: "O‘zbekiston Respublikasi Vazirlar Mahkamasi", url: "https://lex.uz/docs/3", verified: "lexuz" });
const MINISTRY = ref({ id: "lex:4", kind: "law", title: "Uslubiy ko‘rsatma", docNo: "11-son", issuer: "Oliy ta’lim, fan va innovatsiyalar vazirligi", url: "https://lex.uz/docs/4", verified: "lexuz" });
const BOOK = ref({ id: "gb:1", kind: "book", title: "Pedagogika nazariyasi", authors: ["Tursunov I."], isbn: "9789943000001", verified: "googlebooks" });
const ART = ref({ id: "W1", title: "Adaptive learning", authors: ["Lin C."], doi: "10.1/a", verified: "openalex" });
const STAT = ref({ id: "s1", kind: "web", title: "Ta’lim sohasi statistik to‘plami", publisher: "Statistika qo‘mitasi", url: "https://stat.uz/x", accessed: "2026-03-12" });
const WEB = ref({ id: "w1", kind: "web", title: "UNESCO sahifasi", url: "https://unesco.org/x", accessed: "2026-03-12" });

test("guruh tartibi: qonun → Prezident → VM → vazirlik → kitob → maqola → statistika → internet", () => {
  assert.deepEqual(
    [LAW, DECREE, CABINET, MINISTRY, BOOK, ART, STAT, WEB].map(uzGroupOf),
    ["law", "president", "cabinet", "ministry", "book", "article", "statistics", "web"],
  );
  // Aralash kelgan ro'yxat to'g'ri tartibga tushadi.
  const out = orderUzReferences([WEB, ART, BOOK, MINISTRY, CABINET, DECREE, LAW, STAT]);
  assert.deepEqual(out.map((r) => r.id), ["lex:1", "lex:2", "lex:3", "lex:4", "gb:1", "W1", "s1", "w1"]);
});

test("Prezident qarori (PQ/ПП) ham 2-guruhda; raqamsiz hujjat organ bo'yicha", () => {
  assert.equal(uzGroupOf({ ...DECREE, docNo: "PQ-4947" }), "president");
  assert.equal(uzGroupOf({ ...DECREE, docNo: "ПП-4947" }), "president");
  assert.equal(uzGroupOf({ ...DECREE, docNo: undefined }), "president", "raqamsiz — issuer «Prezidenti»");
  assert.equal(uzGroupOf({ ...CABINET, docNo: undefined }), "cabinet");
  assert.equal(uzGroupOf({ ...LAW, docNo: "ЗРУ-563" }), "law");
});

test("`n` guruh tartibida qayta beriladi va kirish massivi o'zgarmaydi", () => {
  const input = [WEB, LAW, ART];
  const before = JSON.stringify(input);
  const out = orderUzReferences(input.map((r) => ({ ...r, n: 99 })));
  assert.deepEqual(out.map((r) => r.n), [1, 2, 3]);
  assert.deepEqual(out.map((r) => r.id), ["lex:1", "W1", "w1"]);
  assert.equal(JSON.stringify(input), before, "kirish massivi tegilmaydi");
});

test("guruh ichida alifbo — muallif familiyasi bo'yicha, muallifsizda sarlavha", () => {
  const b1 = ref({ id: "gb:a", kind: "book", title: "Zamonaviy ta’lim", authors: ["Yusupov A."] });
  const b2 = ref({ id: "gb:b", kind: "book", title: "Metodika", authors: ["Abdullayev B."] });
  const b3 = ref({ id: "gb:c", kind: "book", title: "Boshlang‘ich ta’lim" });
  const out = orderUzReferences([b1, b2, b3]);
  assert.deepEqual(out.map((r) => r.id), ["gb:b", "gb:c", "gb:a"], "Abdullayev < Boshlang‘ich < Yusupov");
});

test("kirill muallif lotinga o'girilib solishtiriladi — ro'yxatning ikki uchida qolmaydi", () => {
  const cyr = ref({ id: "gb:cyr", kind: "book", title: "Педагогика", authors: ["Бобоев Б."] });
  const lat = ref({ id: "gb:lat", kind: "book", title: "Andragogika", authors: ["Aliyev A."] });
  const lat2 = ref({ id: "gb:lat2", kind: "book", title: "Ta’lim", authors: ["Choriyev C."] });
  assert.equal(sortKeyOf(cyr), "boboyev");
  const out = orderUzReferences([lat2, cyr, lat]);
  assert.deepEqual(out.map((r) => r.id), ["gb:lat", "gb:cyr", "gb:lat2"], "Aliyev < Boboyev (Бобоев) < Choriyev");
});

test("statistik to'plam internetdan OLDIN (7-guruh), oddiy sayt oxirida", () => {
  const out = orderUzReferences([WEB, STAT]);
  assert.deepEqual(out.map((r) => r.id), ["s1", "w1"]);
  assert.equal(uzGroupOf({ ...WEB, title: "Yillik hisobot 2025" }), "statistics");
  assert.equal(uzGroupOf({ ...WEB, publisher: "Davlat statistika qo‘mitasi" }), "statistics");
});

test("kind bo'lmagan eski yozuvlar: DOI → maqola, ISBN → kitob, lex.uz url → qonun", () => {
  assert.equal(uzGroupOf(ref({ id: "x1", title: "t", doi: "10.1/a" })), "article");
  assert.equal(uzGroupOf(ref({ id: "x2", title: "t", isbn: "9789943000001" })), "book");
  assert.equal(uzGroupOf(ref({ id: "x3", title: "t", url: "https://lex.uz/docs/9" })), "law");
  assert.equal(uzGroupOf(ref({ id: "x4", title: "t", url: "https://example.org/a" })), "web");
  assert.equal(uzGroupOf(ref({ id: "x5", title: "t", verified: "openalex", url: "https://example.org/a" })), "article", "ilmiy manba internetga tushmaydi");
});

test("barqarorlik: bir xil kalitli yozuvlar kirish tartibini saqlaydi", () => {
  const a = ref({ id: "gb:1", kind: "book", title: "Bir xil", authors: ["Aliyev A."] });
  const b = ref({ id: "gb:2", kind: "book", title: "Bir xil", authors: ["Aliyev A."] });
  assert.deepEqual(orderUzReferences([a, b]).map((r) => r.id), ["gb:1", "gb:2"]);
  assert.deepEqual(orderUzReferences([b, a]).map((r) => r.id), ["gb:2", "gb:1"]);
});
