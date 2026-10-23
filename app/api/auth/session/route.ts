import { ApiError, checkOrigin, handler, json, optionalUser, requireUser } from "@/lib/server/api";
import { clearSessionCookie, revokeAllSessions, revokeCurrentSession } from "@/lib/server/session";
import { clickDirectConfigured, env, imagesConfigured, llmConfigured, paymentsConfigured, paynetConfigured } from "@/lib/server/env";
import { ensureProviderKeys } from "@/lib/server/providers/store";
import { pdfAvailable } from "@/lib/server/pdf";
import { getAllToolPricing } from "@/lib/server/pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Joriy sessiya. Kirmagan foydalanuvchi uchun `user: null` — 401 emas. */
export const GET = handler("auth/session", async (req) => {
  const { user } = await optionalUser(req);
  // The feature flags follow the admin «Provayderlar» switches; reload the snapshot when it is older than the TTL.
  await ensureProviderKeys();
  return json({
    user,
    features: {
      llm: llmConfigured(),
      images: imagesConfigured(),
      telegram: Boolean(env.telegramBotToken),
      telegramBot: env.telegramBotUsername || null,
      devLogin: env.devLoginEnabled,
      pdf: pdfAvailable(),
      // `clickDirect`: the wallet offers the Click card / phone / app methods only when the Merchant API is set up.
      // `paynet`: the wallet shows the «Paynet orqali to'lash» card (paid at an agent); deliberately not in `paymentsConfigured()`.
      payments: { ...paymentsConfigured(), clickDirect: clickDirectConfigured(), paynet: paynetConfigured() },
      /*
       * Admin price adjustments, non-default tools only ({} when none), so the
       * client displays what the server charges (docs/admin/02-plan.md §17.2).
       * Cached 15 s per process; never throws.
       */
      pricing: await getAllToolPricing(),
    },
  });
});

/**
 * Chiqish. `?all=1` — barcha qurilmalardan.
 *
 * `checkOrigin` IKKALA shoxda ham (SECA-04): ilgari faqat `?all=1`
 * (`requireUser` orqali) tekshirilardi. `SESSION_COOKIE_SAMESITE=none`
 * rejimida boshqa sayt kredensial bilan `DELETE` yuborib foydalanuvchini
 * majburan chiqarib yuborardi — chiqish ham holat o'zgarishi.
 */
export const DELETE = handler("auth/logout", async (req) => {
  if (!checkOrigin(req)) throw new ApiError("So'rov manbasi noto'g'ri", 403);
  const url = new URL(req.url);
  if (url.searchParams.get("all") === "1") {
    const { user } = await requireUser(req);
    await revokeAllSessions(user.id);
  } else {
    // The cookie's row and, in bearer mode, the `Authorization` token's row (docs/auth/COOKIELESS.md).
    await revokeCurrentSession(req);
  }
  await clearSessionCookie();
  return json({ ok: true });
});
