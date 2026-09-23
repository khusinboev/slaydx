import test from "node:test";
import assert from "node:assert/strict";
import { CHAIN_MIN_ATTEMPT_MS, CHAIN_SAFETY_MS, DeadlineError, completeWithChain } from "../lib/generation/llm/chain.ts";
import { CircuitBreaker } from "../lib/generation/llm/breaker.ts";
import { Semaphore } from "../lib/generation/llm/limiter.ts";
import type { AdapterOpts, Attempt, ProviderAdapter, ProviderId, RoleSpec } from "../lib/generation/llm/types.ts";

/**
 * Zanjirning muddat/zaxira/breaker/limiter xatti-harakati (audit C28:
 * EXT-03, EXT-04, EXT-09, EXT-13, SCALE-06). Soxta adapterlar, tarmoqsiz.
 *
 *  - har urinish timeout'i ≤ qolgan byudjet (`deadline - now - safety`);
 *  - muddatdan keyin qayta urinish/zaxira boshlanmaydi → `DeadlineError`;
 *  - sekin (timeout) asosiy provayder → zaxira specga o'tiladi (muddat bor bo'lsa);
 *  - breaker ochiq provayder o'tkazib yuboriladi, sovishdan keyin sinov bilan yopiladi;
 *  - limiter bir provayderga bir vaqtdagi so'rovlarni cheklaydi;
 *  - `Retry-After` hurmat qilinadi, lekin cheklangan (1 soatlik kutish yo'q);
 *  - backoff jitter'li (`random` seam).
 */

const KEYS = ["GEMINI_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "XAI_API_KEY", "OPENAI_API_KEY"];
for (const k of KEYS) process.env[k] = "test";

const ok = (text: string): Attempt => ({ ok: true, text, usage: { inputTokens: 1, outputTokens: 1 } });

type Script = (opts: AdapterOpts, n: number) => Promise<Attempt> | Attempt;

function adapter(id: ProviderId, script: Script) {
  const seen: AdapterOpts[] = [];
  const a: ProviderAdapter = {
    id,
    async complete(_m, _s, _u, opts) {
      seen.push(opts);
      return script(opts, seen.length);
    },
  };
  return { a, seen };
}

/** Har test o'z breaker/limiter'ini oladi — modul darajasidagi holat testlar orasida oqmasin. */
function isolated(extra: Partial<Parameters<typeof completeWithChain>[5]> = {}) {
  const breakers = new Map<ProviderId, CircuitBreaker>();
  const limiters = new Map<ProviderId, Semaphore>();
  return {
    breakerFor: (p: ProviderId) => breakers.get(p) ?? (breakers.set(p, new CircuitBreaker(p, { log: () => {} })), breakers.get(p)!),
    limiterFor: (p: ProviderId) => limiters.get(p) ?? (limiters.set(p, new Semaphore(100)), limiters.get(p)!),
    ...extra,
  };
}

const G: RoleSpec = { provider: "gemini", model: "g" };
const A: RoleSpec = { provider: "anthropic", model: "a" };

test("har urinish timeout'i qolgan byudjetdan oshmaydi (deadline - now - safety)", async () => {
  const g = adapter("gemini", () => ok("javob"));
  const deadline = Date.now() + 8_000;
  const res = await completeWithChain("writer", [G], "s", "u", { maxTokens: 10, timeoutMs: 60_000, deadline }, { adapters: { gemini: g.a }, ...isolated() });
  assert.equal(res?.text, "javob");
  const t = g.seen[0].timeoutMs;
  assert.ok(t <= 8_000 - CHAIN_SAFETY_MS, `timeout ${t} > qolgan byudjet`);
  assert.ok(t >= 8_000 - CHAIN_SAFETY_MS - 200, `timeout ${t} keraksiz qisqa`);
});

test("muddat yetmasa qayta urinish boshlanmaydi → DeadlineError (uxlamasdan)", async () => {
  const g = adapter("gemini", () => ({ ok: false, error: "HTTP 503", retryable: true, status: 503, retryAfterMs: 3_000 }));
  const deadline = Date.now() + CHAIN_MIN_ATTEMPT_MS + CHAIN_SAFETY_MS + 2_000;
  const t0 = Date.now();
  await assert.rejects(
    completeWithChain("writer", [G], "s", "u", { maxTokens: 10, timeoutMs: 60_000, deadline }, { adapters: { gemini: g.a }, ...isolated() }),
    (e: unknown) => e instanceof DeadlineError,
  );
  assert.equal(g.seen.length, 1, "Retry-After + minimal urinish muddatga sig'maydi — ikkinchi urinish yo'q");
  assert.ok(Date.now() - t0 < 500, "sig'maydigan kutish uxlanmaydi");
});

test("muddat allaqachon o'tgan — adapter chaqirilmaydi, DeadlineError", async () => {
  const g = adapter("gemini", () => ok("bo'lmasligi kerak"));
  await assert.rejects(
    completeWithChain("writer", [G, A], "s", "u", { maxTokens: 10, timeoutMs: 60_000, deadline: Date.now() + 1_000 }, { adapters: { gemini: g.a }, ...isolated() }),
    DeadlineError,
  );
  assert.equal(g.seen.length, 0);
});

test("sekin asosiy provayder (timeout) → muddat bor bo'lsa zaxira specga o'tiladi", async () => {
  const g = adapter("gemini", async (o) => {
    await new Promise((r) => setTimeout(r, o.timeoutMs));
    return { ok: false, error: "This operation was aborted", retryable: false };
  });
  const a = adapter("anthropic", () => ok("zaxiradan"));
  const res = await completeWithChain("judge", [G, A], "s", "u", { maxTokens: 10, timeoutMs: 200, deadline: Date.now() + 30_000 }, {
    adapters: { gemini: g.a, anthropic: a.a },
    ...isolated(),
  });
  assert.equal(res?.text, "zaxiradan");
  assert.equal(g.seen.length, 1, "timeout'dan keyin shu provayder qayta urinilmaydi");
});

test("timeout'dan keyin zaxiraga vaqt qolmasa — DeadlineError", async () => {
  const g = adapter("gemini", async (o) => {
    await new Promise((r) => setTimeout(r, o.timeoutMs));
    return { ok: false, error: "Request timed out.", retryable: true };
  });
  const a = adapter("anthropic", () => ok("chaqirilmasligi kerak"));
  const deadline = Date.now() + CHAIN_MIN_ATTEMPT_MS + CHAIN_SAFETY_MS + 150;
  await assert.rejects(
    completeWithChain("judge", [G, A], "s", "u", { maxTokens: 10, timeoutMs: 200, deadline }, { adapters: { gemini: g.a, anthropic: a.a }, ...isolated() }),
    DeadlineError,
  );
  assert.equal(a.seen.length, 0);
});

test("muddatsiz chaqiruv — timeout avvalgidek zanjirni to'xtatadi (null)", async () => {
  const g = adapter("gemini", () => ({ ok: false, error: "This operation was aborted", retryable: false }));
  const a = adapter("anthropic", () => ok("chaqirilmasligi kerak"));
  const res = await completeWithChain("writer", [G, A], "s", "u", { maxTokens: 10, timeoutMs: 5_000 }, { adapters: { gemini: g.a, anthropic: a.a }, ...isolated() });
  assert.equal(res, null);
  assert.equal(a.seen.length, 0);
  assert.equal(g.seen[0].timeoutMs, 5_000, "muddatsiz — sozlangan timeout o'zgarmaydi");
});

test("breaker: N ta 5xx dan keyin provayder o'tkazib yuboriladi, sovishdan keyin sinov bilan yopiladi", async () => {
  let t = 5_000_000;
  const log: string[] = [];
  const gb = new CircuitBreaker("gemini", { threshold: 2, windowMs: 60_000, cooldownMs: 30_000, now: () => t, log: (l) => log.push(l) });
  let healthy = false;
  const g = adapter("gemini", () => (healthy ? ok("gemini tuzaldi") : { ok: false, error: "HTTP 503", retryable: true, status: 503 }));
  const a = adapter("anthropic", () => ok("zaxira"));
  const deps = {
    adapters: { gemini: g.a, anthropic: a.a },
    ...isolated({ random: () => 0 }),
    breakerFor: (p: ProviderId) => (p === "gemini" ? gb : new CircuitBreaker(p, { log: () => {} })),
  };
  const opts = { maxTokens: 10, timeoutMs: 5_000 };

  assert.equal((await completeWithChain("writer", [G, A], "s", "u", opts, deps))?.text, "zaxira");
  assert.equal(g.seen.length, 2, "breaker 2-xatoda ochildi — uchinchi urinish yo'q");
  assert.equal(gb.state, "open");

  assert.equal((await completeWithChain("writer", [G, A], "s", "u", opts, deps))?.text, "zaxira");
  assert.equal(g.seen.length, 2, "ochiq breaker — gemini umuman chaqirilmadi");

  t += 30_001;
  healthy = true;
  assert.equal((await completeWithChain("writer", [G, A], "s", "u", opts, deps))?.text, "gemini tuzaldi");
  assert.equal(gb.state, "closed");
  assert.ok(log.some((l) => /ochildi/.test(l)) && log.some((l) => /yopildi/.test(l)), JSON.stringify(log));
});

test("breaker: qisqa (byudjet tufayli) timeout'lar provayder nosozligi deb sanalmaydi", async () => {
  const gb = new CircuitBreaker("gemini", { threshold: 1, log: () => {} });
  const g = adapter("gemini", () => ({ ok: false, error: "This operation was aborted", retryable: false }));
  await completeWithChain("writer", [G], "s", "u", { maxTokens: 10, timeoutMs: 3_000 }, { adapters: { gemini: g.a }, ...isolated(), breakerFor: () => gb });
  assert.equal(gb.state, "closed");
  await completeWithChain("writer", [G], "s", "u", { maxTokens: 10, timeoutMs: 60_000 }, { adapters: { gemini: g.a }, ...isolated(), breakerFor: () => gb });
  assert.equal(gb.state, "open", "to'liq timeout — nosozlik belgisi");
});

test("breaker: bo'sh javob / refusal / 4xx provayder nosozligi EMAS — 5 martadan keyin ham yopiq (review R1)", async () => {
  const gb = new CircuitBreaker("gemini", { threshold: 2, log: () => {} });
  const replies: Attempt[] = [
    { ok: false, error: "bo'sh javob", retryable: false },
    { ok: false, error: "refusal", retryable: false },
    { ok: false, error: "bo'sh javob (max_tokens — fikrlash byudjetni yedi)", retryable: false },
    { ok: false, error: "bad request", retryable: false, status: 400 },
    { ok: false, error: "bo'sh javob", retryable: false },
  ];
  for (const r of replies) {
    const g = adapter("gemini", () => r);
    await completeWithChain("writer", [G], "s", "u", { maxTokens: 10, timeoutMs: 5_000 }, { adapters: { gemini: g.a }, ...isolated(), breakerFor: () => gb });
  }
  assert.equal(gb.state, "closed");
});

test("tarmoq ulanish timeout'i (ETIMEDOUT/UND_ERR_CONNECT_TIMEOUT) — timeout EMAS, qayta uriladi (review R2)", async () => {
  for (const error of ["fetch failed (ETIMEDOUT)", "fetch failed (UND_ERR_CONNECT_TIMEOUT)"]) {
    const g = adapter("gemini", (_o, n) => (n === 1 ? { ok: false, error, retryable: true } : ok("ikkinchi")));
    const res = await completeWithChain("fast", [G], "s", "u", { maxTokens: 10, timeoutMs: 5_000 }, { adapters: { gemini: g.a }, ...isolated({ random: () => 0 }) });
    assert.equal(res?.text, "ikkinchi", error);
  }
});

test("uzun Retry-After / sarf chegarasi 429 — saqlagich darhol ochiladi, keyingi chaqiruv provayderga chiqmaydi (nit 4)", { timeout: 5_000 }, async () => {
  const gb = new CircuitBreaker("anthropic", { log: () => {} });
  const a = adapter("anthropic", () => ({ ok: false, error: "enforced_spend_limit_reached", retryable: false, status: 429 }));
  const g = adapter("gemini", () => ok("zaxira"));
  const deps = { adapters: { anthropic: a.a, gemini: g.a }, ...isolated(), breakerFor: (p: ProviderId) => (p === "anthropic" ? gb : new CircuitBreaker(p, { log: () => {} })) };
  await completeWithChain("judge", [A, G], "s", "u", { maxTokens: 10, timeoutMs: 5_000 }, deps);
  await completeWithChain("judge", [A, G], "s", "u", { maxTokens: 10, timeoutMs: 5_000 }, deps);
  assert.equal(a.seen.length, 1);
});

test("limiter: bitta provayderga bir vaqtda chegaradan ko'p so'rov ketmaydi, hammasi navbat bilan bajariladi", async () => {
  let inflight = 0;
  let peak = 0;
  const g = adapter("gemini", async () => {
    inflight++;
    peak = Math.max(peak, inflight);
    await new Promise((r) => setTimeout(r, 20));
    inflight--;
    return ok("ok");
  });
  const sem = new Semaphore(2);
  const deps = { adapters: { gemini: g.a }, ...isolated(), limiterFor: () => sem };
  const out = await Promise.all(Array.from({ length: 7 }, () => completeWithChain("writer", [G], "s", "u", { maxTokens: 10, timeoutMs: 5_000 }, deps)));
  assert.equal(peak, 2);
  assert.ok(out.every((r) => r?.text === "ok"));
});

test("limiter: navbatda kutilgan vaqt urinish timeout'idan ayriladi", async () => {
  const sem = new Semaphore(1);
  const hold = await sem.acquire();
  setTimeout(() => hold!(), 300);
  const g = adapter("gemini", () => ok("ok"));
  await completeWithChain("writer", [G], "s", "u", { maxTokens: 10, timeoutMs: 5_000 }, { adapters: { gemini: g.a }, ...isolated(), limiterFor: () => sem });
  assert.ok(g.seen[0].timeoutMs <= 4_750, `kutish ayrilmadi: ${g.seen[0].timeoutMs}`);
});

test("Retry-After hurmat qilinadi (kichik qiymat kutiladi)", async () => {
  const g = adapter("gemini", (_o, n) => (n === 1 ? { ok: false, error: "429", retryable: true, status: 429, retryAfterMs: 120 } : ok("ikkinchi")));
  const t0 = Date.now();
  const res = await completeWithChain("fast", [G], "s", "u", { maxTokens: 10, timeoutMs: 5_000 }, { adapters: { gemini: g.a }, ...isolated() });
  assert.equal(res?.text, "ikkinchi");
  assert.ok(Date.now() - t0 >= 110, "Retry-After kutilmadi");
});

test("Retry-After cheklangan: 1 soatlik kutish o'rniga keyingi specga o'tiladi", { timeout: 5_000 }, async () => {
  const g = adapter("gemini", () => ({ ok: false, error: "quota", retryable: true, status: 429, retryAfterMs: 3_600_000 }));
  const a = adapter("anthropic", () => ok("zaxira"));
  const t0 = Date.now();
  const res = await completeWithChain("fast", [G, A], "s", "u", { maxTokens: 10, timeoutMs: 5_000 }, { adapters: { gemini: g.a, anthropic: a.a }, ...isolated() });
  assert.equal(res?.text, "zaxira");
  assert.equal(g.seen.length, 1);
  assert.ok(Date.now() - t0 < 1_000);
});

test("backoff jitter'li: random=0 bo'lsa 5xx qayta urinishlari kutmaydi", async () => {
  const g = adapter("gemini", () => ({ ok: false, error: "HTTP 503", retryable: true, status: 503 }));
  const t0 = Date.now();
  const res = await completeWithChain("fast", [G], "s", "u", { maxTokens: 10, timeoutMs: 5_000 }, { adapters: { gemini: g.a }, ...isolated({ random: () => 0 }) });
  assert.equal(res, null);
  assert.equal(g.seen.length, 3);
  assert.ok(Date.now() - t0 < 300, `jitter ishlatilmadi (qat'iy 500+1000 ms): ${Date.now() - t0} ms`);
});
