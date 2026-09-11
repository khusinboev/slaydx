import test from "node:test";
import assert from "node:assert/strict";
import { apaAuthors, formatApa } from "../lib/generation/cite/apa.ts";
import { orderReferences, planArticle } from "../lib/generation/article/layout.ts";
import { sampleArticleDoc } from "../lib/generation/article/samples.ts";
import type { Reference } from "../lib/generation/article/types.ts";
import type { DocMeta } from "../lib/generation/types.ts";

/**
 * APA 7 ro'yxat satri (Maqola 2, WP5).
 *
 * Mutatsiyalar (har biri qizardi):
 *   • DOI prefiksi `https://doi.org/` → `doi:` — havola testi yiqildi;
 *   • havoladan keyin nuqta qo'shildi — «oxirida nuqta yo'q» testi yiqildi;
 *   • «&» oxirgi muallifdan oldin olib tashlandi — 3 muallif testi yiqildi;
 *   • `orderReferences` alifbo tartibi o'chirildi (uchrash tartibi) —
 *     alifbo testi yiqildi (Ahmad → Karimov → Lin emas, Lin → Ahmad → Karimov).
 */

const ART: Reference = {
  id: "W1",
  doi: "10.1186/s40561-023-00260-y",
  title: "Artificial intelligence in intelligent tutoring systems.",
  authors: ["Lin C.", "Huang A.", "Lu O."],
  year: 2023,
  venue: "Smart Learning Environments",
  pages: "45–67",
  verified: "openalex",
  cited: true,
};

const BOOK: Reference = { id: "u1", title: "Ta’limda raqamli texnologiyalar", authors: ["Karimov A."], year: 2022, publisher: "Fan", place: "Toshkent", pages: "120", verified: "user", cited: true };

test("maqola: Familiya, I. O., & Familiya, I. (2023). Sarlavha. Venue, 45–67. https://doi.org/… — oxirida nuqta yo'q", () => {
  const s = formatApa(ART, "en");
  assert.equal(s, "Lin, C., Huang, A., & Lu, O. (2023). Artificial intelligence in intelligent tutoring systems. Smart Learning Environments, 45–67. https://doi.org/10.1186/s40561-023-00260-y");
  assert.ok(s.startsWith("Lin, C., Huang, A., & Lu, O."));
  assert.ok(!s.endsWith("."), "APA havoladan keyin nuqta qo'ymaydi");
  assert.ok(s.includes(" https://doi.org/10.1186/"), "DOI https://doi.org/ shaklida");
  assert.ok(!/doi:/i.test(s));
});

test("kitob: Familiya, I. (2022). Sarlavha. Nashriyot. — nashr joyi YOZILMAYDI (APA 7), jami sahifa yozilmaydi", () => {
  assert.equal(formatApa(BOOK, "en"), "Karimov, A. (2022). Ta’limda raqamli texnologiyalar. Fan.");
  assert.ok(!formatApa(BOOK, "en").includes("Toshkent"));
  assert.ok(!formatApa(BOOK, "en").includes("120"));
});

test("mualliflar: 1 / 2 / 3 / 7+ (birinchi 6, «…», oxirgisi); bog'lovchi tilga qarab (& / va / и)", () => {
  assert.equal(apaAuthors({ ...ART, authors: ["Lin C."] }, "en"), "Lin, C.");
  assert.equal(apaAuthors({ ...ART, authors: ["Lin C.", "Huang A."] }, "en"), "Lin, C., & Huang, A.");
  assert.equal(apaAuthors(ART, "en"), "Lin, C., Huang, A., & Lu, O.");
  assert.equal(apaAuthors(ART, "uz"), "Lin, C., Huang, A., va Lu, O.");
  assert.equal(apaAuthors(ART, "ru"), "Lin, C., Huang, A., и Lu, O.");
  const seven = { ...ART, authors: ["Aa A.", "Bb B.", "Cc C.", "Dd D.", "Ee E.", "Ff F.", "Gg G."] };
  assert.equal(apaAuthors(seven, "en"), "Aa, A., Bb, B., Cc, C., Dd, D., Ee, E., Ff, F., … Gg, G.");
  assert.equal(apaAuthors({ ...ART, authors: [] }, "en"), "");
});

test("yil yo'q → (n.d.) / (yilsiz) / (б. г.); DOI yo'q → URL; muallifsiz → sarlavha birinchi", () => {
  const nd = { ...ART, year: undefined, doi: undefined, url: "https://example.org/x" };
  assert.equal(formatApa(nd, "en"), "Lin, C., Huang, A., & Lu, O. (n.d.). Artificial intelligence in intelligent tutoring systems. Smart Learning Environments, 45–67. https://example.org/x");
  assert.ok(formatApa(nd, "uz").includes("(yilsiz)."));
  assert.ok(formatApa(nd, "ru").includes("(б. г.)."));
  assert.equal(formatApa({ ...ART, authors: [], doi: undefined, pages: undefined }, "en"), "Artificial intelligence in intelligent tutoring systems. (2023). Smart Learning Environments.");
});

test("ro'yxat alifbo tartibida (planArticle/orderReferences) — apa profilida raqamsiz satr", () => {
  const META = { topic: "T", author: "A", workLabel: "Maqola", language: "uz", toolId: "article" } as unknown as DocMeta;
  const plan = planArticle(sampleArticleDoc(META, { type: "imrad_classic", profile: "apa" }));
  const heads = plan.refs.map((r) => r.text.split(",")[0]);
  assert.deepEqual(heads, ["Ahmad", "Karimov", "Lin"], "alifbo: Ahmad → Karimov → Lin");
  assert.equal(plan.refs[0].line, plan.refs[0].text, "APA satri raqamsiz");
  const sorted = orderReferences([ART, BOOK, { ...ART, id: "W2", authors: ["Ahmad S."] }], "apa7", ["W1", "u1", "W2"]);
  assert.deepEqual(
    sorted.map((r) => r.id),
    ["W2", "u1", "W1"],
  );
});
