import test from "node:test";
import assert from "node:assert/strict";

/**
 * `llm.ts withRetry` (eski yo'l: slayd, tarjimon, rezyume, …) — qayta
 * urinish gigiyenasi (audit EXT-13, SCALE-06, EXT-04, EXT-09):
 *  - Gemini 429 tanasidagi `RetryInfo.retryDelay` hurmat qilinadi;
 *  - byudjetga sig'maydigan kutish — darhol voz kechiladi;
 *  - oxirgi urinishdan keyin UXLANMAYDI;
 *  - 4xx qayta urinilmaydi;
 *  - breaker: ketma-ket 5xx dan keyin provayderga chiqilmaydi;
 *  - limiter: bir vaqtdagi so'rovlar cheklangan.
 * `fetch` stub, tarmoqqa chiqilmaydi.
 */

process.env.GEMINI_API_KEY = "test-key";
process.env.GEMINI_MODEL = "gemini-test";
delete process.env.LLM_STREAM;

const { llmComplete } = await import("../lib/generation/llm.ts");
const { resetBreakers } = await import("../lib/generation/llm/breaker.ts");
const { PROVIDER_MAX_INFLIGHT, resetLimiters } = await import("../lib/generation/llm/limiter.ts");

const realFetch = globalThis.fetch;
const realRandom = Math.random;

type Reply = { status: number; body: unknown; delayMs?: number };

function stub(replies: Reply[] | ((n: number) => Reply)) {
  const calls: number[] = [];
  globalThis.fetch = (async () => {
    calls.push(Date.now());
    const r = typeof replies === "function" ? replies(calls.length) : replies[Math.min(calls.length - 1, replies.length - 1)];
    if (r.delayMs) await new Promise((res) => setTimeout(res, r.delayMs));
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return calls;
}

const OK = { status: 200, body: { candidates: [{ content: { parts: [{ text: "javob" }] } }] } };
const E503 = { status: 503, body: { error: { message: "overloaded" } } };
const retryInfo = (delay: string) => ({
  status: 429,
  body: { error: { code: 429, message: "quota", details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: delay }] } },
});

test.beforeEach(() => {
  resetBreakers();
  resetLimiters();
});
test.afterEach(() => {
  globalThis.fetch = realFetch;
  Math.random = realRandom;
  resetBreakers();
  resetLimiters();
});

test("Gemini RetryInfo (1s) hurmat qilinadi — 0.5 s dan keyin emas", async () => {
  const calls = stub([retryInfo("1s"), OK]);
  const t0 = Date.now();
  assert.equal(await llmComplete("s", "u", 100, { timeoutMs: 20_000 }), "javob");
  assert.equal(calls.length, 2);
  assert.ok(calls[1] - t0 >= 950, `RetryInfo kutilmadi: ${calls[1] - t0} ms`);
});

test("RetryInfo byudjetdan uzun — darhol voz kechiladi (uxlamasdan, qayta urinmasdan)", async () => {
  const calls = stub([retryInfo("60s"), OK]);
  const t0 = Date.now();
  assert.equal(await llmComplete("s", "u", 100, { timeoutMs: 10_000 }), null);
  assert.equal(calls.length, 1);
  assert.ok(Date.now() - t0 < 400);
});

test("oxirgi urinishdan keyin uxlanmaydi; backoff jitter'li", async () => {
  Math.random = () => 0.999;
  const calls = stub([E503]);
  const t0 = Date.now();
  assert.equal(await llmComplete("s", "u", 100, { timeoutMs: 40_000 }), null);
  const elapsed = Date.now() - t0;
  assert.equal(calls.length, 3);
  // Jitter (random≈1) bilan ≈ 0.5 + 1 s; eskisi 0.5 + 1 + 2 s (oxirgi 2 s bekorga).
  assert.ok(elapsed < 2_300, `oxirgi urinishdan keyin uxlandi: ${elapsed} ms`);
  assert.ok(elapsed - (calls[2] - t0) < 100, "oxirgi javobdan keyin kutish bo'lmasligi kerak");
});

test("ulanish timeout'i (fetch failed, cause ETIMEDOUT) — tarmoq xatosi, qayta uriladi (review R2)", async () => {
  Math.random = () => 0;
  let n = 0;
  globalThis.fetch = (async () => {
    n++;
    if (n === 1) throw Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } });
    return new Response(JSON.stringify(OK.body), { status: 200 });
  }) as typeof fetch;
  assert.equal(await llmComplete("s", "u", 100, { timeoutMs: 20_000 }), "javob");
  assert.equal(n, 2);
});

test("4xx qayta urinilmaydi", async () => {
  const calls = stub([{ status: 400, body: { error: { message: "bad" } } }]);
  assert.equal(await llmComplete("s", "u", 100, { timeoutMs: 10_000 }), null);
  assert.equal(calls.length, 1);
});

test("breaker: ketma-ket 5xx dan keyin Gemini'ga chiqilmaydi (sovish davrida)", async () => {
  Math.random = () => 0;
  const calls = stub([E503]);
  await llmComplete("s", "u", 100, { timeoutMs: 20_000 });
  await llmComplete("s", "u", 100, { timeoutMs: 20_000 });
  const before = calls.length;
  assert.ok(before >= 5, `kamida 5 urinish: ${before}`);
  const t0 = Date.now();
  assert.equal(await llmComplete("s", "u", 100, { timeoutMs: 20_000 }), null);
  assert.equal(calls.length, before, "breaker ochiq — tarmoqqa chiqilmadi");
  assert.ok(Date.now() - t0 < 100);
});

test("limiter: parallel llmComplete'lar provayder chegarasidan oshmaydi", async () => {
  const saved = PROVIDER_MAX_INFLIGHT.gemini;
  PROVIDER_MAX_INFLIGHT.gemini = 2;
  resetLimiters();
  let inflight = 0;
  let peak = 0;
  globalThis.fetch = (async () => {
    inflight++;
    peak = Math.max(peak, inflight);
    await new Promise((r) => setTimeout(r, 20));
    inflight--;
    return new Response(JSON.stringify(OK.body), { status: 200 });
  }) as typeof fetch;
  try {
    const out = await Promise.all(Array.from({ length: 6 }, () => llmComplete("s", "u", 100, { timeoutMs: 5_000 })));
    assert.ok(out.every((t) => t === "javob"));
    assert.equal(peak, 2);
  } finally {
    PROVIDER_MAX_INFLIGHT.gemini = saved;
  }
});

test("runLlmRaw (zanjir Gemini adapteri): 429 tanasidagi RetryInfo → retryAfterMs", async () => {
  const { runLlmRaw } = await import("../lib/generation/llm.ts");
  const r = retryInfo("34s");
  const fetchImpl = (async () => new Response(JSON.stringify(r.body), { status: 429 })) as typeof fetch;
  const res = await runLlmRaw("gemini", "m", "s", "u", 100, { timeoutMs: 5_000, fetchImpl });
  assert.equal(res.ok, false);
  assert.equal(!res.ok && res.retryAfterMs, 34_000);
});

test("llm-roles.complete: `deadline` zanjirga uzatiladi — vaqt yo'q bo'lsa DeadlineError, tarmoqqa chiqilmaydi", async () => {
  const { complete, DeadlineError } = await import("../lib/generation/llm-roles.ts");
  const calls = stub([OK]);
  const saved = process.env.LLM_FAST;
  delete process.env.LLM_FAST;
  try {
    await assert.rejects(complete("fast", "s", "u", { timeoutMs: 30_000, deadline: Date.now() + 2_000 }), DeadlineError);
    assert.equal(calls.length, 0);
    // Muddatsiz — eski yo'l, javob qaytadi.
    assert.equal((await complete("fast", "s", "u", { timeoutMs: 30_000 }))?.text, "javob");
  } finally {
    if (saved !== undefined) process.env.LLM_FAST = saved;
  }
});
