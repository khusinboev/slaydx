import test from "node:test";
import assert from "node:assert/strict";
import { costUsd, costSoum, soumPerUsd, PRICING } from "../lib/generation/llm-pricing.ts";

/**
 * NARX JADVALI (`llm-pricing.ts`) — Maqola 2 / AUDIT-17, WP8.
 *
 * Qulflanadigan narsa to'rtta:
 *  1. SANAGA BOG'LIQLIK — Gemini 3.7 Flash 2027-01-01 dan qimmatlashadi;
 *     eski sana ESKI narxni, yangi sana YANGI narxni olishi kerak.
 *  2. PREFIKS MOS KELISH — versiya qo'shimchasi bilan kelgan model nomi
 *     ham to'g'ri qatorga tushishi kerak.
 *  3. NOMA'LUM MODEL — 0, XATO EMAS (dastur yiqilmasin).
 *  4. OPENROUTER USTAMASI — bir xil token bilan `openrouter` provayderi
 *     asosiy narxdan 1,055× qimmat chiqishi kerak.
 */

test("Gemini 3.7 Flash — 2026 sanasida eski narx", () => {
  const usd = costUsd(
    { provider: "gemini", model: "gemini-3.7-flash", inputTokens: 1_000_000, outputTokens: 1_000_000 },
    new Date("2026-06-01"),
  );
  assert.equal(usd, 0.75 + 3.75);
});

test("Gemini 3.7 Flash — 2027-01-01 dan YANGI narx", () => {
  const at = new Date("2027-01-01T00:00:00Z");
  const usd = costUsd(
    { provider: "gemini", model: "gemini-3.7-flash", inputTokens: 1_000_000, outputTokens: 1_000_000 },
    at,
  );
  assert.equal(usd, 1.5 + 7.5);
});

test("Gemini 3.7 Flash — 2027 sanasidan BIR KUN OLDIN hali eski narx", () => {
  const usd = costUsd(
    { provider: "gemini", model: "gemini-3.7-flash", inputTokens: 1_000_000, outputTokens: 1_000_000 },
    new Date("2026-12-31T23:59:59Z"),
  );
  assert.equal(usd, 0.75 + 3.75, "sana chegarasi noto'g'ri bo'lsa bu qizaradi");
});

test("prefiks mos keladi — versiya qo'shimchasi bilan ham topadi", () => {
  const usd = costUsd(
    { provider: "anthropic", model: "claude-sonnet-5-20260815", inputTokens: 1_000_000, outputTokens: 0 },
    new Date("2026-06-01"),
  );
  assert.equal(usd, 2, "claude-sonnet-5 kirish narxi $2/1M");
});

test("noma'lum model — 0, xato tashlamaydi", () => {
  const usd = costUsd(
    { provider: "gemini", model: "gemini-9.9-mifir", inputTokens: 1_000_000, outputTokens: 1_000_000 },
    new Date(),
  );
  assert.equal(usd, 0);
});

test("OpenRouter — asosiy model narxidan 1,055× qimmat", () => {
  const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 };
  const direct = costUsd({ provider: "anthropic", model: "claude-sonnet-5", ...usage }, new Date("2026-06-01"));
  const viaRouter = costUsd({ provider: "openrouter", model: "claude-sonnet-5", ...usage }, new Date("2026-06-01"));
  assert.ok(Math.abs(viaRouter - direct * 1.055) < 1e-9, `${viaRouter} !== ${direct * 1.055}`);
  assert.notEqual(viaRouter, direct, "openrouter narxi asosiy narxdan farqli bo'lishi SHART");
});

test("claude-opus-5 va claude-haiku-4-5 narxlari jadvaldan", () => {
  const at = new Date("2026-06-01");
  assert.equal(costUsd({ provider: "anthropic", model: "claude-opus-5", inputTokens: 1_000_000, outputTokens: 0 }, at), 5);
  assert.equal(costUsd({ provider: "anthropic", model: "claude-opus-5", inputTokens: 0, outputTokens: 1_000_000 }, at), 25);
  assert.equal(costUsd({ provider: "anthropic", model: "claude-haiku-4-5", inputTokens: 1_000_000, outputTokens: 0 }, at), 1);
});

test("baholovchi hisob-kitobi (~25k kirish/2k chiqish) — reja bilan mos tartibda", () => {
  // AUDIT-17 §4: Claude Sonnet 5 (~25k kirish / 2k chiqish) ≈ $0.09 atrofida.
  const usd = costUsd(
    { provider: "anthropic", model: "claude-sonnet-5", inputTokens: 25_000, outputTokens: 2_000 },
    new Date("2026-06-01"),
  );
  assert.ok(usd > 0.05 && usd < 0.1, `kutilgan diapazondan tashqari: ${usd}`);
});

test("bo'sh usage (0 token) — 0 narx, hech qanday qatorga tegmasdan", () => {
  const usd = costUsd({ provider: "gemini", model: "gemini-3.7-flash", inputTokens: 0, outputTokens: 0 }, new Date());
  assert.equal(usd, 0);
});

test("soumPerUsd — standart 12 700, env bilan bekor qilinadi", () => {
  const saved = process.env.SOUM_PER_USD;
  try {
    delete process.env.SOUM_PER_USD;
    assert.equal(soumPerUsd(), 12_700);
    process.env.SOUM_PER_USD = "13000";
    assert.equal(soumPerUsd(), 13_000);
    // Soxta/manfiy qiymat — standartga qaytadi.
    process.env.SOUM_PER_USD = "-5";
    assert.equal(soumPerUsd(), 12_700);
    process.env.SOUM_PER_USD = "yo'q";
    assert.equal(soumPerUsd(), 12_700);
  } finally {
    if (saved === undefined) delete process.env.SOUM_PER_USD;
    else process.env.SOUM_PER_USD = saved;
  }
});

test("costSoum — costUsd × soumPerUsd", () => {
  const saved = process.env.SOUM_PER_USD;
  try {
    process.env.SOUM_PER_USD = "10000";
    const usage = { provider: "anthropic" as const, model: "claude-sonnet-5", inputTokens: 1_000_000, outputTokens: 0 };
    assert.equal(costSoum(usage, new Date("2026-06-01")), 2 * 10_000);
  } finally {
    if (saved === undefined) delete process.env.SOUM_PER_USD;
    else process.env.SOUM_PER_USD = saved;
  }
});

test("jadvalda har qator musbat narxga ega", () => {
  for (const row of PRICING) {
    assert.ok(row.inUsdPerM > 0, `${row.provider}:${row.model} kirish narxi 0/manfiy`);
    assert.ok(row.outUsdPerM > 0, `${row.provider}:${row.model} chiqish narxi 0/manfiy`);
  }
});
