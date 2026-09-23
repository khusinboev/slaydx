import "server-only";
import { env } from "./env";
import { queryOne } from "./db";

/**
 * Fixed-window rate limit.
 *
 * Ilgari `/api/generate` va `/api/extract` umuman himoyalanmagan edi:
 * bitta skript cheksiz so'rov yuborib Gemini/fal.ai kaliti hisobidagi
 * pulni tugatishi mumkin edi. Endi har bucket uchun oynadagi urinishlar
 * bazada sanaladi (bir nechta instansiya bo'lsa ham umumiy hisob).
 */

export type RateResult = {
  ok: boolean;
  remaining: number;
  limit: number;
  retryAfterSec: number;
  /** Hisoblab bo'lmadi (baza xatosi) — faqat `failClosed` bilan `true` bo'ladi. */
  error?: true;
};

export type RateOptions = {
  /**
   * Baza xatosida RAD ETISH (standart — o'tkazib yuborish).
   *
   * Umumiy chaqiruvchilar uchun ochiq qolish to'g'ri: baza tushgan bo'lsa
   * xizmat baribir ishlamaydi, limitlagich esa yagona sabab bo'lmasin.
   * Lekin pulli/LLM ishini qo'riqlaydigan chelaklarda (bepul LLM —
   * `spend.ts`) aynan baza zo'riqqanda chegara yo'qolib, provayder puli
   * cheksiz yonardi (CONC-13, SCALE-14) — ular `failClosed: true` beradi.
   */
  failClosed?: boolean;
  /**
   * Oyna chegarasi siljishi (s). Kunlik oyna standartda UTC yarim tunida
   * almashadi; Toshkent kuni uchun `18 000` (UTC+5, yozgi vaqt yo'q).
   */
  offsetSec?: number;
  /** Bitta urinish necha birlik (global sarf hisobi — qimmat chaqiruv ko'proq). */
  weight?: number;
  /** Test seam — `Date.now()` o'rniga. */
  now?: number;
};

/** Oyna boshlanishi: `offsetSec` bilan siljigan qat'iy oyna. */
export function windowStartOf(nowMs: number, windowSec: number, offsetSec = 0): Date {
  const windowMs = windowSec * 1000;
  const off = offsetSec * 1000;
  return new Date(Math.floor((nowMs + off) / windowMs) * windowMs - off);
}

export async function rateLimit(
  bucket: string,
  limit: number,
  windowSec: number,
  opts: RateOptions = {},
): Promise<RateResult> {
  const now = opts.now ?? Date.now();
  const windowMs = windowSec * 1000;
  const windowStart = windowStartOf(now, windowSec, opts.offsetSec);
  const weight = Math.max(1, Math.trunc(opts.weight ?? 1));

  try {
    const row = await queryOne<{ hits: number }>(
      `INSERT INTO rate_limits (bucket, window_start, hits)
       VALUES ($1, $2, $3)
       ON CONFLICT (bucket, window_start) DO UPDATE SET hits = rate_limits.hits + EXCLUDED.hits
       RETURNING hits`,
      [bucket.slice(0, 200), windowStart, weight],
    );
    const hits = row?.hits ?? weight;
    const retryAfterSec = Math.max(1, Math.ceil((windowStart.getTime() + windowMs - now) / 1000));
    return {
      ok: hits <= limit,
      remaining: Math.max(0, limit - hits),
      limit,
      retryAfterSec,
    };
  } catch (e) {
    console.error("[ratelimit]", bucket.split(":")[0], e instanceof Error ? e.message : e);
    // Pulli/LLM chelagi — hisoblay olmasak rad etamiz (qisqa kutish bilan).
    if (opts.failClosed) return { ok: false, remaining: 0, limit, retryAfterSec: 30, error: true };
    // Baza tushgan bo'lsa xizmatni butunlay to'xtatmaymiz, lekin buni ko'ramiz.
    return { ok: true, remaining: limit, limit, retryAfterSec: 0 };
  }
}

/**
 * Eski oynalarni tozalaydi (cron). Chegara ENG UZUN oynadan katta bo'lishi
 * shart: kunlik oynalar (`polish:*`, 86 400 s — AUDIT-18) `window_start`
 * ni kun boshiga qo'yadi; ilgari «2 soat» edi — kunlik hisob har purge'da
 * yo'qolib, 3 marta/kun chegarasi aslida 3 marta/2 soat bo'lib qolardi.
 */
export const RATE_LIMIT_PURGE_INTERVAL = "25 hours";

export async function purgeRateLimits(): Promise<void> {
  const { query } = await import("./db");
  await query(`DELETE FROM rate_limits WHERE window_start < now() - interval '${RATE_LIMIT_PURGE_INTERVAL}'`);
}

/**
 * Klient IP si.
 *
 * `x-forwarded-for` ni foydalanuvchining o'zi ham yuborishi mumkin.
 * Ilgari unga so'zsiz ishonilardi — ya'ni har so'rovda tasodifiy IP
 * yozib, IP bo'yicha chastota chegarasini cheksiz aylanib o'tish
 * mumkin edi (OTP spam, chipta spam).
 *
 * Endi sarlavhaga faqat `TRUST_PROXY=true` bo'lganda ishonamiz —
 * ya'ni siz uni haqiqatan reverse proxy ortiga qo'yganingizda.
 * Proxy oxirgi qiymatni o'zi qo'shadi, shuning uchun **eng oxirgi**
 * element eng ishonchlisi.
 */
export function clientIp(req: Request): string {
  if (!env.trustProxy) {
    // Proxy yo'q: sarlavhalarga umuman ishonmaymiz. Bitta umumiy
    // bucket ham hech narsadan yaxshi (lokal/bevosita ishlash holati).
    return "direct";
  }
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const parts = fwd.split(",").map((s) => s.trim()).filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) return last.slice(0, 60);
  }
  return (
    req.headers.get("cf-connecting-ip")?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    "unknown"
  ).slice(0, 60);
}
