import test from "node:test";
import assert from "node:assert/strict";
import {
  ARTICLE_INPUT_LIMITS,
  articleInputFromValues,
  encodeArticleValues,
  normalizeArticlePages,
  normalizeDoi,
  normalizeOrcid,
  parseArticleJson,
  parseUserData,
} from "../lib/generation/article/input.ts";
import { ARTICLE_LIMITS } from "../lib/generation/article/types.ts";
import { ARTICLE_TYPES } from "../lib/generation/article/types-registry.ts";
import { sanitizeValues, MAX_JSON, MAX_FIELD } from "../lib/server/validate.ts";
import { ARTICLE_JSON_FIELDS } from "../lib/generation/article-params.ts";

/** Maqola kirish qatlami (WP1): JSON maydonlar, limitlar, normalizatsiya, teskari yo'l. */

test("articleInputFromValues: tur/profil/hajm/til normallashadi; eski `kind` ko'chadi", () => {
  const a = articleInputFromValues({ topic: "AI", articleType: "review_systematic", pages: "10-15", language: "en", pubProfile: "ieee", citeStyle: "apa7" });
  assert.equal(a.articleType, "review_systematic");
  assert.equal(a.pubProfile, "ieee");
  assert.equal(a.pages, "10-15");
  assert.equal(a.language, "en");
  assert.equal(a.citeStyle, "apa7");

  const legacy = articleInputFromValues({ topic: "AI", kind: "imrad", pages: "3-5", language: "de", author: "Aliyev Ali", degree: "PhD", organization: "TDTU", email: "ali@example.uz" });
  assert.equal(legacy.articleType, "imrad_classic", "eski IMRAD → imrad_classic");
  assert.equal(legacy.pubProfile, "apa", "turning standart profili");
  assert.equal(legacy.language, "uz", "noma'lum til → uz");
  assert.equal(legacy.citeStyle, undefined);
  assert.deepEqual(legacy.authors, [{ name: "Aliyev Ali", degree: "PhD", org: "TDTU", email: "ali@example.uz" }], "eski yassi muallif ko'chadi");

  const bad = articleInputFromValues({ topic: "AI", articleType: "zzz", pubProfile: "zzz", pages: "40-45", citeStyle: "harvard" });
  assert.equal(bad.articleType, "imrad_oak");
  assert.equal(bad.pubProfile, "oak");
  assert.equal(bad.pages, "3-5");
  assert.equal(bad.citeStyle, undefined);
});

test("hajm TURGA moslanadi: tezis 1-2 gina, sharh 5-10 dan boshlab; nomuvofiq → turning birinchi paketi", () => {
  assert.equal(normalizeArticlePages(ARTICLE_TYPES.conference_thesis, "10-15"), "1-2");
  assert.equal(normalizeArticlePages(ARTICLE_TYPES.review_narrative, "1-2"), "5-10");
  assert.equal(normalizeArticlePages(ARTICLE_TYPES.review_narrative, "3-5"), "5-10", "3-5 yo'q — birinchisi");
  assert.equal(normalizeArticlePages(ARTICLE_TYPES.imrad_oak, undefined), "3-5");
  assert.equal(articleInputFromValues({ articleType: "conference_thesis", pages: "10-15" }).pages, "1-2");
});

test("mualliflar: JSON, ≤6, ORCID/email tekshiruvi, bo'sh ism tushadi", () => {
  const rows = [
    { name: "Karimova Dilnoza", org: "TDIU", orcid: "https://orcid.org/0000-0002-1825-0097", email: "d@tsue.uz", degree: "PhD" },
    { name: "", org: "X" },
    { name: "Aliyev Ali", orcid: "12-34", email: "not-an-email" },
    ...Array.from({ length: 8 }, (_, i) => ({ name: `M${i}` })),
  ];
  const a = articleInputFromValues({ authors: JSON.stringify(rows) });
  assert.equal(a.authors.length, ARTICLE_LIMITS.authors);
  assert.deepEqual(a.authors[0], { name: "Karimova Dilnoza", degree: "PhD", org: "TDIU", email: "d@tsue.uz", orcid: "0000-0002-1825-0097" });
  assert.deepEqual(a.authors[1], { name: "Aliyev Ali" }, "yaroqsiz ORCID/email tashlanadi");
  assert.equal(normalizeOrcid("0000-0002-1825-009x"), "0000-0002-1825-009X");
  assert.equal(normalizeOrcid("0000-0002-1825"), "");
});

test("foydalanuvchi manbalari: DOI normallashadi (prefiks, matn ichida), raw saqlanadi, id lar u1..uN, ≤40", () => {
  const rows = [
    { doi: "https://doi.org/10.1186/s40561-023-00260-y" },
    { raw: "Karimov A. Ta'limda AI. — Toshkent: Fan, 2022." },
    { raw: "Smith J. Paper. 2020. doi:10.1000/xyz.1" },
    { title: "Kitob", authors: "Aliyev A., Valiyev V.", year: "2019", venue: "Fan" },
    {},
    ...Array.from({ length: 45 }, (_, i) => ({ raw: `Manba ${i} — qator matni` })),
  ];
  const a = articleInputFromValues({ userRefs: JSON.stringify(rows) });
  assert.equal(a.userRefs.length, ARTICLE_LIMITS.userRefs);
  assert.deepEqual(a.userRefs[0], { id: "u1", doi: "10.1186/s40561-023-00260-y" });
  assert.deepEqual(a.userRefs[1], { id: "u2", raw: "Karimov A. Ta'limda AI. — Toshkent: Fan, 2022." });
  assert.equal(a.userRefs[2].doi, "10.1000/xyz.1", "matn ichidagi DOI ajratiladi");
  assert.deepEqual(a.userRefs[3], { id: "u4", title: "Kitob", authors: ["Aliyev A.", "Valiyev V."], year: 2019, venue: "Fan" });
  assert.equal(a.userRefs[4].id, "u5", "bo'sh qator tushdi, id lar bo'shliqsiz");
  assert.equal(normalizeDoi("doi: 10.1234/abc."), "10.1234/abc");
});

test("kalit so'zlar JSON yoki CSV, ≤12; userData faqat to'liq jadval; figureCount 0–4; research standart true", () => {
  assert.deepEqual(articleInputFromValues({ keywords: '["a","b"]' }).keywords, ["a", "b"]);
  assert.deepEqual(articleInputFromValues({ keywords: "a, b,c" }).keywords, ["a", "b", "c"]);
  assert.equal(articleInputFromValues({ keywords: JSON.stringify(Array.from({ length: 20 }, (_, i) => `k${i}`)) }).keywords.length, ARTICLE_LIMITS.keywords);
  const good = parseUserData('{"categories":["2022","2023","2024"],"series":[{"name":"Talabalar","values":[80,110,120]}],"unit":"nafar"}');
  assert.deepEqual(good, { categories: ["2022", "2023", "2024"], series: [{ name: "Talabalar", values: [80, 110, 120] }], unit: "nafar" });
  assert.equal(parseUserData('{"categories":["a","b"],"series":[{"name":"S","values":[1]}]}'), undefined, "qiymat soni mos emas");
  assert.equal(parseUserData('{"categories":["a"],"series":[{"name":"S","values":[1]}]}'), undefined, "bitta kategoriya — grafik emas");
  assert.equal(parseUserData(""), undefined);
  assert.equal(articleInputFromValues({ figureCount: 9 }).figureCount, ARTICLE_LIMITS.figures);
  assert.equal(articleInputFromValues({ figureCount: -1 }).figureCount, 0);
  assert.equal(articleInputFromValues({}).figureCount, 2);
  assert.equal(articleInputFromValues({}).research, true);
  assert.equal(articleInputFromValues({ research: false }).research, false);
  assert.equal(articleInputFromValues({ udk: "0".repeat(100) }).udk.length, ARTICLE_LIMITS.udkChars);
  assert.equal(articleInputFromValues({ userFacts: "x".repeat(20_000) }).userFacts.length, ARTICLE_LIMITS.userFactsChars);
});

test("kesilgan JSON oxirgi to'liq elementgacha tiklanadi; buzuq — bo'sh, qolgan maydonlar zarar ko'rmaydi", () => {
  const full = JSON.stringify([{ doi: "10.1000/a" }, { raw: "Ikkinchi manba matni" }, { raw: "Uchinchi manba" }]);
  const cut = full.slice(0, full.indexOf("Uchinchi") + 3);
  assert.throws(() => JSON.parse(cut));
  const a = articleInputFromValues({ topic: "Mavzu", userRefs: cut });
  assert.equal(a.userRefs.length, 2);
  assert.equal(a.topic, "Mavzu");
  assert.deepEqual(articleInputFromValues({ userRefs: '[{"doi":"10.1000/a"},' }).userRefs.length, 1, "oxirgi vergul");
  assert.deepEqual(articleInputFromValues({ authors: '[{"na' }).authors, []);
  assert.equal(parseArticleJson("matn", "x"), null);
  // Kesilgan obyekt (userData) ham tiklanadi.
  const obj = '{"categories":["a","b"],"series":[{"name":"S","values":[1,2]},{"name":"T","val';
  const d = parseUserData(obj);
  assert.ok(d && d.series.length === 1, `kesilgan obyekt: ${JSON.stringify(d)}`);
});

test("sanitizeValues: maqola JSON maydonlari 24 000 chegara oladi", () => {
  const long = "x".repeat(30_000);
  const v = sanitizeValues({ ...Object.fromEntries(ARTICLE_JSON_FIELDS.map((f) => [f, long])), topic: long })!;
  for (const f of ARTICLE_JSON_FIELDS) assert.equal(String(v[f]).length, MAX_JSON, `${f}`);
  assert.equal(String(v.topic).length, MAX_FIELD);
  // 40 manba × ~250 belgi 4 000 ga sig'maydi, 24 000 ga sig'adi.
  const big = JSON.stringify(Array.from({ length: ARTICLE_LIMITS.userRefs }, (_, i) => ({ raw: `Muallif ${i} A.B. Uzun sarlavhali maqola nomi ${i}: tahlil va natijalar. — Toshkent: Fan va texnologiya nashriyoti, 2022. — 240 b. Qo'shimcha izoh.` })));
  assert.ok(big.length > MAX_FIELD && big.length <= MAX_JSON, `${big.length}`);
  assert.equal(articleInputFromValues({ userRefs: String(sanitizeValues({ userRefs: big })!.userRefs) }).userRefs.length, ARTICLE_LIMITS.userRefs);
});

test("encodeArticleValues teskari yo'l: qayta o'qilganda kirish o'zgarmaydi", () => {
  const input = articleInputFromValues({
    topic: "Sun'iy intellekt ta'limda",
    articleType: "imrad_oak",
    pubProfile: "oak",
    citeStyle: "gost",
    language: "uz",
    pages: "5-10",
    authors: '[{"name":"Karimova Dilnoza","org":"TDIU","orcid":"0000-0002-1825-0097"}]',
    udk: "004.8",
    keywords: '["ai","ta\'lim","baholash"]',
    userFacts: "120 talaba, 4,1 → 4,6",
    userRefs: '[{"doi":"10.1186/s40561-023-00260-y"},{"raw":"Karimov A. Kitob. 2022."}]',
    userData: '{"categories":["2022","2023"],"series":[{"name":"N","values":[1,2]}]}',
    figureCount: 3,
    research: false,
    extra: "Rasmiy uslub",
  });
  const again = articleInputFromValues(encodeArticleValues(input));
  assert.deepEqual(again, input);
  assert.equal(ARTICLE_INPUT_LIMITS.rawRefChars, 400);
});
