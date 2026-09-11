import test from "node:test";
import assert from "node:assert/strict";
import { bibliographicMatch, normalizeDoi, referenceFromCrossref, searchBibliographic, verifyDoi } from "../lib/generation/research/crossref.ts";
import { setSourceCacheStore } from "../lib/generation/research/cache.ts";
import { CROSSREF_BIBLIO, CROSSREF_BIBLIO_MISS, CROSSREF_WORK, stubFetch } from "./helpers/research-fixtures.ts";

/** Crossref: DOI tasdiqlash va erkin matnli manba qidiruvi (Maqola 2, WP1). */

test.beforeEach(() => setSourceCacheStore(null));
test.after(() => setSourceCacheStore(undefined));

test("verifyDoi: /works/{doi} + mailto; javob → Reference(crossref); 404 → null; yaroqsiz DOI tarmoqqa chiqmaydi", async () => {
  const saved = process.env.CROSSREF_MAILTO;
  process.env.CROSSREF_MAILTO = "dev@slaydx.uz";
  try {
    const f = stubFetch({ "api.crossref.org/works/10.1186%2Fs40561-023-00260-y": CROSSREF_WORK });
    const r = await verifyDoi("https://doi.org/10.1186/s40561-023-00260-y", { fetchImpl: f, retryBaseMs: 0 });
    assert.ok(r);
    assert.equal(r.verified, "crossref");
    assert.equal(r.doi, "10.1186/s40561-023-00260-y");
    assert.equal(r.year, 2023);
    assert.equal(r.venue, "Smart Learning Environments");
    assert.deepEqual(r.authors, ["Lin Chien-Chang", "Huang Anna Y. Q."]);
    assert.equal(r.pages, "1-22");
    assert.equal(r.id, "doi:10.1186/s40561-023-00260-y");
    assert.equal(new URL(f.calls[0].url).searchParams.get("mailto"), "dev@slaydx.uz");
    assert.equal(await verifyDoi("10.9999/yo-q", { fetchImpl: f, retryBaseMs: 0 }), null, "404 → null");
    const n = f.calls.length;
    assert.equal(await verifyDoi("bu doi emas", { fetchImpl: f }), null);
    assert.equal(f.calls.length, n, "yaroqsiz DOI — so'rov yuborilmaydi");
  } finally {
    if (saved === undefined) delete process.env.CROSSREF_MAILTO;
    else process.env.CROSSREF_MAILTO = saved;
  }
});

test("normalizeDoi / referenceFromCrossref chekkalari", () => {
  assert.equal(normalizeDoi("DOI: 10.1234/abc.1"), "10.1234/abc.1");
  assert.equal(normalizeDoi("10.1234/abc.1."), "10.1234/abc.1", "oxiridagi nuqta tashlanadi");
  assert.equal(normalizeDoi("https://dx.doi.org/10.1234/ABC"), "10.1234/ABC");
  assert.equal(normalizeDoi("10.12/x"), "", "prefiks 4 raqamdan kam — DOI emas");
  assert.equal(referenceFromCrossref({ DOI: "10.1/x", title: [] }), null, "sarlavhasiz — null");
  assert.equal(referenceFromCrossref(null), null);
  // Nashriyot faqat venue bo'lmaganda (kitob).
  const book = referenceFromCrossref({ DOI: "10.1000/book", title: ["Kitob"], publisher: "Fan" })!;
  assert.equal(book.publisher, "Fan");
  assert.equal(book.venue, undefined);
});

test("searchBibliographic: query.bibliographic; top-1 mos bo'lsa crossref, mos bo'lmasa null", async () => {
  const raw = "Karimov A. Ta’limda raqamli texnologiyalar: pedagogik tahlil. — Toshkent: Pedagogika, 2022.";
  const f = stubFetch({ "query.bibliographic=": CROSSREF_BIBLIO });
  const hit = await searchBibliographic(raw, { fetchImpl: f, retryBaseMs: 0 });
  assert.ok(hit);
  assert.equal(hit.verified, "crossref");
  assert.equal(hit.doi, "10.1234/uzb.2022.017");
  const u = new URL(f.calls[0].url);
  assert.equal(u.searchParams.get("query.bibliographic"), raw);
  assert.equal(u.searchParams.get("rows"), "3");

  const miss = stubFetch({ "query.bibliographic=": CROSSREF_BIBLIO_MISS });
  assert.equal(await searchBibliographic(raw, { fetchImpl: miss, retryBaseMs: 0 }), null, "boshqa maqola — qabul qilinmaydi");
  assert.equal(await searchBibliographic("qisqa", { fetchImpl: miss }), null, "juda qisqa matn — so'rov yo'q");
});

test("bibliographicMatch: sarlavha so'zlari ≥60% yoki muallif+yil", () => {
  const ref = { id: "x", title: "Adaptive learning platforms and student outcomes", authors: ["Karimova Dilnoza"], year: 2021, verified: "crossref" as const, cited: false };
  assert.equal(bibliographicMatch("Karimova D. Adaptive learning platforms and student outcomes. 2021", ref), true);
  assert.equal(bibliographicMatch("Karimova D. Something else entirely. 2021", ref), true, "muallif + yil");
  assert.equal(bibliographicMatch("Karimova D. Something else entirely. 2019", ref), false, "yil mos emas");
  assert.equal(bibliographicMatch("Smith J. Thermal conductivity of graphene. 2021", ref), false);
});
