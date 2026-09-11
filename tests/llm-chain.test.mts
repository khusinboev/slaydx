import test from "node:test";
import assert from "node:assert/strict";
import { completeWithChain } from "../lib/generation/llm/chain.ts";
import type { Attempt, ProviderAdapter, RoleSpec } from "../lib/generation/llm/types.ts";

/**
 * ZAXIRA ZANJIRI (`llm/chain.ts`) — Maqola 2 / AUDIT-17, WP8.
 *
 * Bu yerda HAQIQIY provayder yo'q — soxta `ProviderAdapter` lar bilan
 * zanjirning O'ZINI (retry/backoff/timeout/kalit) sinaymiz, tarmoqqa
 * chiqmasdan. Qulflanadigan olti holat:
 *  1. 429 — 3 marta uriladi, keyin KEYINGI specga o'tadi.
 *  2. 400 (retryable:false) — DARHOL keyingi specga, qayta urinmasdan.
 *  3. timeout (abort/timed out xabari) — BUTUN zanjir to'xtaydi (`null`),
 *     keyingi specga O'TILMAYDI.
 *  4. kalit yo'q provayder — adapter chaqirilmasdan o'tkazib yuboriladi.
 *  5. hamma spec tugasa — `null`.
 *  6. `Retry-After` — eksponensial o'rniga shu qiymat kutiladi.
 */

const OPTS = { maxTokens: 500, timeoutMs: 5_000 };

/** Har chaqiruvda ro'yxatdagi keyingi javobni beradigan soxta adapter. */
function fakeAdapter(id: ProviderAdapter["id"], replies: Attempt[]): { adapter: ProviderAdapter; calls: string[] } {
  const calls: string[] = [];
  let i = 0;
  const adapter: ProviderAdapter = {
    id,
    async complete(model) {
      calls.push(model);
      const r = replies[Math.min(i, replies.length - 1)];
      i++;
      return r;
    },
  };
  return { adapter, calls };
}

function withKeys(keys: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const ENV_NAMES = ["GEMINI_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "XAI_API_KEY", "OPENAI_API_KEY"];
  const saved = Object.fromEntries(ENV_NAMES.map((n) => [n, process.env[n]]));
  for (const n of ENV_NAMES) delete process.env[n];
  for (const [k, v] of Object.entries(keys)) if (v !== undefined) process.env[k] = v;
  return fn().finally(() => {
    for (const n of ENV_NAMES) {
      if (saved[n] === undefined) delete process.env[n];
      else process.env[n] = saved[n];
    }
  });
}

test("429 — 3 urinishdan keyin KEYINGI specga o'tadi", async () => {
  await withKeys({ GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a" }, async () => {
    const g = fakeAdapter("gemini", [
      { ok: false, error: "rate limited", retryable: true, status: 429 },
      { ok: false, error: "rate limited", retryable: true, status: 429 },
      { ok: false, error: "rate limited", retryable: true, status: 429 },
    ]);
    const a = fakeAdapter("anthropic", [{ ok: true, text: "ikkinchidan javob", usage: { inputTokens: 10, outputTokens: 5 } }]);
    const specs: RoleSpec[] = [
      { provider: "gemini", model: "gemini-3.7-flash" },
      { provider: "anthropic", model: "claude-sonnet-5" },
    ];
    const res = await completeWithChain("writer", specs, "S", "U", OPTS, { adapters: { gemini: g.adapter, anthropic: a.adapter } });
    assert.equal(res?.text, "ikkinchidan javob");
    assert.equal(res?.usage.provider, "anthropic");
    assert.equal(g.calls.length, 3, "birinchi provayder AYNAN 3 marta urinishi kerak");
    assert.equal(a.calls.length, 1, "ikkinchi provayder faqat bir marta chaqirilishi kerak");
  });
});

test("400 (retryable:false) — DARHOL keyingi specga, qayta urinmasdan", async () => {
  await withKeys({ GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a" }, async () => {
    const g = fakeAdapter("gemini", [{ ok: false, error: "bad request", retryable: false, status: 400 }]);
    const a = fakeAdapter("anthropic", [{ ok: true, text: "zaxiradan", usage: { inputTokens: 1, outputTokens: 1 } }]);
    const specs: RoleSpec[] = [
      { provider: "gemini", model: "gemini-3.7-flash" },
      { provider: "anthropic", model: "claude-sonnet-5" },
    ];
    const res = await completeWithChain("writer", specs, "S", "U", OPTS, { adapters: { gemini: g.adapter, anthropic: a.adapter } });
    assert.equal(res?.text, "zaxiradan");
    assert.equal(g.calls.length, 1, "retryable:false — bitta urinishdan keyin darhol keyingisiga");
  });
});

test("timeout (abort) — BUTUN zanjir to'xtaydi, keyingi specga O'TILMAYDI", async () => {
  await withKeys({ GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a" }, async () => {
    const g = fakeAdapter("gemini", [{ ok: false, error: "This operation was aborted", retryable: false, status: undefined }]);
    const a = fakeAdapter("anthropic", [{ ok: true, text: "bu chaqirilmasligi kerak", usage: { inputTokens: 1, outputTokens: 1 } }]);
    const specs: RoleSpec[] = [
      { provider: "gemini", model: "gemini-3.7-flash" },
      { provider: "anthropic", model: "claude-sonnet-5" },
    ];
    const res = await completeWithChain("writer", specs, "S", "U", OPTS, { adapters: { gemini: g.adapter, anthropic: a.adapter } });
    assert.equal(res, null);
    assert.equal(a.calls.length, 0, "timeout'dan keyin keyingi provayderga umuman o'tilmasligi kerak");
  });
});

test("Anthropic SDK 'Request timed out.' xabari ham timeout deb tanilishi kerak", async () => {
  await withKeys({ ANTHROPIC_API_KEY: "a", GEMINI_API_KEY: "g" }, async () => {
    const a = fakeAdapter("anthropic", [{ ok: false, error: "Request timed out.", retryable: true, status: undefined }]);
    const g = fakeAdapter("gemini", [{ ok: true, text: "bu chaqirilmasligi kerak", usage: { inputTokens: 1, outputTokens: 1 } }]);
    const specs: RoleSpec[] = [
      { provider: "anthropic", model: "claude-sonnet-5" },
      { provider: "gemini", model: "gemini-3.7-flash" },
    ];
    const res = await completeWithChain("judge", specs, "S", "U", OPTS, { adapters: { anthropic: a.adapter, gemini: g.adapter } });
    assert.equal(res, null);
    assert.equal(g.calls.length, 0);
  });
});

test("kalit yo'q provayder — adapter chaqirilmasdan o'tkazib yuboriladi", async () => {
  await withKeys({ ANTHROPIC_API_KEY: "a" }, async () => {
    // GEMINI_API_KEY yo'q — birinchi spec o'tkazib yuborilishi kerak.
    const g = fakeAdapter("gemini", [{ ok: true, text: "chaqirilmasligi kerak", usage: { inputTokens: 1, outputTokens: 1 } }]);
    const a = fakeAdapter("anthropic", [{ ok: true, text: "anthropic javobi", usage: { inputTokens: 5, outputTokens: 5 } }]);
    const specs: RoleSpec[] = [
      { provider: "gemini", model: "gemini-3.7-flash" },
      { provider: "anthropic", model: "claude-sonnet-5" },
    ];
    const log: string[] = [];
    const res = await completeWithChain("fast", specs, "S", "U", OPTS, {
      adapters: { gemini: g.adapter, anthropic: a.adapter },
      log: (l) => log.push(l),
    });
    assert.equal(res?.text, "anthropic javobi");
    assert.equal(g.calls.length, 0, "kalitsiz provayder chaqirilmasligi kerak");
    assert.ok(log.some((l) => /gemini.*kalit yo'q/.test(l)), `jurnalda kalit yo'qligi ko'rinishi kerak: ${JSON.stringify(log)}`);
  });
});

test("hamma spec tugasa — null", async () => {
  await withKeys({ GEMINI_API_KEY: "g" }, async () => {
    const g = fakeAdapter("gemini", [{ ok: false, error: "bad", retryable: false, status: 400 }]);
    const specs: RoleSpec[] = [{ provider: "gemini", model: "gemini-3.7-flash" }];
    const res = await completeWithChain("fast", specs, "S", "U", OPTS, { adapters: { gemini: g.adapter } });
    assert.equal(res, null);
  });
});

test("bo'sh specs ro'yxati — null, adapter chaqirilmaydi", async () => {
  const res = await completeWithChain("fast", [], "S", "U", OPTS, { adapters: {} });
  assert.equal(res, null);
});

test("Retry-After — eksponensial o'rniga shu qiymat kutiladi", async () => {
  await withKeys({ GEMINI_API_KEY: "g" }, async () => {
    const g = fakeAdapter("gemini", [
      { ok: false, error: "rate limited", retryable: true, status: 429, retryAfterMs: 15 },
      { ok: true, text: "ikkinchi urinishda", usage: { inputTokens: 1, outputTokens: 1 } },
    ]);
    const specs: RoleSpec[] = [{ provider: "gemini", model: "gemini-3.7-flash" }];
    const started = Date.now();
    const res = await completeWithChain("fast", specs, "S", "U", OPTS, { adapters: { gemini: g.adapter } });
    const elapsed = Date.now() - started;
    assert.equal(res?.text, "ikkinchi urinishda");
    // Eksponensial (500ms) kutilganda bu sinov 500ms dan ko'p vaqt olardi;
    // `retryAfterMs:15` ustunlik qilsa juda tez tugaydi.
    assert.ok(elapsed < 400, `Retry-After e'tiborga olinmadi — ${elapsed} ms kutildi (eksponensial bo'lsa ≥500ms)`);
  });
});

test("adapter ro'yxatda yo'q — o'tkazib yuboriladi (kalit bor bo'lsa ham)", async () => {
  await withKeys({ OPENAI_API_KEY: "o", GEMINI_API_KEY: "g" }, async () => {
    const g = fakeAdapter("gemini", [{ ok: true, text: "gemini javobi", usage: { inputTokens: 1, outputTokens: 1 } }]);
    const specs: RoleSpec[] = [
      { provider: "openai", model: "gpt-5.6-luna" },
      { provider: "gemini", model: "gemini-3.7-flash" },
    ];
    // `adapters` da "openai" YO'Q — chain uni o'tkazib yuborishi kerak.
    const res = await completeWithChain("fast", specs, "S", "U", OPTS, { adapters: { gemini: g.adapter } });
    assert.equal(res?.text, "gemini javobi");
  });
});
