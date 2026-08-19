/**
 * Server ishga tushganda bir marta chaqiriladi (Next.js instrumentation hook).
 *
 * Bu yerda migratsiya qo'llanadi va inline worker ko'tariladi — shunda
 * birinchi foydalanuvchi so'rovi kutmaydi va navbat bo'sh turmaydi.
 */
export async function register() {
  // Edge runtime da `pg` ishlamaydi — faqat Node.js processda bajaramiz.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { env, assertRuntimeConfig } = await import("./lib/server/env");

  const problems = assertRuntimeConfig();
  for (const p of problems) {
    if (env.isProd) console.error(`[config] ${p}`);
    else console.warn(`[config] ${p}`);
  }
  if (env.isProd && problems.length) {
    // Prod da noto'g'ri sozlama bilan ishga tushish — jimgina buzilishdan yomon.
    throw new Error(`Konfiguratsiya to'liq emas:\n  - ${problems.join("\n  - ")}`);
  }

  if (!env.databaseUrl) return;

  try {
    const { ensureMigrated } = await import("./lib/server/db");
    await ensureMigrated();
  } catch (e) {
    console.error("[boot] migratsiya bajarilmadi:", e instanceof Error ? e.message : e);
    if (env.isProd) throw e;
    return;
  }

  if (env.worker.inline) {
    const { startInlineWorker } = await import("./lib/server/worker");
    startInlineWorker();
  }
}
