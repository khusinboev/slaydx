import test from "node:test";
import assert from "node:assert/strict";
import { BOOKS_BY_ISBN, BOOKS_VOLUMES, LEX_PAGE_563, LEX_PAGE_OTHER, OPENALEX_WORKS, stubFetch } from "./helpers/research-fixtures.ts";
import { collectReferencesFor, dedupeReferences, fallbackQueries, type ResearchAsk } from "../lib/generation/research/pipeline.ts";
import { setSourceCacheStore } from "../lib/generation/research/cache.ts";
import type { LlmRole } from "../lib/generation/llm-roles.ts";
import { kindOf } from "../lib/generation/types.ts";

/**
 * Umumiy manba quvuri (AUDIT-19 WP-B): `collectReferencesFor` — qaysi
 * TARMOQLAR ishga tushishi `kinds` bilan boshqariladi, kvota promptga
 * mo'ljal sifatida tushadi, dedup ISBN ni ham biladi. Maqola o'rami
 * (`collectReferences`) `tests/article-engine.test.mts` da.
 *
 * Mutatsiyalar (har biri qizardi):
 *   • `kinds` e'tiborsiz qoldirilib hamma tarmoq ishga tushirildi —
 *     «faqat so'ralgan tarmoq» testi yiqildi;
 *   • `quota` promptga qo'shilmadi — kvota testi yiqildi;
 *   • foydalanuvchi id lari nomzodlardan chiqarilmadi — «ikki marta chiqmaydi» yiqildi;
 *   • `byKind` sanog'i `kindOf` o'rniga `verified` dan olindi — turlar testi yiqildi.
 */

test.beforeEach(() => setSourceCacheStore(null));
test.after(() => setSourceCacheStore(undefined));

const PLAN = {
  "api.openalex.org/works?": OPENALEX_WORKS,
  "api.crossref.org": { message: { items: [] } },
  "googleapis.com/books/v1/volumes": BOOKS_VOLUMES,
  "lex.uz/docs/5013009": { __html: LEX_PAGE_563 },
  "lex.uz/docs/4444444": { __html: LEX_PAGE_OTHER },
};

const LAWS_JSON = JSON.stringify({
  laws: [
    { title: "O‘zbekiston Respublikasining «Ta’lim to‘g‘risida»gi Qonuni", type: "law", docNo: "O‘RQ-563", docDate: "2019-09-20", url: "https://lex.uz/docs/5013009" },
    { title: "Raqamli ta’lim to‘g‘risidagi Qonun", type: "law", docNo: "O‘RQ-999", docDate: "2024-01-01", url: "https://lex.uz/docs/4444444" },
  ],
});

/** Rol bo'yicha javob beruvchi stub; `researcher` promptini yozib boradi. */
function stubComplete(seen: { select: string[]; fast: string[] }, ids: string[] = []) {
  return (async (role: LlmRole, _sys: string, user: string) => {
    if (role === "fast") {
      seen.fast.push(user);
      // lex.uz nomzodlari so'ralsa — qonunlar; aks holda qidiruv so'rovlari yo'q (deterministik).
      return user.includes("legal acts") ? { text: LAWS_JSON } : null;
    }
    if (role === "researcher") {
      seen.select.push(user);
      return { text: JSON.stringify({ ids }) };
    }
    return { text: "{}" };
  }) as never;
}

const ASK = (over: Partial<ResearchAsk> = {}): ResearchAsk => ({
  topic: "Ta'lim sohasini raqamlashtirish",
  keywords: ["ta'lim", "raqamli"],
  language: "uz",
  userRefs: [],
  research: true,
  want: { min: 3, max: 10 },
  kinds: ["article"],
  ...over,
});

test("kinds: faqat so'ralgan tarmoqlar chaqiriladi — maqola uchun Books/lex.uz ga so'rov yo'q", async () => {
  const seen = { select: [] as string[], fast: [] as string[] };
  const f = stubFetch(PLAN);
  const r = await collectReferencesFor(ASK(), { deadline: Date.now() + 20_000, complete: stubComplete(seen), fetchImpl: f, retryBaseMs: 0 });
  assert.ok(r.refs.length > 0);
  assert.ok(r.refs.every((x) => x.verified === "openalex"));
  assert.ok(!f.calls.some((c) => c.url.includes("books/v1")), "Books chaqirilmadi");
  assert.ok(!f.calls.some((c) => c.url.includes("lex.uz")), "lex.uz chaqirilmadi");
  assert.equal(r.stats.books, 0);
  assert.equal(r.stats.laws, 0);
});

test("kurs ishi kinds: [law, book, article] — uch tarmoq ham, uydirma qonun RAD (stats.rejected)", async () => {
  const seen = { select: [] as string[], fast: [] as string[] };
  const f = stubFetch(PLAN);
  const r = await collectReferencesFor(ASK({ kinds: ["law", "book", "article"], want: { min: 6, max: 12 } }), {
    deadline: Date.now() + 20_000,
    complete: stubComplete(seen),
    fetchImpl: f,
    retryBaseMs: 0,
  });
  assert.ok(f.calls.some((c) => c.url.includes("books/v1")), "Books chaqirildi");
  assert.ok(f.calls.some((c) => c.url.includes("lex.uz/docs/5013009")), "lex.uz chaqirildi");
  assert.equal(r.stats.laws, 1, "faqat tasdiqlangan qonun");
  assert.equal(r.stats.rejected, 1, "uydirma qonun RAD etildi");
  assert.equal(r.stats.blocked, 0);
  assert.ok((r.stats.books ?? 0) >= 2, `kitoblar: ${r.stats.books}`);
  const kinds = new Set(r.refs.map((x) => kindOf(x)));
  assert.ok(kinds.has("law") && kinds.has("book") && kinds.has("article"), [...kinds].join(","));
  // Uydirma qonun ro'yxatga TUSHMAYDI.
  assert.ok(!r.refs.some((x) => x.id === "lex:4444444"));
});

test("quota: tanlash promptiga MO'LJAL sifatida tushadi («TARGET, not a requirement»)", async () => {
  const seen = { select: [] as string[], fast: [] as string[] };
  await collectReferencesFor(ASK({ kinds: ["law", "book", "article"], quota: { law: 3, book: 5 } }), {
    deadline: Date.now() + 20_000,
    complete: stubComplete(seen),
    fetchImpl: stubFetch(PLAN),
    retryBaseMs: 0,
  });
  assert.equal(seen.select.length, 1);
  assert.match(seen.select[0], /Aim for a mix of about 3 law, 5 book/);
  assert.match(seen.select[0], /TARGET, not a requirement/);
  // Kvotasiz — bunday qator yo'q.
  const plain = { select: [] as string[], fast: [] as string[] };
  await collectReferencesFor(ASK(), { deadline: Date.now() + 20_000, complete: stubComplete(plain), fetchImpl: stubFetch(PLAN), retryBaseMs: 0 });
  assert.ok(!plain.select[0].includes("Aim for a mix"));
});

test("nomzodlar qatori: kitob — nashriyot/ISBN, qonun — organ/raqam/sana (model shu qatordan tanlaydi)", async () => {
  const seen = { select: [] as string[], fast: [] as string[] };
  await collectReferencesFor(ASK({ kinds: ["law", "book"] }), {
    deadline: Date.now() + 20_000,
    complete: stubComplete(seen),
    fetchImpl: stubFetch(PLAN),
    retryBaseMs: 0,
  });
  const prompt = seen.select[0];
  assert.match(prompt, /\[gb:vol_ta_lim\] Karimov A\., Yusupova D\. \(2022\)\..*ISBN 9789943570123 240 p\./);
  assert.match(prompt, /\[lex:5013009\] O‘zbekiston Respublikasi «.*» № O‘RQ-563 \(20\.09\.2019\)/);
});

test("foydalanuvchi ISBN i Google Books orqali tasdiqlanadi va ro'yxatda IKKI MARTA chiqmaydi", async () => {
  const seen = { select: [] as string[], fast: [] as string[] };
  const f = stubFetch({ ...PLAN, "books/v1/volumes?q=isbn": BOOKS_BY_ISBN });
  const r = await collectReferencesFor(
    ASK({ kinds: ["book"], userRefs: [{ id: "u1", isbn: "978-9943-57-012-3" }], want: { min: 1, max: 6 } }),
    { deadline: Date.now() + 20_000, complete: stubComplete(seen), fetchImpl: f, retryBaseMs: 0 },
  );
  const u1 = r.refs.find((x) => x.id === "u1");
  assert.ok(u1, "foydalanuvchi manbasi id sini saqlaydi");
  assert.equal(u1!.verified, "googlebooks");
  assert.equal(u1!.isbn, "9789943570123");
  assert.equal(r.stats.userVerified, 1);
  // Shu ISBN li kitob qidiruvdan ham kelgan — ro'yxatda faqat bitta.
  assert.equal(r.refs.filter((x) => x.isbn === "9789943570123").length, 1);
  assert.ok(!r.refs.some((x) => x.id === "gb:vol_ta_lim"), "u1 ustun (dedup)");
});

test("byKind va research:false — statistika turlar kesimida, o'chiq tadqiqotda faqat foydalanuvchi manbasi", async () => {
  const seen = { select: [] as string[], fast: [] as string[] };
  const r = await collectReferencesFor(ASK({ kinds: ["law", "book", "article"] }), {
    deadline: Date.now() + 20_000,
    complete: stubComplete(seen),
    fetchImpl: stubFetch(PLAN),
    retryBaseMs: 0,
  });
  const sum = Object.values(r.stats.byKind!).reduce((a, b) => a + b, 0);
  assert.equal(sum, r.refs.length, "byKind yig'indisi ro'yxat uzunligiga teng");
  assert.equal(r.stats.byKind!.law, 1);
  assert.ok(r.stats.byKind!.book >= 1);

  const off = await collectReferencesFor(
    ASK({ research: false, kinds: ["law", "book", "article"], userRefs: [{ id: "u1", raw: "Karimov A. Ta'limda AI. — Toshkent: Fan, 2022." }] }),
    { deadline: Date.now() + 20_000, complete: stubComplete(seen), fetchImpl: stubFetch(PLAN), retryBaseMs: 0 },
  );
  assert.equal(off.refs.length, 1);
  assert.equal(off.refs[0].id, "u1");
  assert.equal(off.stats.byKind!.user, 1);
  assert.equal(off.stats.candidates, 0);
});

test("fallbackQueries va dedup: model javob bermasa deterministik so'rovlar; ISBN/DOI/sarlavha dedupi", () => {
  assert.deepEqual(fallbackQueries({ topic: "AI", keywords: ["a", "b"] }), ["AI", "AI a", "AI b", "a b"]);
  assert.deepEqual(fallbackQueries({ topic: "", keywords: ["a", "b"] }), ["a b"]);
  const out = dedupeReferences([
    { id: "u1", title: "Ta’limda raqamli texnologiyalar", authors: [], isbn: "9789943570123", verified: "user", cited: false },
    { id: "gb:x", title: "Boshqacha sarlavha", authors: [], isbn: "9789943570123", verified: "googlebooks", cited: false },
    { id: "W1", title: "Adaptive learning", authors: [], doi: "10.1/a", verified: "openalex", cited: false },
    { id: "W2", title: "Boshqa nom", authors: [], doi: "10.1/A", verified: "openalex", cited: false },
  ]);
  assert.deepEqual(out.map((r) => r.id), ["u1", "W1"]);
});
