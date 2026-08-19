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
};

export async function rateLimit(
  bucket: string,
  limit: number,
  windowSec: number,
): Promise<RateResult> {
  const windowMs = windowSec * 1000;
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);

  try {
    const row = await queryOne<{ hits: number }>(
      `INSERT INTO rate_limits (bucket, window_start, hits)
       VALUES ($1, $2, 1)
       ON CONFLICT (bucket, window_start) DO UPDATE SET hits = rate_limits.hits + 1
       RETURNING hits`,
      [bucket.slice(0, 200), windowStart],
    );
    const hits = row?.hits ?? 1;
    const retryAfterSec = Math.max(1, Math.ceil((windowStart.getTime() + windowMs - Date.now()) / 1000));
    return {
      ok: hits <= limit,
      remaining: Math.max(0, limit - hits),
      limit,
      retryAfterSec,
    };
  } catch (e) {
    // Baza tushgan bo'lsa xizmatni butunlay to'xtatmaymiz, lekin buni ko'ramiz.
    console.error("[ratelimit]", e instanceof Error ? e.message : e);
    return { ok: true, remaining: limit, limit, retryAfterSec: 0 };
  }
}

/** Eski oynalarni tozalaydi (cron). */
export async function purgeRateLimits(): Promise<void> {
  const { query } = await import("./db");
  await query("DELETE FROM rate_limits WHERE window_start < now() - interval '2 hours'");
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
