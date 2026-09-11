import test from "node:test";
import assert from "node:assert/strict";
import { CostMeter } from "../lib/generation/llm-roles.ts";

/**
 * `CostMeter` (`llm-roles.ts`) — Maqola 2 / AUDIT-17, WP8.
 *
 * `toJson()` qulflari:
 *  1. `inputTokens`/`outputTokens`/`calls` — YIG'INDI.
 *  2. `usd` — HAQIQIY (endi 0 EMAS — WP0'da vaqtincha shunday edi):
 *     `llm-pricing.ts costUsd` bo'yicha har chaqiruv yig'indisi.
 *  3. `provider`/`model` — ENG KO'P CHIQISH TOKENI bergan juftlik.
 *  4. Bo'sh hisoblagich — nolga tushadi, xato tashlamaydi.
 */

test("bo'sh hisoblagich — nol, provider 'none'", () => {
  const meter = new CostMeter();
  assert.deepEqual(meter.toJson(), { provider: "none", model: "", inputTokens: 0, outputTokens: 0, calls: 0, usd: 0 });
});

test("undefined usage e'tiborsiz qoldiriladi", () => {
  const meter = new CostMeter();
  meter.add(undefined);
  meter.add({ provider: "gemini", model: "gemini-3.7-flash", inputTokens: 100, outputTokens: 50 });
  meter.add(undefined);
  const json = meter.toJson();
  assert.equal(json.calls, 1);
  assert.equal(json.inputTokens, 100);
});

test("token yig'indisi — bir nechta chaqiruv", () => {
  const meter = new CostMeter();
  meter.add({ provider: "gemini", model: "gemini-3.7-flash", inputTokens: 1000, outputTokens: 200 });
  meter.add({ provider: "gemini", model: "gemini-3.7-flash", inputTokens: 500, outputTokens: 100 });
  const json = meter.toJson();
  assert.equal(json.inputTokens, 1500);
  assert.equal(json.outputTokens, 300);
  assert.equal(json.calls, 2);
});

test("usd — costUsd bo'yicha HAQIQIY hisoblanadi (0 EMAS)", () => {
  const meter = new CostMeter();
  // 1M kirish + 1M chiqish claude-sonnet-5 da = $2 + $10 = $12.
  meter.add({ provider: "anthropic", model: "claude-sonnet-5", inputTokens: 1_000_000, outputTokens: 1_000_000 });
  const json = meter.toJson();
  assert.ok(Math.abs(json.usd - 12) < 1e-6, `kutilgan $12, oldi: ${json.usd}`);
});

test("usd — bir nechta har xil provayder/model yig'indisi", () => {
  const meter = new CostMeter();
  // gemini-3.7-flash: 1M/1M = $0.75 + $3.75 = $4.5
  meter.add({ provider: "gemini", model: "gemini-3.7-flash", inputTokens: 1_000_000, outputTokens: 1_000_000 });
  // claude-opus-5: 1M/0 = $5
  meter.add({ provider: "anthropic", model: "claude-opus-5", inputTokens: 1_000_000, outputTokens: 0 });
  const json = meter.toJson();
  assert.ok(Math.abs(json.usd - (4.5 + 5)) < 1e-6, `kutilgan $9.5, oldi: ${json.usd}`);
});

test("provider/model — eng ko'p CHIQISH tokeni bergan juftlik", () => {
  const meter = new CostMeter();
  meter.add({ provider: "gemini", model: "gemini-3.7-flash", inputTokens: 5000, outputTokens: 100 });
  meter.add({ provider: "anthropic", model: "claude-sonnet-5", inputTokens: 25_000, outputTokens: 2_000 });
  meter.add({ provider: "xai", model: "grok-4.3", inputTokens: 1000, outputTokens: 500 });
  const json = meter.toJson();
  assert.equal(json.provider, "anthropic", "MUTATSIYA: kirish tokeniga qarab tanlansa bu qizaradi");
  assert.equal(json.model, "claude-sonnet-5");
});

test("provider/model — teng chiqishda BIRINCHI chaqiruv saqlanadi (barqaror)", () => {
  const meter = new CostMeter();
  meter.add({ provider: "gemini", model: "gemini-3.7-flash", inputTokens: 100, outputTokens: 500 });
  meter.add({ provider: "xai", model: "grok-4.3", inputTokens: 100, outputTokens: 500 });
  const json = meter.toJson();
  assert.equal(json.provider, "gemini");
  assert.equal(json.model, "gemini-3.7-flash");
});

test("noma'lum model — usd 0 qo'shadi (jami hisobga tegmaydi, xato tashlamaydi)", () => {
  const meter = new CostMeter();
  meter.add({ provider: "gemini", model: "gemini-9.9-noma-lum", inputTokens: 1_000_000, outputTokens: 1_000_000 });
  const json = meter.toJson();
  assert.equal(json.usd, 0);
  assert.equal(json.inputTokens, 1_000_000, "tokenlar baribir yig'iladi — faqat narx noma'lum");
});
