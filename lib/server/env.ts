import "server-only";

/**
 * Serverdagi barcha sozlamalar shu yerdan o'qiladi.
 *
 * Sabab: ilgari `process.env` kodning o'nlab joyida to'g'ridan-to'g'ri
 * ishlatilardi va kalit yo'qligi faqat ish vaqtida, jimgina `null` qaytish
 * bilan bilinardi. Endi majburiy qiymatlar ishga tushishda tekshiriladi va
 * ixtiyoriylari bitta joyda ko'rinadi.
 */

function str(name: string, fallback = ""): string {
  return (process.env[name] ?? fallback).trim();
}

function int(name: string, fallback: number): number {
  const raw = str(name);
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function bool(name: string, fallback = false): boolean {
  const raw = str(name).toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes";
}

const isProd = process.env.NODE_ENV === "production";

/**
 * Sessiya imzosi uchun kalit. Ishlab chiqarishda majburiy — aks holda
 * har deploy da barcha sessiyalar buziladi yoki (yomoni) hamma bir xil
 * standart kalitni ishlatadi va cookie qalbakilashtiriladi.
 */
function sessionSecret(): string {
  const secret = str("SESSION_SECRET");
  if (secret.length >= 32) return secret;
  if (isProd) {
    throw new Error(
      "SESSION_SECRET kamida 32 belgidan iborat bo'lishi kerak. " +
        "Yaratish: openssl rand -base64 48",
    );
  }
  // Faqat lokal ishlab chiqishda — qayta ishga tushirilganda sessiya tushadi,
  // bu kutilgan holat va prod da hech qachon ishlamaydi.
  return "dev-only-insecure-session-secret-change-me-now";
}

export const env = {
  isProd,
  /** Absolyut tashqi manzil — cookie domeni, webhook va sitemap uchun kerak. */
  appUrl: str("APP_URL", isProd ? "" : "http://localhost:3000").replace(/\/+$/, ""),
  brandName: str("NEXT_PUBLIC_BRAND_NAME", "Sodda.ai"),

  /**
   * Qo'shimcha ruxsat etilgan manzillar (vergul bilan).
   *
   * Odatda kerak emas — Origin so'rov kelgan Host bilan mos bo'lsa
   * shundoq ham o'tadi. Bu ro'yxat maxsus holatlar uchun: masalan
   * Telegram Mini App boshqa domendan `fetch` qilsa.
   */
  allowedOrigins: str("ALLOWED_ORIGINS")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  databaseUrl: str("DATABASE_URL"),
  databasePoolMax: int("DATABASE_POOL_MAX", 10),

  sessionSecret: sessionSecret(),
  sessionTtlDays: int("SESSION_TTL_DAYS", 30),

  /**
   * Sessiya cookie'sining `SameSite` qiymati.
   *
   * `lax` — xavfsizroq, standart. Lekin Telegram'ning **web** versiyasi
   * Mini App ni `web.telegram.org` ichidagi iframe da ochadi; u yerda
   * bizning sahifamiz uchinchi tomon konteksti bo'ladi va `lax` cookie
   * umuman yuborilmaydi — ya'ni foydalanuvchi kirgandan keyin darhol
   * chiqib qolgandek ko'rinadi.
   *
   * `none` shu holatni tuzatadi, lekin HTTPS talab qiladi va CSRF
   * himoyasi endi faqat Origin tekshiruviga qoladi (u `lib/server/api.ts`
   * da qat'iy amalga oshirilgan).
   */
  sessionSameSite: (["lax", "none", "strict"].includes(str("SESSION_COOKIE_SAMESITE", "lax"))
    ? str("SESSION_COOKIE_SAMESITE", "lax")
    : "lax") as "lax" | "none" | "strict",

  /**
   * Reverse proxy ortidamizmi.
   *
   * `x-forwarded-for` ni foydalanuvchi ham yuborishi mumkin, shuning
   * uchun proxy bo'lmasa unga ishonmaymiz — aks holda IP bo'yicha
   * chastota chegarasini har bir so'rovda soxta IP bilan aylanib
   * o'tish mumkin edi.
   */
  trustProxy: bool("TRUST_PROXY", false),

  telegramBotToken: str("TELEGRAM_BOT_TOKEN"),
  telegramBotUsername: str("NEXT_PUBLIC_TELEGRAM_BOT", ""),

  /** Kalitsiz OTP — faqat lokal/staging da. Prod da yoqilsa xato beradi. */
  devLoginEnabled: bool("DEV_LOGIN_ENABLED", !isProd),

  gemini: {
    key: str("GEMINI_API_KEY"),
    model: str("GEMINI_MODEL", "gemini-3.5-flash"),
  },
  xai: {
    key: str("XAI_API_KEY"),
    model: str("XAI_MODEL", "grok-4.3"),
  },
  fal: {
    key: str("FAL_KEY"),
    model: str("FAL_MODEL", "fal-ai/flux/schnell"),
  },

  storageDir: str("STORAGE_DIR", ".data/files"),
  /** Fayl necha soatdan keyin o'chadi (REJA.md: ~24 soat). */
  fileTtlHours: int("FILE_TTL_HOURS", 72),

  click: {
    serviceId: str("CLICK_SERVICE_ID"),
    merchantId: str("CLICK_MERCHANT_ID"),
    secretKey: str("CLICK_SECRET_KEY"),
    merchantUserId: str("CLICK_MERCHANT_USER_ID"),
  },
  payme: {
    merchantId: str("PAYME_MERCHANT_ID"),
    key: str("PAYME_KEY"),
    testKey: str("PAYME_TEST_KEY"),
  },

  /** Ichki xizmat chaqiruvlari (cron, worker) uchun kalit. */
  cronSecret: str("CRON_SECRET"),

  worker: {
    /** Bitta processda parallel bajariladigan ish soni. */
    concurrency: int("WORKER_CONCURRENCY", 2),
    /** Bitta generatsiyaga ajratilgan maksimal vaqt. */
    jobTimeoutMs: int("WORKER_JOB_TIMEOUT_MS", 300_000),
    /** Worker shu processda avtomatik ishga tushsinmi. */
    inline: bool("WORKER_INLINE", true),
  },
} as const;

export function llmConfigured(): boolean {
  return Boolean(env.gemini.key || env.xai.key);
}

export function paymentsConfigured(): { click: boolean; payme: boolean } {
  return {
    click: Boolean(env.click.serviceId && env.click.secretKey && env.click.merchantId),
    payme: Boolean(env.payme.merchantId && (env.payme.key || env.payme.testKey)),
  };
}

/**
 * Ishga tushishda konfiguratsiyani tekshiradi. Prod da yetishmagan
 * qiymat — darhol xato; dev da ogohlantirish.
 */
export function assertRuntimeConfig(): string[] {
  const problems: string[] = [];
  if (!env.databaseUrl) problems.push("DATABASE_URL yo'q — ma'lumotlar bazasi ulanmagan");
  if (isProd && !env.appUrl) problems.push("APP_URL yo'q — webhook va cookie noto'g'ri ishlaydi");
  if (isProd && env.devLoginEnabled) {
    problems.push("DEV_LOGIN_ENABLED prod da yoqilgan — bu har kimga kirish beradi");
  }
  if (isProd && !env.telegramBotToken && !env.devLoginEnabled) {
    problems.push("TELEGRAM_BOT_TOKEN yo'q — hech kim kira olmaydi");
  }
  if (env.telegramBotToken && !env.telegramBotUsername) {
    problems.push("NEXT_PUBLIC_TELEGRAM_BOT yo'q — kirish havolasi qurilmaydi");
  }
  // `SameSite=None` cookie'ni brauzer faqat `Secure` bilan qabul qiladi.
  if (env.sessionSameSite === "none" && isProd && !env.appUrl.startsWith("https://")) {
    problems.push("SESSION_COOKIE_SAMESITE=none HTTPS talab qiladi (APP_URL https bo'lsin)");
  }
  if (isProd && !env.cronSecret && env.telegramBotToken) {
    problems.push("CRON_SECRET yo'q — Telegram webhook'ni himoyalab bo'lmaydi");
  }
  return problems;
}
