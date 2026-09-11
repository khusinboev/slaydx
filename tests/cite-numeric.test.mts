import test from "node:test";
import assert from "node:assert/strict";
import { formatNumeric } from "../lib/generation/cite/numeric.ts";
import { formatGost } from "../lib/generation/cite/gost.ts";
import { formatReference } from "../lib/generation/cite/index.ts";
import type { Reference } from "../lib/generation/article/types.ts";

/**
 * Raqamli (universitet/konferensiya) ro'yxat satri (Maqola 2, WP5) —
 * GOST tavsifi, DOI ixtiyoriy, URL yo'q.
 *
 * Mutatsiya: `formatGost(ref, lang, { url: false })` → `{ url: true }` —
 * «URL yozilmaydi» testi qizardi; DOI shartini olib tashlash — «DOI bo'lsa
 * yoziladi» testi qizardi.
 */

const ART: Reference = {
  id: "W1",
  doi: "10.1186/s40561-023-00260-y",
  title: "Artificial intelligence in intelligent tutoring systems",
  authors: ["Lin C.", "Huang A.", "Lu O.", "Karimova D."],
  year: 2023,
  venue: "Smart Learning Environments",
  pages: "45–67",
  url: "https://doi.org/10.1186/s40561-023-00260-y",
  verified: "crossref",
  cited: true,
};

const BOOK: Reference = { id: "u1", title: "Ta’limda raqamli texnologiyalar", authors: ["Karimov A."], year: 2022, publisher: "Fan", place: "Toshkent", pages: "120", verified: "user", cited: true };

test("maqola: Familiya I.O. Sarlavha // Venue. – Yil. – B. 45–67. – DOI bo'lsa yoziladi; 4+ muallif → va b.", () => {
  assert.equal(formatNumeric(ART, "uz"), "Lin C., Huang A., Lu O. va b. Artificial intelligence in intelligent tutoring systems // Smart Learning Environments. – 2023. – B. 45–67. – DOI: 10.1186/s40561-023-00260-y.");
  assert.equal(formatNumeric(ART, "uz"), formatGost(ART, "uz"), "DOI li manba GOST bilan bir xil");
});

test("DOI yo'q — URL YOZILMAYDI (GOST'da yoziladi)", () => {
  const noDoi = { ...ART, doi: undefined, url: "https://example.org/p" };
  assert.equal(formatNumeric(noDoi, "uz"), "Lin C., Huang A., Lu O. va b. Artificial intelligence in intelligent tutoring systems // Smart Learning Environments. – 2023. – B. 45–67.");
  assert.ok(!formatNumeric(noDoi, "uz").includes("URL"));
  assert.ok(formatGost(noDoi, "uz").includes("– URL: https://example.org/p"));
});

test("kitob va `raw`; `formatReference` numeric uslubi", () => {
  assert.equal(formatNumeric(BOOK, "uz"), "Karimov A. Ta’limda raqamli texnologiyalar. – Toshkent: Fan, 2022. – 120 b.");
  assert.equal(formatReference(BOOK, "numeric", "ru"), "Karimov A. Ta’limda raqamli texnologiyalar. – Toshkent: Fan, 2022. – 120 с.");
  assert.equal(formatReference({ ...BOOK, raw: "Xom satr." }, "numeric", "uz"), "Xom satr.");
});
