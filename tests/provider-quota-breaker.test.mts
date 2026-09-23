import test from "node:test";
import assert from "node:assert/strict";
import { getJson } from "../lib/generation/research/http.ts";
import { chainProvider, limitedProvider, type ImageProvider, type ImageResult } from "../lib/generation/image-provider.ts";
import { breakerFor, resetBreakers } from "../lib/generation/llm/breaker.ts";
import { Semaphore } from "../lib/generation/llm/limiter.ts";

/**
 * Kvota 429 → manba saqlagichi (audit EXT-06, EXT-07, EXT-09).
 *
 * Ilgari: Google Books/OpenAlex kunlik kvotasi tugaganda har so'rov 429
 * olib, ikki marta befoyda qayta urilardi; Pexels/Pixabay 429 ni esa har
 * slayd rasmi qaytadan so'rardi. Endi 429 shu manbani sovish davriga
 * «ochadi» — keyingi so'rovlar tarmoqqa chiqmasdan darhol bo'sh natija
 * bilan qaytadi (hujjat/deka degradatsiya qiladi, yiqilmaydi).
 */

test.beforeEach(() => resetBreakers());
test.after(() => resetBreakers());

function stubFetch(replies: ((url: string) => Response)[]) {
  const urls: string[] = [];
  const f = (async (url: string | URL) => {
    urls.push(String(url));
    return replies[Math.min(urls.length - 1, replies.length - 1)](String(url));
  }) as typeof fetch;
  return { f, urls };
}

const r429 = (headers: Record<string, string> = {}) => () => new Response("{}", { status: 429, headers });
const r200 = () => () => new Response(JSON.stringify({ results: [] }), { status: 200 });
const r503 = () => () => new Response("{}", { status: 503 });

test("research: 429 takrorlansa host saqlagichi ochiladi — keyingi so'rov tarmoqqa chiqmaydi", async () => {
  const { f, urls } = stubFetch([r429(), r429(), r200()]);
  const a = await getJson("https://api.openalex.org/works?search=a", { fetchImpl: f, retryBaseMs: 0 });
  assert.equal(a.ok, false);
  assert.equal(urls.length, 2, "429 dan keyin bitta qayta urinish, keyin to'xtaydi");
  const b = await getJson("https://api.openalex.org/works?search=b", { fetchImpl: f, retryBaseMs: 0 });
  assert.equal(b.ok, false);
  assert.equal(!b.ok && b.status, 429);
  assert.equal(urls.length, 2, "saqlagich ochiq — OpenAlex'ga chiqilmadi");
  // Boshqa host ta'sirlanmaydi.
  const c = await getJson("https://api.crossref.org/works/x", { fetchImpl: stubFetch([r200()]).f, retryBaseMs: 0 });
  assert.equal(c.ok, true);
});

test("research: uzun Retry-After (kunlik kvota) — qayta urinilmaydi, saqlagich darhol ochiladi", async () => {
  const { f, urls } = stubFetch([r429({ "retry-after": "3600" }), r200()]);
  const a = await getJson("https://www.googleapis.com/books/v1/volumes?q=x", { fetchImpl: f, retryBaseMs: 0 });
  assert.equal(a.ok, false);
  assert.equal(urls.length, 1);
  assert.equal(breakerFor("research:www.googleapis.com").state, "open");
});

test("research: bitta 429 dan keyin muvaffaqiyat — saqlagich yopiq qoladi (mavjud xatti-harakat)", async () => {
  const { f, urls } = stubFetch([r429(), r200()]);
  assert.equal((await getJson("https://api.openalex.org/works?search=a", { fetchImpl: f, retryBaseMs: 0 })).ok, true);
  assert.equal(urls.length, 2);
  assert.equal(breakerFor("research:api.openalex.org").state, "closed");
});

test("research: muddat (deadline) yetmasa 5xx qayta urinilmaydi", async () => {
  const urls: string[] = [];
  const f = (async (url: string | URL) => {
    urls.push(String(url));
    await new Promise((r) => setTimeout(r, 300));
    return r503()();
  }) as typeof fetch;
  // Birinchi urinish sig'adi (1.2 s ≥ 1 s), 0.3 s javobdan keyin esa < 1 s qoladi.
  const a = await getJson("https://api.openalex.org/works?search=a", { fetchImpl: f, retryBaseMs: 0, deadline: Date.now() + 1_200 });
  assert.equal(a.ok, false);
  assert.equal(urls.length, 1, "qolgan vaqt minimal urinishdan kam — qayta urinish yo'q");
});

function fakeProvider(id: "pexels" | "pixabay" | "fal", impl: () => Promise<ImageResult>): ImageProvider & { calls: () => number } {
  let n = 0;
  return {
    id,
    minMs: 1,
    hasKey: () => true,
    fetchImage: async () => {
      n += 1;
      return impl();
    },
    calls: () => n,
  };
}

const ASK = { prompt: "x", size: { width: 1, height: 1 }, styleId: "photo" as const, searchQuery: "cat" };

test("stock: Pexels 429 → saqlagich ochiladi, KEYINGI dekalar ham Pexels'ga chiqmaydi (Pixabay'ga to'g'ridan-to'g'ri)", async () => {
  const pexels = fakeProvider("pexels", async () => ({ ok: false, reason: "rate", detail: "429" }));
  const pixabay = fakeProvider("pixabay", async () => ({ ok: true, image: { url: `https://pixabay.example/${Math.random()}.jpg` } }));
  const deck1 = chainProvider([pexels, pixabay], "stock");
  assert.ok((await deck1.fetchImage(ASK)).ok);
  assert.ok((await deck1.fetchImage(ASK)).ok);
  // Yangi deka (yangi `chainProvider`) — saqlagich jarayon bo'yicha, deka bo'yicha emas.
  const deck2 = chainProvider([pexels, pixabay], "stock");
  assert.ok((await deck2.fetchImage(ASK)).ok);
  assert.equal(pexels.calls(), 1, "429 dan keyin Pexels sovish davrida so'ralmaydi");
  assert.equal(pixabay.calls(), 3);
});

test("stock: ikkala manba 429 — keyingi slotlar tarmoqqa chiqmasdan `rate` bilan tez qaytadi", async () => {
  const pexels = fakeProvider("pexels", async () => ({ ok: false, reason: "rate", detail: "429" }));
  const pixabay = fakeProvider("pixabay", async () => ({ ok: false, reason: "rate", detail: "429" }));
  const deck = chainProvider([pexels, pixabay], "stock");
  const first = await deck.fetchImage(ASK);
  assert.equal(!first.ok && first.reason, "rate");
  const second = await deck.fetchImage(ASK);
  assert.equal(!second.ok && second.reason, "rate");
  assert.equal(pexels.calls() + pixabay.calls(), 2, "ikkinchi slot hech qaysi manbaga chiqmadi");
});

test("limitedProvider: pro-slayd rasm so'rovlari provayder chegarasida navbatga turadi", async () => {
  let inflight = 0;
  let peak = 0;
  const gemini: ImageProvider = {
    id: "gemini",
    minMs: 1,
    hasKey: () => true,
    fetchImage: async () => {
      inflight++;
      peak = Math.max(peak, inflight);
      await new Promise((r) => setTimeout(r, 20));
      inflight--;
      return { ok: true, image: { url: "data:x" } };
    },
  };
  const limited = limitedProvider(gemini, new Semaphore(2));
  assert.equal(limited.id, "gemini");
  const out = await Promise.all(Array.from({ length: 6 }, () => limited.fetchImage(ASK, Date.now() + 10_000)));
  assert.ok(out.every((r) => r.ok));
  assert.equal(peak, 2);
});

test("limitedProvider: navbatda muddat tugasa `timeout` (so'rov yuborilmaydi)", async () => {
  let calls = 0;
  const gemini: ImageProvider = {
    id: "gemini",
    minMs: 1_000,
    hasKey: () => true,
    fetchImage: async () => {
      calls++;
      return { ok: true, image: { url: "data:x" } };
    },
  };
  const sem = new Semaphore(1);
  const hold = await sem.acquire();
  const res = await limitedProvider(gemini, sem).fetchImage(ASK, Date.now() + 1_100);
  hold!();
  assert.equal(!res.ok && res.reason, "timeout");
  assert.equal(calls, 0);
});
