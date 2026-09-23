import test from "node:test";
import assert from "node:assert/strict";
import { CircuitBreaker, breakerFor, resetBreakers } from "../lib/generation/llm/breaker.ts";
import { PROVIDER_MAX_INFLIGHT, Semaphore, limiterFor, resetLimiters } from "../lib/generation/llm/limiter.ts";
import { backoffMs, equalJitterMs, geminiRetryDelayMs, parseRetryAfter } from "../lib/generation/llm/retry.ts";

/**
 * Provayder chidamliligi qurilish bloklari (audit C28: EXT-04, EXT-09,
 * EXT-13, SCALE-06) — sof birliklar, tarmoqsiz:
 *  - `CircuitBreaker`: N ketma-ket xatodan keyin ochiladi, sovish
 *    davrida provayderni o'tkazib yuboradi, keyin BITTA sinov so'rovi
 *    bilan yopiladi;
 *  - `Semaphore`: bir vaqtdagi so'rovlar soni chegarada, ortig'i
 *    navbatda qisqa kutadi;
 *  - `backoffMs` (to'liq jitter), `parseRetryAfter`, `geminiRetryDelayMs`.
 */

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

test("breaker: N ketma-ket xatodan keyin ochiladi, sovishdan keyin bitta sinov bilan yopiladi", () => {
  const c = clock();
  const log: string[] = [];
  const b = new CircuitBreaker("gemini", { threshold: 3, windowMs: 60_000, cooldownMs: 30_000, now: c.now, log: (l) => log.push(l) });
  assert.equal(b.allow(), true);
  b.failure();
  b.failure();
  assert.equal(b.state, "closed", "chegaradan oldin yopiq");
  b.failure();
  assert.equal(b.state, "open");
  assert.equal(b.allow(), false, "ochiq holatda so'rov o'tkazilmaydi");
  assert.ok(log.some((l) => /gemini.*ochildi/.test(l)), `ochilish jurnalda: ${JSON.stringify(log)}`);

  c.advance(29_999);
  assert.equal(b.allow(), false, "sovish davri tugamagan");
  c.advance(2);
  assert.equal(b.allow(), true, "sovishdan keyin BITTA sinov");
  assert.equal(b.allow(), false, "sinov davomida ikkinchi so'rov o'tmaydi");
  b.success();
  assert.equal(b.state, "closed");
  assert.equal(b.allow(), true);
  assert.ok(log.some((l) => /gemini.*yopildi/.test(l)), `yopilish jurnalda: ${JSON.stringify(log)}`);
});

test("breaker: sinov yiqilsa yana ochiladi; muvaffaqiyat hisoblagichni nollaydi; oyna eskirsa hisob qaytadan", () => {
  const c = clock();
  const b = new CircuitBreaker("x", { threshold: 2, windowMs: 10_000, cooldownMs: 1_000, now: c.now, log: () => {} });
  b.failure();
  b.success();
  b.failure();
  assert.equal(b.state, "closed", "orada muvaffaqiyat — ketma-ketlik uzildi");
  c.advance(10_001);
  b.failure();
  assert.equal(b.state, "closed", "oyna eskirgan xato hisobga olinmaydi");
  b.failure();
  assert.equal(b.state, "open");
  c.advance(1_001);
  assert.equal(b.allow(), true);
  b.failure();
  assert.equal(b.state, "open", "sinov yiqildi — yana ochiq");
  assert.equal(b.allow(), false);
});

test("breaker: `trip(ms)` darhol ochadi (kvota 429); javobsiz qolgan sinov sovishdan keyin yangilanadi", () => {
  const c = clock();
  const b = new CircuitBreaker("pexels", { threshold: 5, cooldownMs: 1_000, now: c.now, log: () => {} });
  b.trip(60_000);
  assert.equal(b.allow(), false);
  c.advance(60_001);
  assert.equal(b.allow(), true, "sinov");
  // Sinov natijasi hech qachon qaytmadi (chaqiruvchi yiqildi) — abadiy ochiq qolmasin.
  c.advance(1_001);
  assert.equal(b.allow(), true, "osilib qolgan sinov sovishdan keyin yangilanadi");
});

test("breakerFor: bir nom — bitta nusxa; resetBreakers tozalaydi", () => {
  resetBreakers();
  const a = breakerFor("anthropic");
  assert.equal(breakerFor("anthropic"), a);
  resetBreakers();
  assert.notEqual(breakerFor("anthropic"), a);
});

test("semaphore: bir vaqtda chegaradan ko'p ishlamaydi, navbatdagilar tartib bilan o'tadi", async () => {
  const s = new Semaphore(2);
  let inflight = 0;
  let peak = 0;
  const done: number[] = [];
  await Promise.all(
    Array.from({ length: 7 }, async (_, i) => {
      const release = await s.acquire();
      assert.ok(release, "cheklanmagan kutishda slot albatta beriladi");
      inflight++;
      peak = Math.max(peak, inflight);
      await new Promise((r) => setTimeout(r, 10));
      inflight--;
      done.push(i);
      release!();
      release!(); // ikki marta chaqirish — slot ikki marta qaytmasin
    }),
  );
  assert.equal(peak, 2);
  assert.equal(done.length, 7);
  assert.equal(s.active, 0);
});

test("semaphore: kutish muddati o'tsa `null`, navbatdan chiqadi va slotni o'g'irlamaydi", async () => {
  const s = new Semaphore(1);
  const r1 = await s.acquire();
  const t0 = Date.now();
  const r2 = await s.acquire(30);
  assert.equal(r2, null);
  assert.ok(Date.now() - t0 >= 25);
  assert.equal(s.waiting, 0);
  r1!();
  const r3 = await s.acquire(10);
  assert.ok(r3, "bo'shagan slot keyingi chaqiruvchiga beriladi");
  r3!();
});

test("limiterFor: PROVIDER_MAX_INFLIGHT dan o'qiydi, provayder bo'yicha alohida", () => {
  resetLimiters();
  const saved = PROVIDER_MAX_INFLIGHT.gemini;
  PROVIDER_MAX_INFLIGHT.gemini = 3;
  try {
    resetLimiters();
    assert.equal(limiterFor("gemini").max, 3);
    assert.equal(limiterFor("gemini"), limiterFor("gemini"));
    assert.notEqual(limiterFor("gemini"), limiterFor("anthropic"));
  } finally {
    PROVIDER_MAX_INFLIGHT.gemini = saved;
    resetLimiters();
  }
});

test("backoffMs: to'liq jitter — [0, base·2ⁿ) oralig'ida", () => {
  assert.equal(backoffMs(0, 500, () => 0), 0);
  assert.ok(backoffMs(0, 500, () => 0.999) < 500);
  assert.ok(backoffMs(2, 500, () => 0.999) < 2_000);
  assert.ok(backoffMs(2, 500, () => 0.999) >= 1_990);
  for (let i = 0; i < 200; i++) {
    const d = backoffMs(1, 500);
    assert.ok(d >= 0 && d < 1_000, `jitter oraliqdan chiqdi: ${d}`);
  }
});

test("equalJitterMs: teng jitter — [base·2ⁿ/2, base·2ⁿ) oralig'ida", () => {
  assert.equal(equalJitterMs(0, 2_000, () => 0), 1_000);
  assert.ok(equalJitterMs(0, 2_000, () => 0.999) < 2_000);
  for (let i = 0; i < 200; i++) {
    const d = equalJitterMs(1, 2_000);
    assert.ok(d >= 2_000 && d < 4_000, `teng jitter oraliqdan chiqdi: ${d}`);
  }
});

test("parseRetryAfter: soniya, HTTP-sana, yaroqsiz", () => {
  assert.equal(parseRetryAfter("3"), 3_000);
  assert.equal(parseRetryAfter(null), undefined);
  assert.equal(parseRetryAfter("xyz"), undefined);
  const now = Date.parse("2026-09-24T10:00:00Z");
  assert.equal(parseRetryAfter("Thu, 24 Sep 2026 10:00:05 GMT", now), 5_000);
});

test("geminiRetryDelayMs: `google.rpc.RetryInfo.retryDelay` tanasidan", () => {
  const body = {
    error: {
      code: 429,
      status: "RESOURCE_EXHAUSTED",
      details: [
        { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [] },
        { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "34s" },
      ],
    },
  };
  assert.equal(geminiRetryDelayMs(body), 34_000);
  assert.equal(geminiRetryDelayMs({ error: { details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "1.5s" }] } }), 1_500);
  assert.equal(geminiRetryDelayMs({ error: { message: "x" } }), undefined);
  assert.equal(geminiRetryDelayMs(null), undefined);
});
