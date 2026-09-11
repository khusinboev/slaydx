import test from "node:test";
import assert from "node:assert/strict";
import { abstractFromInvertedIndex, getWork, openAlexId, referenceFromWork, searchWorks, stripDoi } from "../lib/generation/research/openalex.ts";
import { setSourceCacheStore, memorySourceCache } from "../lib/generation/research/cache.ts";
import { OPENALEX_WORKS, stubFetch } from "./helpers/research-fixtures.ts";

/**
 * OpenAlex qatlami (Maqola 2, WP1): URL shakli, `select`, kalit/mailto,
 * javob → `Reference`, retry siyosati. Tarmoq YO'Q — `fetchImpl` stub.
 */

test.beforeEach(() => setSourceCacheStore(null));
test.after(() => setSourceCacheStore(undefined));

test("searchWorks: URL — search/filter/per-page/select, mailto va api_key faqat bor bo'lsa; User-Agent", async () => {
  const saved = { key: process.env.OPENALEX_API_KEY, mail: process.env.OPENALEX_MAILTO };
  try {
    delete process.env.OPENALEX_API_KEY;
    process.env.OPENALEX_MAILTO = "dev@slaydx.uz";
    const f = stubFetch({ "api.openalex.org/works?": OPENALEX_WORKS });
    const refs = await searchWorks("adaptive learning AI", { fetchImpl: f, fromYear: 2018, perPage: 25, retryBaseMs: 0 });
    const u = new URL(f.calls[0].url);
    assert.equal(u.origin + u.pathname, "https://api.openalex.org/works");
    assert.equal(u.searchParams.get("search"), "adaptive learning AI");
    assert.equal(u.searchParams.get("filter"), "publication_year:>2017,has_doi:true");
    assert.equal(u.searchParams.get("per-page"), "25");
    assert.equal(u.searchParams.get("select"), "id,title,publication_year,doi,authorships,primary_location,cited_by_count,abstract_inverted_index");
    assert.equal(u.searchParams.get("mailto"), "dev@slaydx.uz");
    assert.equal(u.searchParams.has("api_key"), false, "kalit yo'q — parametr ham yo'q (kalitsiz ishlaydi)");
    const headers = f.calls[0].init?.headers as Record<string, string>;
    assert.equal(headers["User-Agent"], "SlaydX/1.0 (mailto:dev@slaydx.uz)");
    // 5 xom yozuvdan sarlavhasiz tushadi (dedup pipeline'da).
    assert.equal(refs.length, 4);
    // Kalit bo'lsa qo'shiladi.
    process.env.OPENALEX_API_KEY = "k-123";
    await searchWorks("x", { fetchImpl: f, retryBaseMs: 0 });
    assert.equal(new URL(f.calls[1].url).searchParams.get("api_key"), "k-123");
  } finally {
    if (saved.key === undefined) delete process.env.OPENALEX_API_KEY;
    else process.env.OPENALEX_API_KEY = saved.key;
    if (saved.mail === undefined) delete process.env.OPENALEX_MAILTO;
    else process.env.OPENALEX_MAILTO = saved.mail;
  }
});

test("referenceFromWork: id `W…`, DOI prefikssiz, mualliflar ≤6, venue, citedBy, abstract ≤600", () => {
  const r = referenceFromWork(OPENALEX_WORKS.results[0] as never)!;
  assert.equal(r.id, "W2741809807");
  assert.equal(r.doi, "10.1186/s40561-023-00260-y");
  assert.equal(r.verified, "openalex");
  assert.equal(r.cited, false);
  assert.equal(r.year, 2023);
  assert.equal(r.venue, "Smart Learning Environments");
  assert.deepEqual(r.authors, ["Chien-Chang Lin", "Anna Y. Q. Huang", "Owen H. T. Lu"]);
  assert.equal(r.citedBy, 312);
  assert.equal(r.abstract, "Artificial intelligence improves tutoring systems");
  assert.equal(r.url, "https://doi.org/10.1186/s40561-023-00260-y");
  // DOI bo'lmasa url ham bo'lmaydi; sarlavhasiz — null.
  assert.equal(referenceFromWork(OPENALEX_WORKS.results[3] as never), null);
  const many = { ...OPENALEX_WORKS.results[0], authorships: Array.from({ length: 9 }, (_, i) => ({ author: { display_name: `A${i}` } })) };
  assert.equal(referenceFromWork(many as never)!.authors.length, 6);
});

test("abstractFromInvertedIndex: pozitsiya bo'yicha tiklanadi, 600 belgida so'z chegarasida kesiladi", () => {
  assert.equal(abstractFromInvertedIndex({ b: [1], a: [0], c: [2] }), "a b c");
  assert.equal(abstractFromInvertedIndex(null), "");
  const long: Record<string, number[]> = {};
  for (let i = 0; i < 200; i++) long[`word${i}`] = [i];
  const t = abstractFromInvertedIndex(long);
  assert.ok(t.length <= 601 && t.endsWith("…"), `${t.length}`);
  assert.ok(!/word\d+w/.test(t), "so'z o'rtasidan kesilmaydi");
});

test("openAlexId / stripDoi normalizatsiyasi", () => {
  assert.equal(openAlexId("https://openalex.org/W2741809807"), "W2741809807");
  assert.equal(openAlexId("w2741809807"), "W2741809807");
  assert.equal(openAlexId("A123"), "");
  assert.equal(stripDoi("https://doi.org/10.1186/x"), "10.1186/x");
  assert.equal(stripDoi("doi:10.1186/x"), "10.1186/x");
  assert.equal(stripDoi("not a doi"), "");
});

test("retry: 429 → 200 ikkinchi urinishda; 400 qayta urinilmaydi; 5xx uch urinishdan keyin bo'sh", async () => {
  const f = stubFetch({ "api.openalex.org/works?": [{ __status: 429 }, OPENALEX_WORKS] });
  const refs = await searchWorks("q", { fetchImpl: f, retryBaseMs: 0 });
  assert.equal(refs.length, 4);
  assert.equal(f.calls.length, 2, "429 dan keyin bitta qayta urinish");

  const bad = stubFetch({ "api.openalex.org/works?": { __status: 400 } });
  assert.deepEqual(await searchWorks("q", { fetchImpl: bad, retryBaseMs: 0 }), []);
  assert.equal(bad.calls.length, 1, "4xx — qayta urinilmaydi");

  const down = stubFetch({ "api.openalex.org/works?": { __status: 503 } });
  assert.deepEqual(await searchWorks("q", { fetchImpl: down, retryBaseMs: 0 }), []);
  assert.equal(down.calls.length, 3, "2 retry = jami 3 urinish");
});

test("getWork: W id va DOI bo'yicha; 404 → null; kesh ikkinchi chaqiruvni tarmoqqa yubormaydi", async () => {
  const store = memorySourceCache();
  setSourceCacheStore(store);
  const f = stubFetch({ "/works/W2741809807": OPENALEX_WORKS.results[0], "/works/https%3A%2F%2Fdoi.org%2F10.3390%2Fapp13116716": OPENALEX_WORKS.results[1] });
  const a = await getWork("W2741809807", { fetchImpl: f, retryBaseMs: 0 });
  assert.equal(a?.title.startsWith("Artificial intelligence"), true);
  const b = await getWork("https://doi.org/10.3390/app13116716", { fetchImpl: f, retryBaseMs: 0 });
  assert.equal(b?.id, "W4385000001");
  assert.equal(await getWork("W0000000000", { fetchImpl: f, retryBaseMs: 0 }), null);
  assert.equal(await getWork("nope", { fetchImpl: f, retryBaseMs: 0 }), null);
  const n = f.calls.length;
  await getWork("W2741809807", { fetchImpl: f, retryBaseMs: 0 });
  assert.equal(f.calls.length, n, "kesh: qayta so'rov tarmoqqa chiqmaydi");
  assert.ok(store.map.has("openalex:W2741809807"));
});
