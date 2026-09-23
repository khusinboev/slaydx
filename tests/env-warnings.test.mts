import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * KONFIGURATSIYA: ixtiyoriy xizmat kaliti (TTS) yo'qligi OGOHLANTIRISH,
 * XATO EMAS (AUDIT-22 deploy saboqi, 2026-09-17: prod web konteyneri
 * shu sabab ko'tarilmay qoldi).
 *
 * Mutatsiya: TTS satrini yana `assertRuntimeConfig` `problems` ga
 * qo'shish — birinchi test qizaradi; `instrumentation.ts` da
 * `runtimeWarnings` chaqiruvini olib tashlash — ikkinchisi.
 */
Object.assign(process.env, { NODE_ENV: "production" });
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
process.env.APP_URL = "https://example.uz";
process.env.TELEGRAM_BOT_TOKEN = "t";
process.env.NEXT_PUBLIC_TELEGRAM_BOT = "bot";
process.env.CRON_SECRET = "s";
process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
delete process.env.AZURE_SPEECH_KEY;
delete process.env.AZURE_SPEECH_REGION;
delete process.env.AISHA_API_KEY;
delete process.env.TTS_GEMINI_MODEL;
delete process.env.DEV_LOGIN_ENABLED;

const { assertRuntimeConfig, runtimeWarnings, ttsConfigured } = await import("../lib/server/env.ts");

test("prod: TTS kalitsiz `assertRuntimeConfig` TTS haqida XATO bermaydi, `runtimeWarnings` esa ogohlantiradi", () => {
  assert.equal(ttsConfigured(), false);
  const problems = assertRuntimeConfig();
  assert.ok(!problems.some((p) => /TTS/.test(p)), `TTS xato ro'yxatida bo'lmasin: ${problems.join(" | ")}`);
  assert.ok(runtimeWarnings().some((w) => /TTS kaliti yo'q/.test(w)), "ogohlantirish bor");
});

/**
 * INFRA-01 (C17): ilgari shu yerda `throw` bo'lardi — Next.js `register()`
 * promise'ini modul darajasida keshlaydi, shuning uchun `throw` process'ni
 * ANIQ CHIQARMAYDI (HTTP listener allaqachon tinglaydi): process "Up"
 * bo'lib qoladi va abadiy 500 qaytaradi (2026-09-17 aynan shu sabab bilan
 * ishlab chiqarish butunlay yotib qoldi). Endi `problems.length` bo'yicha
 * ANIQ `process.exit(1)` chaqiriladi — real zombie/exit farqi
 * `tests/instrumentation-boot.test.mts`da bolalar process orqali sinaladi.
 */
test("instrumentation ogohlantirishlarni faqat jurnalga yozadi, `process.exit(1)` faqat `problems` uchun", () => {
  const src = readFileSync("instrumentation.ts", "utf8");
  assert.match(src, /for \(const w of runtimeWarnings\(\)\) console\.warn/, "ogohlantirish jurnalda");
  assert.ok(!/\bthrow new Error\(`Konfiguratsiya/.test(src), "konfiguratsiya muammosi endi `throw` emas — zombie holatini qaytaradi (INFRA-01)");
  const exitAt = src.indexOf("process.exit(1)");
  assert.ok(exitAt > 0, "`process.exit(1)` topilmadi");
  assert.match(src.slice(exitAt - 1000, exitAt), /problems\.length/, "exit faqat problems bo'yicha");
  assert.ok(!/runtimeWarnings\(\)\.length/.test(src), "ogohlantirish soni exit'ga ta'sir qilmaydi");
});
