import { ApiError, checkOrigin, handler, json, limit, readJson } from "@/lib/server/api";
import { ensureMigrated } from "@/lib/server/db";
import { botConfigured, createTicket, redeemTicket } from "@/lib/server/telegram";
import { createSession, setSessionCookie } from "@/lib/server/session";
import { clientIp } from "@/lib/server/ratelimit";
import { env } from "@/lib/server/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Telegram orqali kirish (chipta oqimi).
 *
 *   POST /api/auth/telegram/ticket                → { nonce, url }
 *   POST /api/auth/telegram/ticket?action=verify  → { nonce, code } → sessiya
 *
 * Kod botdan foydalanuvchining shaxsiy chatiga boradi, shuning uchun
 * boshqa birov chiptani «o'g'irlab» kira olmaydi.
 */
export const POST = handler("auth/ticket", async (req) => {
  await ensureMigrated();
  if (!checkOrigin(req)) throw new ApiError("So'rov manbasi noto'g'ri", 403);
  if (!botConfigured() || !env.telegramBotUsername) {
    throw new ApiError("Telegram kirish sozlanmagan", 503);
  }

  const ip = clientIp(req);
  const url = new URL(req.url);

  if (url.searchParams.get("action") !== "verify") {
    await limit(`ticket:new:${ip}`, 10, 300);
    const ticket = await createTicket(env.telegramBotUsername);
    return json(ticket);
  }

  await limit(`ticket:verify:${ip}`, 30, 300);
  const body = await readJson<{ nonce?: string; code?: string }>(req, 4_000);
  const nonce = String(body.nonce ?? "").slice(0, 64);
  if (!nonce) throw new ApiError("Chipta yo'q", 400);

  const result = await redeemTicket(nonce, String(body.code ?? ""));
  if (!result.ok) {
    const message = {
      pending: "Avval Telegram'da «Start» tugmasini bosing — kod shundan keyin keladi",
      expired: "Havola eskirgan — qaytadan urinib ko'ring",
      invalid: "Kod noto'g'ri",
      attempts: "Urinishlar tugadi — qaytadan boshlang",
    }[result.reason];
    // «pending» xato emas, kutish holati — 409 bilan ajratamiz.
    throw new ApiError(message, result.reason === "pending" ? 409 : 401);
  }

  const { token, expiresAt } = await createSession(result.user.id, {
    userAgent: req.headers.get("user-agent"),
    ip,
  });
  await setSessionCookie(token, expiresAt);
  return json({ user: result.user });
});
