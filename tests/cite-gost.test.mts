import test from "node:test";
import assert from "node:assert/strict";
import { formatGost, gostAuthors, normalizePages } from "../lib/generation/cite/gost.ts";
import { formatReference } from "../lib/generation/cite/index.ts";
import { parseAuthor } from "../lib/generation/cite/names.ts";
import type { Reference } from "../lib/generation/article/types.ts";

/**
 * ГОСТ 7.1-2003 tavsif (Maqola 2, WP5) — OAK profili ro'yxati.
 *
 * Mutatsiyalar (har biri qizardi):
 *   • «va b.» chegarasi 4 → 5 (`names.length >= 4`) — 4 muallifli manba
 *     to'liq chiqdi, `≥4 → 3 + va b.` testi yiqildi;
 *   • DOI prefiksi «DOI: » → «https://doi.org/» — «DOI: 10.…» testi yiqildi;
 *   • maqola/kitob ajratuvchi «//» → «.» — «// Venue» testi yiqildi;
 *   • `raw` tekshiruvi olib tashlandi — erkin matn testi yiqildi.
 */

const ART: Reference = {
  id: "W1",
  doi: "10.1186/s40561-023-00260-y",
  title: "Artificial intelligence in intelligent tutoring systems",
  authors: ["Lin C.", "Huang A.", "Lu O."],
  year: 2023,
  venue: "Smart Learning Environments",
  pages: "45-67",
  verified: "openalex",
  cited: true,
};

const BOOK: Reference = {
  id: "u1",
  title: "Ta’limda raqamli texnologiyalar.",
  authors: ["Karimov A."],
  year: 2022,
  publisher: "Fan",
  place: "Toshkent",
  pages: "120",
  verified: "user",
  cited: true,
};

test("maqola: Familiya I.O. Sarlavha // Venue. – Yil. – B. 45–67. – DOI: …; sahifa birligi tilga qarab", () => {
  assert.equal(
    formatGost(ART, "uz"),
    "Lin C., Huang A., Lu O. Artificial intelligence in intelligent tutoring systems // Smart Learning Environments. – 2023. – B. 45–67. – DOI: 10.1186/s40561-023-00260-y.",
  );
  assert.ok(formatGost(ART, "ru").includes("– С. 45–67."));
  assert.ok(formatGost(ART, "en").includes("– P. 45–67."));
  // DOI prefiksi aynan «DOI: », https emas.
  assert.match(formatGost(ART, "uz"), /– DOI: 10\.1186\//);
  assert.ok(!formatGost(ART, "uz").includes("doi.org"));
});

test("kitob: Familiya I.O. Sarlavha. – Shahar: Nashriyot, yil. – 120 b.; sarlavha oxiridagi nuqta ikkilanmaydi", () => {
  assert.equal(formatGost(BOOK, "uz"), "Karimov A. Ta’limda raqamli texnologiyalar. – Toshkent: Fan, 2022. – 120 b.");
  assert.equal(formatGost(BOOK, "ru"), "Karimov A. Ta’limda raqamli texnologiyalar. – Toshkent: Fan, 2022. – 120 с.");
  assert.ok(!formatGost(BOOK, "uz").includes(".."));
  // Faqat nashriyot / faqat yil.
  assert.equal(formatGost({ ...BOOK, place: undefined, pages: undefined }, "uz"), "Karimov A. Ta’limda raqamli texnologiyalar. – Fan, 2022.");
  assert.equal(formatGost({ ...BOOK, place: undefined, publisher: undefined, pages: undefined }, "uz"), "Karimov A. Ta’limda raqamli texnologiyalar. – 2022.");
});

test("≥4 muallif → birinchi 3 + «va b.» / «и др.» / «et al.»; 3 muallif to'liq", () => {
  const four = { ...ART, authors: ["Lin C.", "Huang A.", "Lu O.", "Karimova D."] };
  assert.equal(gostAuthors(four, "uz"), "Lin C., Huang A., Lu O. va b.");
  assert.equal(gostAuthors(four, "ru"), "Lin C., Huang A., Lu O. и др.");
  assert.equal(gostAuthors(four, "en"), "Lin C., Huang A., Lu O. et al.");
  assert.equal(gostAuthors(ART, "uz"), "Lin C., Huang A., Lu O.");
  assert.ok(formatGost(four, "uz").startsWith("Lin C., Huang A., Lu O. va b. Artificial"));
});

test("DOI yo'q — URL (gost); yil/sahifa yo'q — element tushadi; muallifsiz — sarlavhadan boshlanadi", () => {
  const noDoi = { ...ART, doi: undefined, url: "https://example.org/p", year: undefined, pages: undefined };
  assert.equal(formatGost(noDoi, "uz"), "Lin C., Huang A., Lu O. Artificial intelligence in intelligent tutoring systems // Smart Learning Environments. – URL: https://example.org/p");
  assert.equal(formatGost({ ...ART, authors: [], doi: undefined, pages: undefined }, "uz"), "Artificial intelligence in intelligent tutoring systems // Smart Learning Environments. – 2023.");
});

test("`raw` (foydalanuvchi erkin matni) `formatReference` orqali o'zgarishsiz — uslubdan qat'i nazar", () => {
  const raw = { ...BOOK, raw: "  Karimov A. Ta’limda AI. — T.: Fan, 2022. — 120 b.  " };
  for (const s of ["gost", "numeric", "apa7", "ieee"] as const) assert.equal(formatReference(raw, s, "uz"), "Karimov A. Ta’limda AI. — T.: Fan, 2022. — 120 b.");
});

test("muallif ismi shakllari: «Lin C.» / «C. Lin» / «Karimova Dilnoza Baxtiyorovna» / «Smith, John» / «Chih-Hung Lin» / «Иванов И.И.»", () => {
  const g = (a: string) => formatGost({ ...ART, authors: [a], doi: undefined, pages: undefined }, "uz").split(" Artificial")[0];
  assert.equal(g("Lin C."), "Lin C.");
  assert.equal(g("C. Lin"), "Lin C.");
  assert.equal(g("Karimova Dilnoza Baxtiyorovna"), "Karimova D.B.");
  assert.equal(g("Smith, John"), "Smith J.");
  assert.equal(g("Chih-Hung Lin"), "Lin C.-H.");
  assert.equal(g("Иванов И.И."), "Иванов И.И.");
  assert.equal(g("Dilnoza Karimova"), "Karimova D.");
  assert.equal(g("Ahmad S."), "Ahmad S.");
  // Crossref «Familiya Ism» tartibi — `verified` bo'yicha.
  assert.deepEqual(parseAuthor("Lin Chih-Hung", "family-first"), { family: "Lin", initials: ["C.-H."] });
  assert.deepEqual(parseAuthor("Lin Chih-Hung"), { family: "Chih-Hung", initials: ["L."] }, "OpenAlex tartibi — ism birinchi");
  assert.equal(formatGost({ ...ART, authors: ["Lin Chih-Hung"], verified: "crossref", doi: undefined, pages: undefined }, "uz").split(" Artificial")[0], "Lin C.-H.");
  // «-in» bilan tugagan ISM familiya deb olinmaydi.
  assert.equal(g("Kevin Martin"), "Martin K.");
});

test("normalizePages: defis → en dash, «pp.»/«с.» prefikslari tushadi", () => {
  assert.equal(normalizePages("45-67"), "45–67");
  assert.equal(normalizePages("pp. 45 — 67"), "45–67");
  assert.equal(normalizePages("120"), "120");
  assert.equal(normalizePages(undefined), "");
});
