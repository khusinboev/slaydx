import "server-only";
import { BRAND_NAME } from "../brand";
import { acceptedPaymeKeys } from "./payme-keys";

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

/**
 * Millisoniya: butun va ≥ 0 bo'lsa o'zi (`0` — «chegara yo'q»), aks holda
 * (bo'sh, manfiy, kasr, matn) standart. `int` dan farqi: «10ms» ni 10 deb
 * qabul qilmaydi (C33 `db.ts envMs` semantikasi aynan ko'chirildi).
 */
function ms(name: string, fallback: number): number {
  const raw = str(name);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

const isProd = process.env.NODE_ENV === "production";

/**
 * Sessiya imzosi uchun kalit. Ishlab chiqarishda majburiy — aks holda
 * har deploy da barcha sessiyalar buziladi yoki (yomoni) hamma bir xil
 * standart kalitni ishlatadi va cookie qalbakilashtiriladi.
 */
/**
 * `next build` sahifa ma'lumotini yig'ayotgan payt.
 *
 * Build API route modullarini IMPORT qiladi, `NODE_ENV` esa allaqachon
 * `production`. Sirlar bo'lsa build muhitida yo'q va BO'LMASLIGI ham
 * kerak — ular konteynerga ishga tushirishda beriladi. Shu farq
 * qilinmasa `docker build` «SESSION_SECRET yo'q» deb yiqiladi.
 *
 * Bu tekshiruvni zaiflashtirmaydi: build chiqishiga hech qanday
 * server siri yozilmaydi (faqat `NEXT_PUBLIC_*` inline bo'ladi), va
 * konteyner ishga tushganda modul haqiqiy muhit bilan qayta import
 * qilinib, tekshiruv o'z kuchida qoladi.
 */
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

function sessionSecret(): string {
  const secret = str("SESSION_SECRET");
  if (secret.length >= 32) return secret;
  if (isProd && !isBuildPhase) {
    throw new Error(
      "SESSION_SECRET kamida 32 belgidan iborat bo'lishi kerak. " +
        "Yaratish: openssl rand -base64 48",
    );
  }
  // Faqat lokal ishlab chiqishda — qayta ishga tushirilganda sessiya tushadi,
  // bu kutilgan holat va prod da hech qachon ishlamaydi.
  return "dev-only-insecure-session-secret-change-me-now";
}

/**
 * `WORKER_JOB_TIMEOUT_MS` standarti — ishning YUQORI chegarasi.
 *
 * 300 000 edi va `budgetFor` ning bet formulasini eng qimmat tariflarda
 * O'LIK qilib qo'yardi (N-3). 23 betdan yuqorida hisob doim shu shiftga
 * urilardi, ya'ni to'rtta eng qimmat kurs ishi tarifi bir xil vaqt olardi:
 *
 *   25-30 bet (18 000 tanga) — xohladi 342 s, oldi 300 s
 *   30-35 bet (20 000 tanga) — xohladi 387 s, oldi 300 s
 *   35-40 bet (22 000 tanga) — xohladi 432 s, oldi 300 s
 *   40-45 bet (24 000 tanga) — xohladi 477 s, oldi 300 s
 *
 * Ya'ni formula va standart shift bir-birini yolg'onga chiqarardi va
 * hajm darvozasidan yiqilish ehtimoli aynan eng yuqori narxda eng katta
 * edi. Endi shift eng katta ishning haqiqiy ehtiyojini qoplaydi.
 *
 * Bu qulf muddatini uzaytirmaydi: `reclaimStaleJobs` HAR ISHNING o'z
 * `budget_ms` idan foydalanadi, global qiymat esa faqat migratsiyadan
 * oldingi eski qatorlar uchun zaxira.
 */
/*
 * 480 s edi. Pro slayd 30 slaydda ~570 s so'raydi (`budget.ts`) — shift
 * yana formulani yolg'onga chiqarardi. Bu qulf muddatini uzaytirmaydi
 * (`reclaimStaleJobs` har ishning o'z `budget_ms` ini o'qiydi).
 */
export const DEFAULT_JOB_TIMEOUT_MS = 660_000;

export const env = {
  isProd,
  /** Absolyut tashqi manzil — cookie domeni, webhook va sitemap uchun kerak. */
  appUrl: str("APP_URL", isProd ? "" : "http://localhost:3000").replace(/\/+$/, ""),
  brandName: BRAND_NAME,

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
  /**
   * Hovuz vaqt chegaralari (C33, DB-08; `db.ts poolConfig`). `0` — chegara
   * yo'q. Getter: hovuz yaratilayotgan paytdagi qiymat o'qiladi (sinovlar
   * `process.env` ni modul yuklangandan keyin o'zgartiradi).
   */
  get databaseStatementTimeoutMs(): number {
    return ms("DATABASE_STATEMENT_TIMEOUT_MS", 30_000);
  },
  get databaseConnectTimeoutMs(): number {
    return ms("DATABASE_CONNECT_TIMEOUT_MS", 5_000);
  },

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
    model: str("GEMINI_MODEL", "gemini-3.7-flash"),
  },
  xai: {
    key: str("XAI_API_KEY"),
    model: str("XAI_MODEL", "grok-4.3"),
  },
  fal: {
    key: str("FAL_KEY"),
    model: str("FAL_MODEL", "fal-ai/flux/schnell"),
  },

  /**
   * TTS (AUDIT-22: podkast, tabriknoma) — `docs/research/tts.md` §3.
   *
   * Nega bu yerda ham, `lib/generation/tts/*` da `process.env` ham:
   * adapterlar IZOMORF qatlamda (server importi yo'q, mock `fetch`
   * bilan sinaladi) va `env.ts` `server-only` — ular uni import qila
   * olmaydi. Bu yerdagi ro'yxat SOZLAMA KO'ZGUSI: `assertRuntimeConfig`
   * va `ttsConfigured()` shu yerdan o'qiydi, ya'ni kalit yo'qligi
   * ishga tushishda ko'rinadi, generatsiya yiqilganda emas.
   */
  tts: {
    azureKey: str("AZURE_SPEECH_KEY"),
    azureRegion: str("AZURE_SPEECH_REGION"),
    aishaKey: str("AISHA_API_KEY"),
    /** Gemini TTS PREVIEW modeli — bo'sh bo'lsa provayder o'chiq (ataylab). */
    geminiModel: str("TTS_GEMINI_MODEL"),
  },

  storageDir: str("STORAGE_DIR", ".data/files"),

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
    /**
     * Sinov (sandbox) kaliti FAQAT shu `true` bo'lsa qabul qilinadi (C11).
     * Prod'da `PAYME_TEST_KEY` tasodifan qolib ketsa ham test to'lovlari
     * haqiqiy balansga aylanmaydi.
     */
    sandbox: bool("PAYME_SANDBOX", false),
  },

  /** Ichki xizmat chaqiruvlari (cron, worker) uchun kalit. */
  cronSecret: str("CRON_SECRET"),

  /**
   * BEPUL LLM endpointlari (reja, UDK, «Tuzatish», «Hammasini tuzatish») —
   * sarf shifti (prod-readiness C10). Kredit yechilmaydi, shuning uchun
   * provayder puli faqat shu chegaralar bilan to'siladi. Kun — Toshkent
   * vaqti bilan; siyosat va standartlar `lib/server/spend.ts` da.
   */
  freeLlm: {
    /** `true` — to'rttala endpoint darhol 503, provayder chaqirilmaydi. */
    disabled: bool("FREE_LLM_DISABLED", false),
    dailyOutline: int("FREE_LLM_DAILY_OUTLINE", 20),
    dailyUdk: int("FREE_LLM_DAILY_UDK", 20),
    dailyRewrite: int("FREE_LLM_DAILY_REWRITE", 30),
    dailyPolish: int("FREE_LLM_DAILY_POLISH", 10),
    /** Barcha foydalanuvchilar bo'yicha kunlik birlik (vazn bilan) — xarajat shifti. */
    dailyGlobal: int("FREE_LLM_DAILY_GLOBAL", 20_000),
  },

  /**
   * Navbat nazorati (prod-readiness C22/C16, `audit/designs/capacity.md`).
   * Navbat to'lsa (taxminiy kutish > `maxWaitSec`) yangi ish PUL YECHILMASDAN
   * 429 + `Retry-After` bilan qaytariladi; bitta foydalanuvchida bir vaqtda
   * `userMaxInflight` tadan ortiq ish bo'lmaydi; `ttlSec` dan uzoq navbatda
   * turgan ish FAILED + pul qaytariladi.
   */
  queue: {
    totalSlots: int("QUEUE_TOTAL_SLOTS", 8),
    meanServiceSec: int("QUEUE_MEAN_SERVICE_SEC", 200),
    maxWaitSec: int("QUEUE_MAX_WAIT_SEC", 900),
    userMaxInflight: int("USER_MAX_INFLIGHT", 2),
    ttlSec: int("QUEUE_TTL_SEC", 2700),
  },

  /** Saqlash muddati (C23, `audit/designs/retention.md`): faqat bonus bilan yaratilgan fayllar. */
  retention: {
    bonusDays: int("RETENTION_BONUS_DAYS", 180),
  },

  /** LibreOffice PDF konvertatsiyasi (C07): web jarayonida bir vaqtda nechta `soffice`. */
  pdf: {
    maxConcurrency: int("PDF_MAX_CONCURRENCY", 2),
  },

  worker: {
    /** Bitta processda parallel bajariladigan ish soni. */
    concurrency: int("WORKER_CONCURRENCY", 2),
    /** Bitta generatsiyaga ajratilgan maksimal vaqt. */
    jobTimeoutMs: int("WORKER_JOB_TIMEOUT_MS", DEFAULT_JOB_TIMEOUT_MS),
    /** Worker shu processda avtomatik ishga tushsinmi. */
    // Prod'da standart o'chiq (CONC-17): compose override'siz ishga tushgan web
    // nusxasi navbatni o'zi bajarib ketmasin. Dev'da avvalgidek yoqiq.
    inline: bool("WORKER_INLINE", !isProd),
  },
} as const;

export function llmConfigured(): boolean {
  return Boolean(env.gemini.key || env.xai.key);
}

/**
 * Ovoz provayderi bormi (podkast/tabriknoma).
 *
 * Azure IKKALA qiymatni talab qiladi: kalit bo'lib region bo'lmasa URL
 * `https://.tts.speech…` bo'lib, DNS xatosi «tarmoq nosozligi» deb
 * ko'rinardi. Gemini ataylab `TTS_GEMINI_MODEL` ga bog'langan —
 * `GEMINI_API_KEY` ning o'zi preview TTS ni YOQMAYDI.
 */
export function ttsConfigured(): boolean {
  return Boolean((env.tts.azureKey && env.tts.azureRegion) || env.tts.aishaKey || (env.gemini.key && env.tts.geminiModel));
}

export function paymentsConfigured(): { click: boolean; payme: boolean } {
  return {
    click: Boolean(env.click.serviceId && env.click.secretKey && env.click.merchantId),
    // Webhook bilan BIR XIL qoida (review R1): faqat test kaliti + sandbox o'chiq —
    // checkout taklif qilinmaydi, aks holda har to'lov Payme'da AUTH bilan yiqilardi.
    payme: Boolean(env.payme.merchantId && acceptedPaymeKeys(env.payme).length),
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
  if (env.tts.azureKey && !env.tts.azureRegion) {
    problems.push("AZURE_SPEECH_REGION yo'q — AZURE_SPEECH_KEY yolg'iz ishlamaydi");
  }
  return problems;
}

/**
 * OGOHLANTIRISHLAR — `assertRuntimeConfig` dan farqli, prod da ham
 * ishga tushishni TO'XTATMAYDI.
 *
 * 2026-09-17 saboq: TTS kaliti yo'qligi `problems` ga qo'shilgan edi va
 * `instrumentation.ts` prod da ro'yxat bo'sh bo'lmasa `throw` qiladi —
 * AUDIT-22 deployidan keyin web konteyneri «unhealthy» bo'lib, 15 ta
 * ishlaydigan vosita ham yotib qoldi. Ixtiyoriy xizmatning kaliti
 * yo'qligi XATO emas: podkast/tabriknoma «Ovoz provayderi sozlanmagan»
 * bilan yiqiladi va kredit qaytadi, qolganlari ishlayveradi.
 */
export function runtimeWarnings(): string[] {
  const warnings: string[] = [];
  if (!ttsConfigured()) {
    warnings.push("TTS kaliti yo'q (AZURE_SPEECH_KEY+AZURE_SPEECH_REGION / AISHA_API_KEY) — podkast va tabriknoma ishlamaydi");
  }
  // O'chirish tugmasidagi xato yozuv («on», «enabled») jimgina «o'chirilmagan»
  // bo'lib qolardi — ya'ni bepul LLM sarfi davom etardi.
  const killSwitch = str("FREE_LLM_DISABLED").toLowerCase();
  if (killSwitch && !["1", "true", "yes", "0", "false", "no"].includes(killSwitch)) {
    warnings.push(`FREE_LLM_DISABLED="${killSwitch}" tanilmadi — bepul LLM YOQIQ qoldi (true/false yozing)`);
  }
  return warnings;
}
