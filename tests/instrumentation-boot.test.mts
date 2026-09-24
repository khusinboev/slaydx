import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

/**
 * INFRA-01 (C17): prod da noto'g'ri konfiguratsiya bilan ishga tushish
 * `instrumentation.ts`ni yiqitishi (process ANIQ chiqishi) SHART — aks holda
 * Next.js `register()` promise'ini modul darajasida keshlaydi (bir marta rad
 * etilgan promise ABADIY rad etilgan bo'lib qoladi), HTTP listener esa
 * allaqachon tinglaydi: natija — process "Up" bo'lib qoladi va HAR SO'ROVGA
 * 500 qaytaradi, hech qachon tuzalmaydi (2026-09-17 aynan shu sabab bilan
 * production butunlay yotib qoldi — AUDIT-22 deploy, TTS kaliti yo'q edi).
 *
 * Bu test HAQIQIY Next.js runtime'ni ishga tushirmaydi (og'ir) — o'rniga
 * xuddi Next qiladigan narsani taqlid qiladi: `register()`ni chaqiradi va
 * uning rad etilishini "yutadi" (`.catch(() => {})`), keyin process HALI
 * TIRIKMI (zombie) yoki ANIQ CHIQDIMI (exit kodi) ni tekshiradi.
 *
 * Mutatsiya: `instrumentation.ts`da `process.exit(1)`ni yana `throw new
 * Error(...)`ga qaytaring — bu test qizaradi (process tirik qoladi,
 * "STILL_ALIVE" chiqadi, exit kodi 0 bo'ladi).
 */
// Diqqat: top-level \`await\` emas (tsx \`-e\` bayrog'i skriptni CJS'ga
// o'giradi, u top-level await'ni QO'LLAMAYDI) — shuning uchun async IIFE.
const HARNESS = `
  (async () => {
    process.on("unhandledRejection", () => {});
    const mod = await import("./instrumentation.ts");
    mod.register().catch(() => {});
    // Agar register() process'ni ANIQ chiqarmasa (eski, buzuq xatti-harakat),
    // process tirik qoladi va shu setTimeout ishga tushadi — zombie holatini
    // isbotlaymiz, lekin testni abadiy osilib qolishdan cheklaymiz.
    setTimeout(() => {
      console.log("STILL_ALIVE");
      process.exit(0);
    }, 1200);
  })();
`;

function runBadProdBoot(): { stdout: string; exitCode: number | null } {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    NEXT_RUNTIME: "nodejs",
    NEXT_PHASE: undefined,
    // Muhim: sessiya sirini haqiqiy qiymat bilan beramiz — aks holda
    // `lib/server/env.ts` modul IMPORT vaqtida BOSHQA sababdan (SESSION_SECRET)
    // yiqiladi va biz sinamoqchi bo'lgan `assertRuntimeConfig` shoxobchasi
    // umuman ishga tushmaydi.
    SESSION_SECRET: "test-session-secret-at-least-32-characters",
    APP_URL: "https://example.uz",
    // `DATABASE_URL` ATAYLAB yo'q — `assertRuntimeConfig` "DATABASE_URL yo'q"
    // muammosini qaytaradi, `problems.length > 0` bo'ladi va HAQIQIY DB'ga
    // ulanishga hech qachon yetib bormaymiz (migratsiya bosqichiga o'tmaydi).
    DATABASE_URL: undefined,
    TELEGRAM_BOT_TOKEN: undefined,
    DEV_LOGIN_ENABLED: undefined,
    CRON_SECRET: undefined,
  };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];

  try {
    const stdout = execFileSync("npx", ["tsx", "--conditions=react-server", "-e", HARNESS], {
      env,
      timeout: 10_000,
      encoding: "utf8",
    });
    return { stdout, exitCode: 0 };
  } catch (e) {
    const err = e as { status?: number | null; stdout?: string };
    return { stdout: err.stdout ?? "", exitCode: err.status ?? null };
  }
}

test("instrumentation: prod da buzuq konfiguratsiya bilan process ANIQ chiqadi (zombie emas)", () => {
  const { stdout, exitCode } = runBadProdBoot();
  assert.ok(!stdout.includes("STILL_ALIVE"), `process tirik qolmasligi kerak edi, lekin qoldi:\n${stdout}`);
  assert.equal(exitCode, 1, `process.exit(1) bilan chiqishi kerak, exit kodi: ${exitCode}`);
});
