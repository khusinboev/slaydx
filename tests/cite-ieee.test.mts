import test from "node:test";
import assert from "node:assert/strict";
import { formatIeee, ieeeAuthors } from "../lib/generation/cite/ieee.ts";
import { formatReference } from "../lib/generation/cite/index.ts";
import type { Reference } from "../lib/generation/article/types.ts";

/**
 * IEEE ro'yxat satri (Maqola 2, WP5).
 *
 * Mutatsiyalar (har biri qizardi):
 *   • «et al.» chegarasi >6 → >3 — 4 muallifli manba «et al.» bo'lib, to'liq ro'yxat testi yiqildi;
 *   • «doi: » → «DOI: » — kichik harf testi yiqildi;
 *   • sarlavha qo'shtirnog'idan vergul tashqariga chiqarildi («Sarlavha”,») — “…,” testi yiqildi;
 *   • satr oxiridagi nuqta olib tashlandi — «. bilan tugaydi» testi yiqildi.
 */

const ART: Reference = {
  id: "W1",
  doi: "10.1186/s40561-023-00260-y",
  title: "Artificial intelligence in intelligent tutoring systems",
  authors: ["Lin C.", "Huang A.", "Lu O."],
  year: 2023,
  venue: "Smart Learning Environments",
  pages: "45–67",
  verified: "openalex",
  cited: true,
};

const BOOK: Reference = { id: "u1", title: "Ta’limda raqamli texnologiyalar", authors: ["Karimov A."], year: 2022, publisher: "Fan", place: "Toshkent", verified: "user", cited: true };

test("maqola: I. O. Familiya, “Sarlavha,” Venue, pp. 45–67, 2023, doi: …. — vergul qo'shtirnoq ICHIDA, doi kichik harf, nuqta bilan tugaydi", () => {
  const s = formatIeee(ART);
  assert.equal(s, "C. Lin, A. Huang, and O. Lu, “Artificial intelligence in intelligent tutoring systems,” Smart Learning Environments, pp. 45–67, 2023, doi: 10.1186/s40561-023-00260-y.");
  assert.ok(s.includes("systems,” Smart"), "vergul qo'shtirnoq ichida");
  assert.ok(s.includes(", doi: 10."), "doi kichik harfda");
  assert.ok(s.endsWith("."), "IEEE satri nuqta bilan tugaydi");
  // Bitta sahifa — «p.», DOI yo'q + URL — [Online]. Available:
  assert.ok(formatIeee({ ...ART, pages: "12" }).includes(", p. 12, 2023"));
  assert.equal(formatIeee({ ...ART, doi: undefined, url: "https://e.org/x", pages: undefined }), "C. Lin, A. Huang, and O. Lu, “Artificial intelligence in intelligent tutoring systems,” Smart Learning Environments, 2023, [Online]. Available: https://e.org/x.");
});

test("kitob: I. Familiya, Sarlavha. Shahar: Nashriyot, yil.", () => {
  assert.equal(formatIeee(BOOK), "A. Karimov, Ta’limda raqamli texnologiyalar. Toshkent: Fan, 2022.");
  assert.equal(formatIeee({ ...BOOK, place: undefined, publisher: undefined, year: undefined }), "A. Karimov, Ta’limda raqamli texnologiyalar.");
});

test("mualliflar: 1 / 2 («A and B») / 3+ (Oxford vergul) / 7+ → «birinchi et al.»; 4–6 to'liq", () => {
  assert.equal(ieeeAuthors({ ...ART, authors: ["Lin C."] }), "C. Lin");
  assert.equal(ieeeAuthors({ ...ART, authors: ["Lin C.", "Huang A."] }), "C. Lin and A. Huang");
  assert.equal(ieeeAuthors(ART), "C. Lin, A. Huang, and O. Lu");
  const four = { ...ART, authors: ["Lin C.", "Huang A.", "Lu O.", "Karimova D."] };
  assert.equal(ieeeAuthors(four), "C. Lin, A. Huang, O. Lu, and D. Karimova", "IEEE 4–6 muallifni to'liq yozadi");
  const seven = { ...ART, authors: ["Lin C.", "Huang A.", "Lu O.", "Karimova D.", "Smith J.", "Ilyin P.", "Last Z."] };
  assert.equal(ieeeAuthors(seven), "C. Lin et al.");
  assert.equal(ieeeAuthors({ ...ART, authors: [] }), "");
  assert.ok(formatIeee({ ...ART, authors: [] }).startsWith("“Artificial"));
});

test("formatReference(…, 'ieee') tilga bog'liq emas; `raw` o'zgarishsiz", () => {
  assert.equal(formatReference(ART, "ieee", "uz"), formatReference(ART, "ieee", "en"));
  assert.equal(formatReference({ ...ART, raw: "Xom. 2020." }, "ieee", "en"), "Xom. 2020.");
});
