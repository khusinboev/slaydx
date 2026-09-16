import test from "node:test";
import assert from "node:assert/strict";
import { BOOKS_BY_ISBN, BOOKS_VOLUMES, stubFetch } from "./helpers/research-fixtures.ts";
import { isbnOf, normalizeIsbn, referenceFromVolume, searchBooks, verifyIsbn, yearOf } from "../lib/generation/research/googlebooks.ts";
import { memorySourceCache, setSourceCacheStore } from "../lib/generation/research/cache.ts";
import { dedupeReferences } from "../lib/generation/research/pipeline.ts";
import { kindOf } from "../lib/generation/types.ts";

/**
 * Google Books qatlami (Talaba ishlari 2, AUDIT-19 WP-B): URL shakli,
 * kalitsiz ishlash, javob → `Reference` (`kind:"book"`), ISBN_13 ustunligi,
 * kesh va foydalanuvchi ISBN ini tasdiqlash. Tarmoq YO'Q — `fetchImpl` stub.
 *
 * Mutatsiyalar (har biri qizardi):
 *   • `isbnOf` da ISBN_13 → ISBN_10 ustun qilindi — «ISBN_13 ustun» testi yiqildi;
 *   • `key` parametri kalitsiz ham qo'shildi — «kalitsiz URL» testi yiqildi;
 *   • `cached(...)` olib tashlanib to'g'ridan-to'g'ri `getJson` chaqirildi —
 *     «kesh: ikkinchi so'rovda fetch yo'q» testi yiqildi;
 *   • `verifyIsbn` noto'g'ri ISBN ni ham qidiradigan qilindi — «noto'g'ri ISBN → null» yiqildi.
 */

test.beforeEach(() => setSourceCacheStore(null));
test.after(() => setSourceCacheStore(undefined));

const KEY_ENV = "GOOGLE_BOOKS_API_KEY";

function withoutKey<T>(fn: () => T): T {
  const saved = process.env[KEY_ENV];
  delete process.env[KEY_ENV];
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env[KEY_ENV];
    else process.env[KEY_ENV] = saved;
  }
}

test("searchBooks: URL — q/maxResults/printType/langRestrict; kalitsiz ham ishlaydi, kalit bo'lsa qo'shiladi", async () => {
  await withoutKey(async () => {
    const f = stubFetch({ "googleapis.com/books/v1/volumes": BOOKS_VOLUMES });
    await searchBooks("ta'lim texnologiyalari", { fetchImpl: f, lang: "uz", retryBaseMs: 0 });
    const u = new URL(f.calls[0].url);
    assert.equal(u.origin + u.pathname, "https://www.googleapis.com/books/v1/volumes");
    assert.equal(u.searchParams.get("q"), "ta'lim texnologiyalari");
    assert.equal(u.searchParams.get("maxResults"), "10");
    assert.equal(u.searchParams.get("printType"), "books");
    assert.equal(u.searchParams.get("langRestrict"), "uz");
    assert.equal(u.searchParams.has("key"), false, "kalit yo'q — parametr ham yo'q (kalitsiz ishlaydi)");

    process.env[KEY_ENV] = "gb-key-1";
    await searchBooks("boshqa mavzu", { fetchImpl: f, retryBaseMs: 0 });
    const u2 = new URL(f.calls[1].url);
    assert.equal(u2.searchParams.get("key"), "gb-key-1");
    assert.equal(u2.searchParams.has("langRestrict"), false, "til berilmasa langRestrict yo'q");
  });
});

test("referenceFromVolume: kind/verified/id, sarlavha+subtitle, muallif, nashriyot, yil, pageCount, url", () => {
  const r = referenceFromVolume(BOOKS_VOLUMES.items[0] as never)!;
  assert.equal(r.id, "gb:vol_ta_lim");
  assert.equal(r.kind, "book");
  assert.equal(r.verified, "googlebooks");
  assert.equal(r.cited, false);
  assert.equal(r.title, "Ta’limda raqamli texnologiyalar: darslik");
  assert.deepEqual(r.authors, ["Karimov A.", "Yusupova D."]);
  assert.equal(r.publisher, "Fan va texnologiya");
  assert.equal(r.year, 2022);
  assert.equal(r.pageCount, 240);
  assert.equal(r.url, "https://books.google.com/books/about/?id=vol_ta_lim");
  // `kindOf` ham «book» beradi (ISBN bo'yicha, `kind` bo'lmaganda ham).
  assert.equal(kindOf({ ...r, kind: undefined }), "book");
  // Sarlavhasiz yozuv — ro'yxatga tushmaydi.
  assert.equal(referenceFromVolume(BOOKS_VOLUMES.items[2] as never), null);
  assert.equal(referenceFromVolume(null), null);
});

test("ISBN_13 ustun; ISBN_10 faqat 13 yo'q bo'lsa; defis/bo'shliq tushadi; noto'g'ri ISBN → \"\"", () => {
  assert.equal(isbnOf(BOOKS_VOLUMES.items[0].volumeInfo.industryIdentifiers as never), "9789943570123");
  assert.equal(isbnOf(BOOKS_VOLUMES.items[1].volumeInfo.industryIdentifiers as never), "994322111X");
  assert.equal(isbnOf([]), "");
  assert.equal(normalizeIsbn("978-9943-57-012-3"), "9789943570123");
  assert.equal(normalizeIsbn("ISBN: 9 9432 2111 x"), "994322111X");
  assert.equal(normalizeIsbn("12345"), "");
  assert.equal(normalizeIsbn("97799435701234"), "", "13 raqam, lekin 978/979 bilan boshlanmaydi");
  assert.equal(yearOf("2022-04-11"), 2022);
  assert.equal(yearOf("2019"), 2019);
  assert.equal(yearOf("kechagi kun"), undefined);
});

test("searchBooks: javob → faqat yaroqli yozuvlar; xato/bo'sh javob — bo'sh ro'yxat (xato tashlamaydi)", async () => {
  await withoutKey(async () => {
    const ok = await searchBooks("ta'lim", { fetchImpl: stubFetch({ "books/v1/volumes": BOOKS_VOLUMES }), retryBaseMs: 0 });
    assert.equal(ok.length, 2, "3 xom yozuvdan sarlavhasizi tushadi");
    assert.deepEqual(ok.map((r) => r.id), ["gb:vol_ta_lim", "gb:vol_pedagogika"]);
    const bad = await searchBooks("ta'lim", { fetchImpl: stubFetch({ "books/v1/volumes": { __status: 503 } }), retries: 0, retryBaseMs: 0 });
    assert.deepEqual(bad, []);
    const empty = await searchBooks("ta'lim", { fetchImpl: stubFetch({ "books/v1/volumes": { totalItems: 0 } }), retryBaseMs: 0 });
    assert.deepEqual(empty, []);
    assert.deepEqual(await searchBooks("   ", { fetchImpl: stubFetch({}), retryBaseMs: 0 }), [], "bo'sh so'rov — chaqiruv yo'q");
  });
});

test("kesh `gb:` — bir xil so'rov ikkinchi marta fetch qilinmaydi, boshqa til — alohida yozuv", async () => {
  await withoutKey(async () => {
    const store = memorySourceCache();
    setSourceCacheStore(store);
    const f = stubFetch({ "books/v1/volumes": BOOKS_VOLUMES });
    await searchBooks("ta'lim", { fetchImpl: f, lang: "uz", retryBaseMs: 0 });
    await searchBooks("ta'lim", { fetchImpl: f, lang: "uz", retryBaseMs: 0 });
    assert.equal(f.calls.length, 1, "ikkinchi so'rov keshdan");
    assert.ok([...store.map.keys()].every((k) => k.startsWith("gb:")), "kesh prefiksi `gb:`");
    await searchBooks("ta'lim", { fetchImpl: f, lang: "ru", retryBaseMs: 0 });
    assert.equal(f.calls.length, 2, "boshqa til — alohida kesh kaliti");
    setSourceCacheStore(null);
  });
});

test("verifyIsbn: `q=isbn:…`, tasdiqlangan yozuv; noto'g'ri ISBN va topilmagan kitob — null", async () => {
  await withoutKey(async () => {
    const f = stubFetch({ "books/v1/volumes": BOOKS_BY_ISBN });
    const r = await verifyIsbn("978-9943-57-012-3", { fetchImpl: f, retryBaseMs: 0 });
    assert.ok(r);
    assert.equal(new URL(f.calls[0].url).searchParams.get("q"), "isbn:9789943570123");
    assert.equal(new URL(f.calls[0].url).searchParams.get("maxResults"), "1");
    assert.equal(r!.verified, "googlebooks");
    assert.equal(r!.isbn, "9789943570123");
    assert.equal(r!.kind, "book");
    // Noto'g'ri ISBN — umuman so'rov yuborilmaydi.
    assert.equal(await verifyIsbn("123", { fetchImpl: f, retryBaseMs: 0 }), null);
    assert.equal(f.calls.length, 1);
    assert.equal(await verifyIsbn("9789943570123", { fetchImpl: stubFetch({ "books/v1/volumes": { totalItems: 0 } }), retryBaseMs: 0 }), null);
  });
});

test("dedup: bir kitobning ikki yozuvi — ISBN bo'yicha bittasi qoladi, boshqa ISBN qoladi", () => {
  const a = referenceFromVolume(BOOKS_VOLUMES.items[0] as never)!;
  const b = { ...a, id: "gb:other", title: "Ta’limda raqamli texnologiyalar (2-nashr)" };
  const c = { ...a, id: "gb:third", isbn: "9789943570000", title: "Boshqa kitob" };
  const out = dedupeReferences([a, b, c]);
  assert.deepEqual(out.map((r) => r.id), ["gb:vol_ta_lim", "gb:third"]);
});
