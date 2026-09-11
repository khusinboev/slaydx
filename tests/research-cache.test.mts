import test from "node:test";
import assert from "node:assert/strict";
import { cached, memorySourceCache, queryKey, setSourceCacheStore } from "../lib/generation/research/cache.ts";

/** `source_cache` keshi (Maqola 2, WP1): TTL, null saqlanmaydi, xato keshsiz davom. */

test.after(() => setSourceCacheStore(undefined));

test("cached: birinchi chaqiruv fetch, ikkinchisi keshdan; TTL o'tgach yana fetch", async () => {
  let now = 1_000_000;
  const store = memorySourceCache(() => now);
  setSourceCacheStore(store);
  let calls = 0;
  const fetch = async () => ({ n: ++calls });
  assert.deepEqual(await cached("k", 30, fetch, () => now), { n: 1 });
  assert.deepEqual(await cached("k", 30, fetch, () => now), { n: 1 }, "keshdan");
  assert.equal(calls, 1);
  now += 29 * 24 * 3600 * 1000;
  assert.deepEqual(await cached("k", 30, fetch, () => now), { n: 1 }, "29 kun — hali yaroqli");
  now += 2 * 24 * 3600 * 1000;
  assert.deepEqual(await cached("k", 30, fetch, () => now), { n: 2 }, "31 kun — eskirgan, qayta olinadi");
  assert.equal(calls, 2);
});

test("cached: null/undefined natija saqlanmaydi (o'tkinchi xato muzlab qolmasin)", async () => {
  const store = memorySourceCache();
  setSourceCacheStore(store);
  let calls = 0;
  const fetch = async () => (++calls === 1 ? null : { ok: true });
  assert.equal(await cached("n", 30, fetch), null);
  assert.equal(store.size, 0, "null yozilmadi");
  assert.deepEqual(await cached("n", 30, fetch), { ok: true });
  assert.equal(store.size, 1);
});

test("cached: do'kon xato bersa yoki o'chiq bo'lsa — fetch baribir ishlaydi", async () => {
  setSourceCacheStore({
    async get() {
      throw new Error("db down");
    },
    async set() {
      throw new Error("db down");
    },
  });
  assert.deepEqual(await cached("e", 30, async () => ({ v: 1 })), { v: 1 });
  setSourceCacheStore(null);
  let calls = 0;
  await cached("z", 30, async () => ++calls);
  await cached("z", 30, async () => ++calls);
  assert.equal(calls, 2, "kesh o'chiq — har safar fetch");
});

test("queryKey: bo'shliq/registr normallashadi, turli matn turli kalit", () => {
  assert.equal(queryKey("q:openalex", "Adaptive  Learning"), queryKey("q:openalex", "adaptive learning "));
  assert.notEqual(queryKey("q:openalex", "adaptive learning"), queryKey("q:openalex", "adaptive teaching"));
  assert.match(queryKey("q:crossref", "x"), /^q:crossref:[0-9a-f]{16}:1$/);
});
