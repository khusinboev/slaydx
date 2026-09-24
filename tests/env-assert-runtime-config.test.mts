import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

/**
 * TEST-05: `assertRuntimeConfig`'s har bir `problems.push(...)` shoxobchasi
 * ayri sinaladi. `env.ts` moduli import VAQTIDA `process.env`ni o'qiydi
 * (`const isProd = ...` va h.k.), shuning uchun har holat ALOHIDA processda
 * (`env.ts`ning taqiqlangan patterni — `tests/env-warnings.test.mts` va
 * `tests/security.test.mts`da ham xuddi shunday) sinaladi.
 *
 * Ilgari (audit topilmasi) faqat TTS-kalitsiz shoxobcha sinalgan edi — 7
 * ta `problems.push` dan 6 tasi hech qachon ishga tushirilmagan/tasdiqlanmagan
 * edi (masalan `DEV_LOGIN_ENABLED` prod da yoqilgan — "bu har kimga kirish
 * beradi" — yoki `CRON_SECRET` yo'q — Telegram webhook himoyasiz qoladi).
 */

const BASE_ENV: Record<string, string> = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://unused/unused",
  APP_URL: "https://example.uz",
  TELEGRAM_BOT_TOKEN: "t",
  NEXT_PUBLIC_TELEGRAM_BOT: "bot",
  CRON_SECRET: "s",
  SESSION_SECRET: "test-session-secret-at-least-32-characters",
  SESSION_COOKIE_SAMESITE: "lax",
};
// Shoxobchalarga xalaqit bermasin deb — bazaviy holatda TTS/dev-login o'chiq.
const CLEAR_KEYS = ["AZURE_SPEECH_KEY", "AZURE_SPEECH_REGION", "AISHA_API_KEY", "TTS_GEMINI_MODEL", "DEV_LOGIN_ENABLED", "TELEGRAM_WEBHOOK_SECRET"];

function assertRuntimeConfigProblems(patch: Record<string, string | undefined>): string[] {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of CLEAR_KEYS) delete env[k];
  Object.assign(env, BASE_ENV);
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  const out = execFileSync(
    "npx",
    ["tsx", "--conditions=react-server", "-e", 'import("./lib/server/env.ts").then(m => process.stdout.write(JSON.stringify(m.assertRuntimeConfig())))'],
    { env, timeout: 60_000, encoding: "utf8" },
  );
  return JSON.parse(out);
}

test("assertRuntimeConfig: to'liq (yaxshi) prod konfiguratsiya — hech qanday muammo yo'q", () => {
  assert.deepEqual(assertRuntimeConfigProblems({}), []);
});

test("assertRuntimeConfig: DATABASE_URL yo'q", () => {
  const problems = assertRuntimeConfigProblems({ DATABASE_URL: undefined });
  assert.ok(problems.some((p) => /DATABASE_URL yo'q/.test(p)), problems.join(" | "));
});

test("assertRuntimeConfig: APP_URL yo'q (prod)", () => {
  const problems = assertRuntimeConfigProblems({ APP_URL: undefined });
  assert.ok(problems.some((p) => /APP_URL yo'q/.test(p)), problems.join(" | "));
});

test("assertRuntimeConfig: DEV_LOGIN_ENABLED prod da yoqilgan — har kimga kirish beradi", () => {
  const problems = assertRuntimeConfigProblems({ DEV_LOGIN_ENABLED: "true" });
  assert.ok(problems.some((p) => /DEV_LOGIN_ENABLED prod da yoqilgan/.test(p)), problems.join(" | "));
});

test("assertRuntimeConfig: TELEGRAM_BOT_TOKEN yo'q (dev login ham o'chiq) — hech kim kira olmaydi", () => {
  const problems = assertRuntimeConfigProblems({ TELEGRAM_BOT_TOKEN: undefined });
  assert.ok(problems.some((p) => /TELEGRAM_BOT_TOKEN yo'q/.test(p)), problems.join(" | "));
});

test("assertRuntimeConfig: TELEGRAM_BOT_TOKEN bor, NEXT_PUBLIC_TELEGRAM_BOT yo'q — kirish havolasi qurilmaydi", () => {
  const problems = assertRuntimeConfigProblems({ NEXT_PUBLIC_TELEGRAM_BOT: undefined });
  assert.ok(problems.some((p) => /NEXT_PUBLIC_TELEGRAM_BOT yo'q/.test(p)), problems.join(" | "));
});

test("assertRuntimeConfig: SESSION_COOKIE_SAMESITE=none, APP_URL https emas — HTTPS talab qiladi", () => {
  const problems = assertRuntimeConfigProblems({ SESSION_COOKIE_SAMESITE: "none", APP_URL: "http://example.uz" });
  assert.ok(problems.some((p) => /SESSION_COOKIE_SAMESITE=none HTTPS talab qiladi/.test(p)), problems.join(" | "));
});

test("assertRuntimeConfig: SESSION_COOKIE_SAMESITE=none lekin APP_URL https — muammo YO'Q", () => {
  const problems = assertRuntimeConfigProblems({ SESSION_COOKIE_SAMESITE: "none" });
  assert.ok(!problems.some((p) => /SESSION_COOKIE_SAMESITE=none/.test(p)), problems.join(" | "));
});

// W4-C (EXT-14): webhook kaliti — `TELEGRAM_WEBHOOK_SECRET`, zaxira `CRON_SECRET`.
test("assertRuntimeConfig: TELEGRAM_WEBHOOK_SECRET ham, CRON_SECRET ham yo'q, TELEGRAM_BOT_TOKEN bor — webhook himoyalanmaydi", () => {
  const problems = assertRuntimeConfigProblems({ CRON_SECRET: undefined, TELEGRAM_WEBHOOK_SECRET: undefined });
  assert.ok(problems.some((p) => /TELEGRAM_WEBHOOK_SECRET \(yoki zaxira CRON_SECRET\) yo'q/.test(p)), problems.join(" | "));
});

test("assertRuntimeConfig: CRON_SECRET yo'q, lekin TELEGRAM_WEBHOOK_SECRET bor — webhook himoyalangan", () => {
  const problems = assertRuntimeConfigProblems({ CRON_SECRET: undefined, TELEGRAM_WEBHOOK_SECRET: "w" });
  assert.ok(!problems.some((p) => /Telegram webhook'ni himoyalab bo'lmaydi/.test(p)), problems.join(" | "));
});

test("assertRuntimeConfig: AZURE_SPEECH_KEY bor, AZURE_SPEECH_REGION yo'q — kalit yolg'iz ishlamaydi", () => {
  const problems = assertRuntimeConfigProblems({ AZURE_SPEECH_KEY: "k" });
  assert.ok(problems.some((p) => /AZURE_SPEECH_REGION yo'q/.test(p)), problems.join(" | "));
});
