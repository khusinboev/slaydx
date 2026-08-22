import { ApiError, checkOrigin, handler, json, limit } from "@/lib/server/api";
import { ensureMigrated } from "@/lib/server/db";
import { botConfigured, createTicket } from "@/lib/server/telegram";
import { clientIp } from "@/lib/server/ratelimit";
import { env } from "@/lib/server/env";

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

  await limit(`ticket:new:${clientIp(req)}`, 10, 300);
  return json(await createTicket(env.telegramBotUsername));
});
