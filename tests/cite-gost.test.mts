import test from "node:test";
import assert from "node:assert/strict";
import { formatGost, formatGostBook, formatGostLaw, formatGostWeb, gostAuthors, normalizePages } from "../lib/generation/cite/gost.ts";
import { formatApa } from "../lib/generation/cite/apa.ts";
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

/* ────────── kitob / normativ hujjat / internet (AUDIT-19 WP-B) ────────── */

const GB: Reference = {
  id: "gb:1",
  kind: "book",
  title: "Ta’limda raqamli texnologiyalar",
  authors: ["Karimov A."],
  year: 2022,
  publisher: "Fan va texnologiya",
  place: "Toshkent",
  pageCount: 240,
  isbn: "9789943570123",
  verified: "googlebooks",
  cited: true,
};

const LAW: Reference = {
  id: "lex:5013009",
  kind: "law",
  title: "Ta’lim to‘g‘risida",
  authors: [],
  issuer: "O‘zbekiston Respublikasi",
  docNo: "O‘RQ-563",
  docDate: "2019-09-20",
  url: "https://lex.uz/docs/5013009",
  accessed: "2026-09-16",
  verified: "lexuz",
  cited: true,
};

const WEB: Reference = {
  id: "w1",
  kind: "web",
  title: "Raqamli ta’lim portali",
  authors: [],
  url: "https://edu.uz/raqamli",
  accessed: "2026-03-12",
  verified: "unverified",
  cited: true,
};

test("formatGostBook: «Muallif. Nomi. – Shahar: Nashriyot, yil. – N b.»; shahar yo'q — element tushadi", () => {
  assert.equal(formatGostBook(GB, "uz"), "Karimov A. Ta’limda raqamli texnologiyalar. – Toshkent: Fan va texnologiya, 2022. – 240 b.");
  assert.equal(formatGostBook(GB, "ru"), "Karimov A. Ta’limda raqamli texnologiyalar. – Toshkent: Fan va texnologiya, 2022. – 240 с.");
  assert.equal(formatGostBook({ ...GB, place: undefined }, "uz"), "Karimov A. Ta’limda raqamli texnologiyalar. – Fan va texnologiya, 2022. – 240 b.");
  assert.equal(formatGostBook({ ...GB, place: undefined, publisher: undefined, pageCount: undefined }, "uz"), "Karimov A. Ta’limda raqamli texnologiyalar. – 2022.");
  assert.ok(!formatGostBook(GB, "uz").includes(": ,"), "bo'sh element yozilmaydi");
});

test("formatGostLaw: qonun / farmon / Prezident qarori / VM qarori; sana, № va lex.uz havolasi", () => {
  assert.equal(
    formatGostLaw({ ...LAW, title: "Ta’lim to‘g‘risidagi Qonun" }, "uz"),
    "Ta’lim to‘g‘risidagi Qonun, 20.09.2019 y., № O‘RQ-563. — https://lex.uz/docs/5013009",
  );
  // Rasmiy nom bo'lmasa — organ va hujjat so'zi qo'shiladi.
  assert.equal(
    formatGostLaw(LAW, "uz"),
    "O‘zbekiston Respublikasining «Ta’lim to‘g‘risida» Qonuni, 20.09.2019 y., № O‘RQ-563. — https://lex.uz/docs/5013009",
  );
  const decree: Reference = { ...LAW, title: "Raqamli O‘zbekiston strategiyasi", issuer: "O‘zbekiston Respublikasi Prezidenti", docNo: "PF-6079", docDate: "2020-10-05" };
  assert.match(formatGostLaw(decree, "uz"), /^O‘zbekiston Respublikasi Prezidentining «Raqamli O‘zbekiston strategiyasi» Farmoni, 05\.10\.2020 y\., № PF-6079\./);
  assert.match(formatGostLaw({ ...decree, docNo: "PQ-4947" }, "uz"), /» Qarori, /);
  const cabinet: Reference = { ...LAW, title: "Oliy ta’lim me’yorlari", issuer: "O‘zbekiston Respublikasi Vazirlar Mahkamasi", docNo: "207-son" };
  assert.match(formatGostLaw(cabinet, "uz"), /^O‘zbekiston Respublikasi Vazirlar Mahkamasining «Oliy ta’lim me’yorlari» Qarori, /);
  // Ruscha: hujjat so'zi boshda.
  assert.match(formatGostLaw({ ...LAW, title: "Об образовании" }, "ru"), /^Закон O‘zbekiston Respublikasi «Об образовании», 20\.09\.2019 г\., № O‘RQ-563\./);
  // Sanasiz/raqamsiz hujjat — bo'sh element yozilmaydi.
  assert.equal(
    formatGostLaw({ ...LAW, docDate: undefined, docNo: undefined, year: undefined }, "uz"),
    "O‘zbekiston Respublikasining «Ta’lim to‘g‘risida» Qonuni. — https://lex.uz/docs/5013009",
  );
});

test("formatGostWeb: «Nomi // URL (Murojaat sanasi: …)»; sana yo'q — qavs ham yo'q", () => {
  assert.equal(formatGostWeb(WEB, "uz"), "Raqamli ta’lim portali // https://edu.uz/raqamli (Murojaat sanasi: 12.03.2026)");
  assert.equal(formatGostWeb(WEB, "ru"), "Raqamli ta’lim portali // https://edu.uz/raqamli (дата обращения: 12.03.2026)");
  assert.equal(formatGostWeb(WEB, "en"), "Raqamli ta’lim portali // https://edu.uz/raqamli (accessed: 12.03.2026)");
  assert.equal(formatGostWeb({ ...WEB, accessed: undefined }, "uz"), "Raqamli ta’lim portali // https://edu.uz/raqamli");
  assert.equal(formatGostWeb({ ...WEB, authors: ["Karimov A."] }, "uz"), "Karimov A. Raqamli ta’lim portali // https://edu.uz/raqamli (Murojaat sanasi: 12.03.2026)");
});

test("formatReference: kind bo'yicha tarmoqlanadi — maqola ro'yxati O'ZGARMAYDI", () => {
  // Maqola: har uslub o'z shaklida (AUDIT-17 xatti-harakati).
  assert.equal(formatReference(ART, "gost", "uz"), formatGost(ART, "uz"));
  assert.equal(formatReference(ART, "apa7", "uz"), formatApa(ART, "uz"));
  // Kitob GOST oilasida alohida shaklda; APA da esa APA kitob shakli.
  assert.equal(formatReference(GB, "gost", "uz"), formatGostBook(GB, "uz"));
  assert.equal(formatReference(GB, "numeric", "uz"), formatGostBook(GB, "uz"));
  assert.equal(formatReference(GB, "apa7", "uz"), formatApa(GB, "uz"));
  // Qonun va internet — uslubdan qat'i nazar o'z shaklida.
  for (const s of ["gost", "numeric", "apa7", "ieee"] as const) {
    assert.equal(formatReference(LAW, s, "uz"), formatGostLaw(LAW, "uz"));
    assert.equal(formatReference(WEB, s, "uz"), formatGostWeb(WEB, "uz"));
  }
});
