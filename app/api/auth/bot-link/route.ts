import { ApiError, checkOrigin, handler, json, limit, readJson } from "@/lib/server/api";
import { ensureMigrated } from "@/lib/server/db";
import { accountLabel } from "@/lib/telegram-miniapp";
import { botLinkAccount, botLinkSessionAction } from "@/lib/server/auth";
import { BOT_LINK_MAX_LENGTH, verifyBotLink } from "@/lib/server/bot-link";
import { createSession, currentSessionRef, revokeSessionById, setSessionCookie } from "@/lib/server/session";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";
import { IP_LIMITS } from "@/lib/server/ip-limits";
import { peekRate } from "@/lib/server/rate-peek";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  /** The `?bt=` token of a bot keyboard link (`lib/server/bot-link.ts`). */
  token?: unknown;
  /** `true` only after the user tapped «O'tish» in the account switch prompt. */
  confirm?: unknown;
};

const EXPIRED = "Kirish havolasi eskirgan. Botga qayting va /start bosing.";

/**
 * Bot keyboard link → session (docs/bot/PLAN.md Q1). The same protections as
 * `POST /api/auth/telegram`: Origin check, an IP ceiling, a separate IP bucket
 * for forged/malformed tokens (checked before any work), a per-account limit
 * after verification, the session cookie exactly like the Mini App login and
 * its account-switch rules — another Telegram account's session is never
 * replaced without the user's confirmation (409 `switch_confirm`), a
 * phone-login session never (409 `switch_phone_session`).
 *
 * The token is a bearer credential: it is never logged or echoed.
 */
export const POST = handler("auth/bot-link", async (req) => {
  await ensureMigrated();
  if (!checkOrigin(req)) throw new ApiError("So'rov manbasi noto'g'ri", 403);

  const ip = clientIp(req);
  const { tgPerIp, tgBadPerIp, tgPerAccount } = IP_LIMITS;
  const badBucket = `bl:bad:${ip}`;
  await limit(`bl:${ip}`, tgPerIp.count, tgPerIp.windowSec);
  const bad = await peekRate(badBucket, tgBadPerIp.count, tgBadPerIp.windowSec);
  if (!bad.ok) {
    throw new ApiError(`Juda ko'p so'rov. ${bad.retryAfterSec} soniyadan keyin urinib ko'ring.`, 429, {
      retryAfter: bad.retryAfterSec,
    });
  }

  const body = await readJson<Body>(req, 2_000);
  if (typeof body.token !== "string" || body.token.length === 0 || body.token.length > BOT_LINK_MAX_LENGTH) {
    await rateLimit(badBucket, tgBadPerIp.count, tgBadPerIp.windowSec);
    throw new ApiError("Kirish havolasi yaroqsiz shaklda", 400);
  }
  const confirmed = body.confirm === true;

  const link = verifyBotLink(body.token);
  if (!link.ok) {
    // A valid MAC with an old date is a genuine link that aged: not an attack, not counted.
    if (link.reason !== "expired") await rateLimit(badBucket, tgBadPerIp.count, tgBadPerIp.windowSec);
    throw new ApiError(link.reason === "expired" ? EXPIRED : "Kirish havolasi yaroqsiz", 401, {
      code: link.reason === "expired" ? "bot_link_expired" : "bot_link_invalid",
    });
  }
  await limit(`bl:uid:${link.telegramId}`, tgPerAccount.count, tgPerAccount.windowSec);

  const account = await botLinkAccount(link.telegramId, link.issuedAt);
  if (!account) throw new ApiError("Kirish havolasi yaroqsiz", 401, { code: "bot_link_invalid" });
  if (account.blocked) throw new ApiError("Hisobingiz bloklangan. Yordam uchun qo'llab-quvvatlashga yozing.", 403, { code: "account_blocked" });
  // Logout (one device or all), an admin revoke or a switch away after the link was issued voids it.
  if (account.revoked) throw new ApiError(EXPIRED, 401, { code: "bot_link_expired" });

  const current = await currentSessionRef();
  const action = botLinkSessionAction(current?.user ?? null, link.telegramId, confirmed);
  if (action === "refuse_phone") {
    throw new ApiError(
      "Siz telefon raqami orqali kirgansiz. Boshqa akkauntga o'tish uchun avval hisobdan chiqing.",
      409,
      { code: "switch_phone_session" },
    );
  }
  if (action === "confirm") {
    throw new ApiError("Boshqa akkauntga o'tishni tasdiqlang.", 409, {
      code: "switch_confirm",
      to: accountLabel(account.user) ?? "boshqa Telegram akkaunti",
    });
  }
  if (action === "reuse") return json({ user: account.user });
  if (action === "replace") await revokeSessionById(current!.sessionId);
  const { token, expiresAt } = await createSession(account.user.id, {
    userAgent: req.headers.get("user-agent"),
    ip,
  });
  await setSessionCookie(token, expiresAt);
  return json({ user: account.user });
});
