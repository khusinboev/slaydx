import "server-only";
import { query, queryOne } from "./db";
import { windowStartOf } from "./ratelimit";

/**
 * `rateLimit` ning ikki yordamchisi — o'sha `rate_limits` jadvali va
 * o'sha qat'iy oyna (`windowStartOf`) bilan.
 *
 *   • `peekRate` — hisobni OSHIRMASDAN «chegara to'lganmi?» deb so'raydi.
 *     Faqat MUVAFFAQIYATSIZ urinishlarni sanaydigan chelaklar uchun
 *     (C29): urinishdan oldin qarab olinadi, xato bo'lsagina
 *     `rateLimit` bilan bittaga oshiriladi. Shunda NAT ortidagi yuzlab
 *     muvaffaqiyatli kirish chelakni to'ldirmaydi, taxmin qilish esa
 *     baribir to'xtaydi.
 *   • `refundRate` — bitta urinishni QAYTARADI. Foydalanuvchi aybi
 *     bo'lmagan rad (masalan LibreOffice navbati band — 503) uning
 *     chastota ulushini yemasin.
 */

export type PeekResult = { ok: boolean; hits: number; retryAfterSec: number };

export async function peekRate(bucket: string, limit: number, windowSec: number, now = Date.now()): Promise<PeekResult> {
  const windowStart = windowStartOf(now, windowSec);
  const retryAfterSec = Math.max(1, Math.ceil((windowStart.getTime() + windowSec * 1000 - now) / 1000));
  try {
    const row = await queryOne<{ hits: number }>(
      `SELECT hits FROM rate_limits WHERE bucket = $1 AND window_start = $2`,
      [bucket.slice(0, 200), windowStart],
    );
    const hits = row?.hits ?? 0;
    return { ok: hits < limit, hits, retryAfterSec };
  } catch (e) {
    // `rateLimit` ning standart xulqi: baza tushsa kirishni to'xtatmaymiz, lekin ko'ramiz.
    console.error("[ratelimit/peek]", bucket.split(":")[0], e instanceof Error ? e.message : e);
    return { ok: true, hits: 0, retryAfterSec: 0 };
  }
}

/** `at` — hisob oshirilgan paytdagi vaqt (oyna chegarasidan o'tib ketmaslik uchun). */
export async function refundRate(bucket: string, windowSec: number, at: number): Promise<void> {
  try {
    await query(
      `UPDATE rate_limits SET hits = GREATEST(hits - 1, 0) WHERE bucket = $1 AND window_start = $2`,
      [bucket.slice(0, 200), windowStartOf(at, windowSec)],
    );
  } catch (e) {
    console.error("[ratelimit/refund]", bucket.split(":")[0], e instanceof Error ? e.message : e);
  }
}
