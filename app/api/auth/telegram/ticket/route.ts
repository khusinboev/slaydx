import { ApiError, checkOrigin, handler, json, limit } from "@/lib/server/api";
import { ensureMigrated } from "@/lib/server/db";
import { botConfigured, createTicket } from "@/lib/server/telegram";
import { clientIp } from "@/lib/server/ratelimit";
import { env } from "@/lib/server/env";
import { BROWSER_KEY_COOKIE, browserKey, IP_LIMITS } from "@/lib/server/ip-limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Telegram orqali kirishni BOSHLAYDI.
 *
 *   POST /api/auth/telegram/ticket → { nonce, url, expiresAt }
 *
 * Foydalanuvchi `url` orqali botga o'tadi, bot esa unga bir martalik
 * kirish havolasini yuboradi. Sessiya o'sha havolani bosganda ochiladi —
 * `GET /api/auth/telegram/enter`.
 *
 * Ilgari bu yerda `?action=verify` ham bor edi: bot 5 xonali kod
 * yuborar, foydalanuvchi uni saytga ko'chirib yozardi. Kod olib
 * tashlandi — sabab `007_login_link.sql` da.
 */
export const POST = handler("auth/ticket", async (req) => {
  await ensureMigrated();
  if (!checkOrigin(req)) throw new ApiError("So'rov manbasi noto'g'ri", 403);
  if (!botConfigured() || !env.telegramBotUsername) {
    throw new ApiError("Telegram kirish sozlanmagan", 503);
  }

  /*
   * Avval BRAUZER, keyin IP (C29). IP — faqat toshqin shipi: CGNAT/maktab
   * ortida yuzlab odam bitta IP dan kiradi va ilgari 11-si bloklanardi.
   */
  const browser = browserKey(req);
  const { ticketPerBrowser: perBrowser, ticketPerIp: perIp } = IP_LIMITS;
  await limit(`ticket:b:${browser.id}`, perBrowser.count, perBrowser.windowSec);
  await limit(`ticket:new:${clientIp(req)}`, perIp.count, perIp.windowSec);

  const res = json(await createTicket(env.telegramBotUsername));
  if (browser.fresh) {
    res.cookies.set(BROWSER_KEY_COOKIE, browser.id, {
      httpOnly: true,
      secure: env.isProd,
      sameSite: "lax",
      path: "/api/auth",
      maxAge: 30 * 24 * 3600,
    });
  }
  return res;
});
