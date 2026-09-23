import { ApiError, checkOrigin, handler, json, limit, readJson } from "@/lib/server/api";
import { ensureMigrated } from "@/lib/server/db";
import { upsertTelegramUser, verifyLoginWidget, verifyMiniAppInitData } from "@/lib/server/auth";
import { createSession, setSessionCookie } from "@/lib/server/session";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";
import { IP_LIMITS } from "@/lib/server/ip-limits";
import { peekRate } from "@/lib/server/rate-peek";
import { env } from "@/lib/server/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  /** Mini App dan: `window.Telegram.WebApp.initData` */
  initData?: string;
  /** Login Widget dan: callback obyekt (id, hash, auth_date, ...) */
  widget?: Record<string, string>;
};

/**
 * Telegram orqali kirish.
 *
 * Imzo har ikkala oqimda ham server tomonda bot token bilan tekshiriladi.
 * Klientdan kelgan `id` ga hech qachon ishonilmaydi — aks holda har kim
 * istalgan Telegram ID nomidan kira olardi.
 */
export const POST = handler("auth/telegram", async (req) => {
  await ensureMigrated();
  if (!checkOrigin(req)) throw new ApiError("So'rov manbasi noto'g'ri", 403);
  if (!env.telegramBotToken) {
    throw new ApiError("Telegram kirish sozlanmagan (TELEGRAM_BOT_TOKEN yo'q)", 503);
  }

  /*
   * IP — keng shift (NAT, C29); qat'iy chegara imzo tekshiruvidan KEYIN
   * Telegram hisobi bo'yicha. Imzosi buzuq so'rovlar alohida sanaladi.
   */
  const ip = clientIp(req);
  const { tgPerIp, tgBadPerIp, tgPerAccount } = IP_LIMITS;
  const badBucket = `tg:bad:${ip}`;
  await limit(`tg:${ip}`, tgPerIp.count, tgPerIp.windowSec);
  const bad = await peekRate(badBucket, tgBadPerIp.count, tgBadPerIp.windowSec);
  if (!bad.ok) {
    throw new ApiError(`Juda ko'p so'rov. ${bad.retryAfterSec} soniyadan keyin urinib ko'ring.`, 429, {
      retryAfter: bad.retryAfterSec,
    });
  }

  const body = await readJson<Body>(req, 20_000);
  const profile = body.initData
    ? verifyMiniAppInitData(body.initData)
    : body.widget
      ? verifyLoginWidget(body.widget)
      : null;

  if (!profile) {
    await rateLimit(badBucket, tgBadPerIp.count, tgBadPerIp.windowSec);
    throw new ApiError("Telegram imzosi tekshiruvdan o'tmadi", 401);
  }
  await limit(`tg:uid:${profile.telegramId}`, tgPerAccount.count, tgPerAccount.windowSec);

  const user = await upsertTelegramUser(profile);
  const { token, expiresAt } = await createSession(user.id, {
    userAgent: req.headers.get("user-agent"),
    ip,
  });
  await setSessionCookie(token, expiresAt);
  return json({ user });
});
