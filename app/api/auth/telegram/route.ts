import { ApiError, checkOrigin, handler, json, limit, readJson } from "@/lib/server/api";
import { ensureMigrated } from "@/lib/server/db";
import { miniAppSessionAction, upsertTelegramUser, verifyLoginWidget, verifyMiniAppInitData } from "@/lib/server/auth";
import { createSession, currentSessionRef, revokeSessionById, setSessionCookie } from "@/lib/server/session";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";
import { IP_LIMITS } from "@/lib/server/ip-limits";
import { peekRate } from "@/lib/server/rate-peek";
import { env } from "@/lib/server/env";
import { clearRefCookie, refCookieFromRequest, referralClaim } from "@/lib/server/referrals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  /** Mini App dan: `window.Telegram.WebApp.initData` */
  initData?: unknown;
  /** Login Widget dan: callback obyekt (id, hash, auth_date, ...) */
  widget?: unknown;
};

/** Telegram imzosi — HMAC-SHA256 ning hex ko'rinishi (64 belgi). */
const WIDGET_HASH = /^[0-9a-f]{64}$/i;

/**
 * So'rov SHAKLI imzodan OLDIN (BEA-13): `widget.hash` son yoki obyekt
 * bo'lsa `safeEqual` ichida `Buffer.from(1)` TypeError bilan 500 berardi.
 * Shakl xatosi — 400 (imzo xatosi esa oldingidek 401).
 */
function shapeError(body: Body): string | null {
  if (body.initData !== undefined && typeof body.initData !== "string") return "«initData» satr bo'lishi kerak";
  if (body.widget === undefined) return null;
  const w = body.widget;
  if (!w || typeof w !== "object" || Array.isArray(w)) return "«widget» obyekt bo'lishi kerak";
  const hash = (w as Record<string, unknown>).hash;
  if (typeof hash !== "string" || !WIDGET_HASH.test(hash)) return "Telegram imzosi yaroqsiz shaklda";
  return null;
}

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
  const shape = shapeError(body);
  if (shape) {
    // Buzuq shakl ham buzuq urinish — IP chelagiga sanaladi (fuzz 429 ga yetadi).
    await rateLimit(badBucket, tgBadPerIp.count, tgBadPerIp.windowSec);
    throw new ApiError(shape, 400);
  }
  const profile = typeof body.initData === "string" && body.initData
    ? verifyMiniAppInitData(body.initData)
    : body.widget
      ? verifyLoginWidget(body.widget as Record<string, string>)
      : null;

  if (!profile) {
    await rateLimit(badBucket, tgBadPerIp.count, tgBadPerIp.windowSec);
    throw new ApiError("Telegram imzosi tekshiruvdan o'tmadi", 401);
  }
  await limit(`tg:uid:${profile.telegramId}`, tgPerAccount.count, tgPerAccount.windowSec);

  /*
   * Mini App on a phone with two Telegram accounts: both share the webview's
   * cookies, so this browser may still carry account 1's session while
   * account 2 signs in. Same account → keep that session (no churn); another
   * account → revoke ONLY this cookie's session row (account 1's other
   * devices stay signed in) before the new cookie replaces it. A replace
   * needs FRESH launch data and a session that has a Telegram account: a
   * chat link with someone's old initData opened in Telegram Android's
   * in-app browser (same cookies) must not swap the victim's session
   * (security review B1/M1; the client also asks first). The Login Widget
   * (browsers) keeps its old behaviour.
   */
  const viaMiniApp = typeof body.initData === "string" && body.initData !== "";
  const current = viaMiniApp ? await currentSessionRef() : null;
  const sessionAction = miniAppSessionAction(current?.user ?? null, profile.telegramId, profile.authDate);
  if (viaMiniApp && sessionAction === "refuse_stale") {
    throw new ApiError("Telegram ma'lumotlari eskirgan. Mini ilovani yopib, qayta oching.", 409, { code: "switch_stale" });
  }
  if (viaMiniApp && sessionAction === "refuse_phone") {
    throw new ApiError(
      "Siz telefon raqami orqali kirgansiz. Boshqa akkauntga o'tish uchun avval hisobdan chiqing.",
      409,
      { code: "switch_phone_session" },
    );
  }

  /*
   * Invite (T3): the signed Mini App `start_param` (`startapp=ref_<code>`) or the
   * code this browser captured from `/uz?ref=…`. `upsertTelegramUser` applies it
   * only when this sign-in CREATES the account; the cookie is spent either way.
   */
  const user = await upsertTelegramUser(
    profile,
    referralClaim({ startParam: profile.startParam, cookie: refCookieFromRequest(req) }),
  );
  await clearRefCookie(req);
  if (viaMiniApp && sessionAction === "reuse") return json({ user });
  if (viaMiniApp && sessionAction === "replace") await revokeSessionById(current!.sessionId);
  const { token, expiresAt } = await createSession(user.id, {
    userAgent: req.headers.get("user-agent"),
    ip,
  });
  await setSessionCookie(token, expiresAt);
  return json({ user });
});
