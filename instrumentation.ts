/**
 * Server ishga tushganda bir marta chaqiriladi (Next.js instrumentation hook).
 *
 * Bu yerda migratsiya qo'llanadi va inline worker ko'tariladi — shunda
 * birinchi foydalanuvchi so'rovi kutmaydi va navbat bo'sh turmaydi.
 */
export async function register() {
  // Edge runtime da `pg` ishlamaydi — faqat Node.js processda bajaramiz.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { env, assertRuntimeConfig, runtimeWarnings } = await import("./lib/server/env");

  // Ogohlantirishlar (ixtiyoriy xizmat kalitlari) — hech qachon `throw`/`exit` emas.
  for (const w of runtimeWarnings()) console.warn(`[config] ${w}`);

  // Reverse proxy ortidamiz deb hisoblanadi (`x-forwarded-for`), lekin
  // TRUST_PROXY o'chiq bo'lsa — barcha so'rovlar IP chastota chegarasi
  // uchun BITTA paketga (proxy'ning o'z IP'iga) tushib qoladi, ya'ni
  // chegara amalda o'chib qoladi. Bu xato emas (server hali ishlayveradi),
  // shuning uchun faqat ogohlantiramiz.
  if (env.isProd && !env.trustProxy) {
    console.warn(
      "[config] TRUST_PROXY=false prod da — nginx ortida bo'lsangiz barcha so'rovlar bitta IP paketiga " +
        "tushadi va IP chastota chegarasi ishlamay qoladi",
    );
  }

  const problems = assertRuntimeConfig();
  for (const p of problems) {
    if (env.isProd) console.error(`[config] ${p}`);
    else console.warn(`[config] ${p}`);
  }
  if (env.isProd && problems.length) {
    // Prod da noto'g'ri sozlama bilan ishga tushish — jimgina buzilishdan yomon.
    //
    // ILGARI shu yerda `throw` qilinardi. Next.js `register()` promise'ini
    // modul darajasida keshlaydi: bir marta rad etilgan promise ABADIY rad
    // etilgan bo'lib qoladi, HTTP listener esa allaqachon tinglayotgan
    // bo'ladi. Natija — process "Up" bo'lib qoladi, HAR SO'ROVGA 500
    // qaytaradi (o'zining healthcheck'i ham shu qatorda), Docker esa faqat
    // process CHIQQANDA qayta ko'taradi, "unhealthy" belgisiga qarab emas.
    // 2026-09-17 aynan shu sabab bilan production butunlay yotib qoldi
    // (AUDIT-22 deploy, TTS kaliti yo'q edi). Endi ANIQ chiqamiz —
    // `restart: unless-stopped` (docker-compose.yml) buni ko'radi va
    // konteynerni qayta ko'taradi (INFRA-01).
    console.error(`[boot] konfiguratsiya to'liq emas, process chiqmoqda:\n  - ${problems.join("\n  - ")}`);
    process.exit(1);
  }

  if (!env.databaseUrl) return;

  try {
    const { ensureMigrated } = await import("./lib/server/db");
    await ensureMigrated();
  } catch (e) {
    console.error("[boot] migratsiya bajarilmadi:", e instanceof Error ? e.message : e);
    if (env.isProd) {
      // Xuddi shu sabab — jimgina zombie holatda qolishdan ko'ra process
      // chiqishi kerak, shunda `restart: unless-stopped` qayta urinadi.
      process.exit(1);
    }
    return;
  }

  if (env.worker.inline) {
    const { startInlineWorker } = await import("./lib/server/worker");
    startInlineWorker();
  }
}

/**
 * Next.js 15 instrumentation hook — server render/route xatolarini (Server
 * Component render, route handler, middleware) qo'lga oladi. Bu ilgari
 * BUTUNLAY yo'q edi (OBS-01): foydalanuvchi `error.tsx`'da `digest` kodini
 * ko'rar edi, lekin serverda shu `digest`ga mos hech qanday log yozuvi
 * bo'lmasdi — egasi digest bo'yicha logdan qidira olmasdi.
 *
 * Faqat stdout'ga bitta JSON qator yozadi (Docker `json-file` bilan
 * `docker compose logs` orqali o'qiladi/`grep`lanadi) — tashqi xizmatga
 * hech narsa yuborilmaydi.
 */
export function onRequestError(
  error: unknown,
  request: { path: string; method: string; headers: Record<string, string | string[] | undefined> },
  context: { routerKind: string; routePath: string; routeType: string },
) {
  const err = error instanceof Error ? error : undefined;
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      msg: "request_error",
      digest: (error as { digest?: string } | null)?.digest,
      path: request?.path,
      method: request?.method,
      routeType: context?.routeType,
      routePath: context?.routePath,
      err: err ? err.message : String(error),
      stack: err?.stack,
    }),
  );
}
