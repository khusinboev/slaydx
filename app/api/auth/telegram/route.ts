import { ApiError, checkOrigin, handler, json, limit, readJson } from "@/lib/server/api";
import { ensureMigrated } from "@/lib/server/db";
import { upsertTelegramUser, verifyLoginWidget, verifyMiniAppInitData } from "@/lib/server/auth";
import { createSession, setSessionCookie } from "@/lib/server/session";
import { clientIp } from "@/lib/server/ratelimit";
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

  const ip = clientIp(req);
  await limit(`tg:${ip}`, 20, 300);

  const body = await readJson<Body>(req, 20_000);
  const profile = body.initData
    ? verifyMiniAppInitData(body.initData)
    : body.widget
      ? verifyLoginWidget(body.widget)
      : null;

  if (!profile) throw new ApiError("Telegram imzosi tekshiruvdan o'tmadi", 401);

  const user = await upsertTelegramUser(profile);
  const { token, expiresAt } = await createSession(user.id, {
    userAgent: req.headers.get("user-agent"),
    ip,
  });
  await setSessionCookie(token, expiresAt);
  return json({ user });
});
