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

test("instrumentation ogohlantirishlarni faqat jurnalga yozadi, `throw` faqat `problems` uchun", () => {
  const src = readFileSync("instrumentation.ts", "utf8");
  assert.match(src, /for \(const w of runtimeWarnings\(\)\) console\.warn/, "ogohlantirish jurnalda");
  const throwAt = src.indexOf("throw new Error(`Konfiguratsiya");
  assert.ok(throwAt > 0);
  assert.match(src.slice(throwAt - 200, throwAt), /problems\.length/, "throw faqat problems bo'yicha");
  assert.ok(!/runtimeWarnings\(\)\.length/.test(src), "ogohlantirish soni throw ga ta'sir qilmaydi");
});
